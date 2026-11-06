import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyUpstreamFailure, VsqiError } from '../src/errors.js';
import { HttpClient } from '../src/http/http-client.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('VSQI upstream errors', () => {
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

  it('logs original nested network errors and preserves them as the public error cause', async () => {
    const cause = Object.assign(new Error('DNS lookup failed'), { code: 'ENOTFOUND' });
    const fetchError = new TypeError('fetch failed', { cause });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(fetchError));
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
