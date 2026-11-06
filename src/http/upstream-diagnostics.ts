import { timingSafeEqual } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { performance } from 'node:perf_hooks';
import { config } from '../config.js';
import { classifyUpstreamFailure, getErrorDetails } from '../errors.js';

const diagnosticUrl = new URL('/tim-kiem?k=TCVN%209143', config.VSQI_BASE_URL);
const diagnosticTimeoutMs = 10000;

type DiagnosticDependencies = {
  lookup: (
    hostname: string,
    options: { all: true; verbatim: true }
  ) => Promise<Array<{ address: string; family: number }>>;
  fetch: typeof fetch;
};

const defaultDependencies: DiagnosticDependencies = {
  lookup: dnsLookup,
  fetch
};

export function isDiagnosticAuthorized(authorization: string | undefined, token: string): boolean {
  if (!token || !authorization?.startsWith('Bearer ')) return false;
  const provided = Buffer.from(authorization.slice('Bearer '.length));
  const expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export async function runVsqiDiagnostics(
  dependencies: DiagnosticDependencies = defaultDependencies
) {
  const hostname = diagnosticUrl.hostname;
  const dnsStartedAt = performance.now();
  let dns: Record<string, unknown>;

  try {
    const addresses = await dependencies.lookup(hostname, { all: true, verbatim: true });
    dns = {
      ok: true,
      addresses,
      elapsedMs: Math.round(performance.now() - dnsStartedAt)
    };
  } catch (error) {
    dns = {
      ok: false,
      elapsedMs: Math.round(performance.now() - dnsStartedAt),
      failureType: classifyUpstreamFailure(error),
      ...getErrorDetails(error)
    };
  }

  const requestStartedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), diagnosticTimeoutMs);
  let request: Record<string, unknown>;

  try {
    const response = await dependencies.fetch(diagnosticUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': config.HTTP_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi,en;q=0.8'
      }
    });
    request = {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get('content-type'),
      elapsedMs: Math.round(performance.now() - requestStartedAt)
    };
    await response.body?.cancel();
  } catch (error) {
    request = {
      ok: false,
      elapsedMs: Math.round(performance.now() - requestStartedAt),
      failureType: classifyUpstreamFailure(error),
      ...getErrorDetails(error)
    };
  } finally {
    clearTimeout(timeout);
  }

  return {
    runtime: {
      nodeVersion: process.version,
      nodeOptions: process.env.NODE_OPTIONS ?? ''
    },
    dns,
    request: {
      url: diagnosticUrl.toString(),
      ...request
    }
  };
}
