import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { classifyUpstreamFailure, VsqiError } from '../src/errors.js';
import { HttpClient } from '../src/http/http-client.js';
import { isDiagnosticAuthorized, runVsqiDiagnostics } from '../src/http/upstream-diagnostics.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('VSQI upstream diagnostics', () => {
  it('classifies DNS, connection, timeout, and TLS failures', () => {
    expect(classifyUpstreamFailure(Object.assign(new Error('lookup failed'), { code: 'ENOTFOUND' })))
      .toBe('DNS_RESOLUTION_FAILURE');
    expect(classifyUpstreamFailure(Object.assign(new Error('reset'), { code: 'ECONNRESET' })))
      .toBe('ECONNRESET');
    expect(classifyUpstreamFailure(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })))
      .toBe('ECONNREFUSED');
    expect(classifyUpstreamFailure(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })))
      .toBe('ETIMEDOUT');
    expect(classifyUpstreamFailure(Object.assign(new Error('certificate error'), { code: 'CERT_HAS_EXPIRED' })))
      .toBe('TLS_CERTIFICATE_VALIDATION_FAILURE');
    expect(classifyUpstreamFailure(Object.assign(new Error('TLS handshake failed'), { code: 'ERR_SSL_HANDSHAKE_FAILURE' })))
      .toBe('TLS_HANDSHAKE_FAILURE');
  });

  it('reports DNS and HTTPS status without returning upstream HTML', async () => {
    const lookup = vi.fn(async (_hostname: string, _options: { all: true; verbatim: true }) => [
      { address: '203.0.113.1', family: 4 }
    ]);
    const fetch = vi.fn(async () => new Response('<html>upstream page</html>', {
      status: 403,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    }));

    const result = await runVsqiDiagnostics({ lookup, fetch });

    expect(result.dns).toMatchObject({ ok: true, addresses: [{ family: 4 }] });
    expect(result.request).toMatchObject({
      ok: false,
      status: 403,
      contentType: 'text/html; charset=utf-8'
    });
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://tieuchuan.vsqi.gov.vn/tim-kiem?k=TCVN%209143'),
      expect.objectContaining({ method: 'GET' })
    );
    expect(JSON.stringify(result)).not.toContain('upstream page');
  });

  it('requires a bearer token for the temporary diagnostic route', () => {
    const token = 'diagnostics-token-that-is-at-least-32-characters';
    expect(isDiagnosticAuthorized(`Bearer ${token}`, token)).toBe(true);
    expect(isDiagnosticAuthorized(undefined, token)).toBe(false);
    expect(isDiagnosticAuthorized(`Bearer ${token}x`, token)).toBe(false);
    expect(isDiagnosticAuthorized(`Bearer ${token}`, '')).toBe(false);
  });

  it('does not register the temporary diagnostic route when its token is unset', async () => {
    if (config.VSQI_DIAGNOSTICS_TOKEN) return;
    const app = await createApp();
    try {
      const response = await app.inject({ method: 'POST', url: '/internal/diagnostics/vsqi' });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('ROUTE_NOT_FOUND');
    } finally {
      await app.close();
    }
  });

  it('logs original nested network errors and preserves them as the public error cause', async () => {
    const cause = Object.assign(new Error('DNS lookup failed'), { code: 'ENOTFOUND' });
    const fetchError = new TypeError('fetch failed', { cause });
    const fetchMock = vi.fn().mockRejectedValue(fetchError);
    vi.stubGlobal('fetch', fetchMock);
    const warn = vi.fn();
    const client = new HttpClient({ warn });

    const error = await client
      .getHtml(new URL('https://tieuchuan.vsqi.gov.vn/tim-kiem?k=redacted'))
      .catch(error => error);

    expect(error).toBeInstanceOf(VsqiError);
    expect(error).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', cause: fetchError });

    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      processVersion: process.version,
      attempt: 1,
      failureType: 'DNS_RESOLUTION_FAILURE',
      errorName: 'TypeError',
      errorMessage: 'fetch failed',
      causeName: 'Error',
      causeMessage: 'DNS lookup failed',
      causeCode: 'ENOTFOUND'
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('redacted');
  });
});
