import { request as undiciRequest } from 'undici';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { config } from './config.js';

export interface ElibProxyOptions {
  baseUrl: string;
  enabled: boolean;
  timeoutMs: number;
}

/**
 * Streaming reverse proxy for the elib document service.
 *
 * Approach: undici `request()` (already a dependency for VSQI) + Fastify
 * `reply.hijack()`. Chosen over @fastify/http-proxy to avoid a new
 * dependency and to keep full control over streaming, Set-Cookie
 * passthrough and error shape. Request and response bodies are piped
 * as streams — a 200 MB multipart upload or a file download is never
 * buffered in memory.
 *
 * Mapping: /api/elib/<rest> -> {ELIB_BASE_URL}/api/<rest> (query preserved).
 * The elib session cookie is httpOnly with path=/, so it works same-origin
 * through this proxy without rewriting.
 *
 * Rate limiting: these routes are exempt (`rateLimit: false`). The
 * standards-search limit (30/min) would break large uploads/downloads;
 * elib itself enforces auth and file-size limits.
 */

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'proxy-authorization',
  'proxy-authenticate',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  // undici throws NotSupportedError when asked to send `expect`, which
  // turned curl/script uploads (Expect: 100-continue) into a 502.
  'expect'
]);

/** Slightly above elib's 200 MB file cap, to allow multipart field overhead. */
const ELIB_PROXY_BODY_LIMIT = 220 * 1024 * 1024;

/**
 * Allowlist of elib API paths reachable through the browser proxy,
 * enumerated from elib's actual routes (src/routes/*.ts):
 *   POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
 *   GET  /api/categories
 *   POST /api/documents, GET /api/documents
 *   GET  /api/documents/:id/files/:fileId/download
 *   GET  /api/documents/:id/preview   (limited-page preview, Phase B)
 *   GET  /api/documents/:id/view      (full view, owner+admin, Phase B)
 *   PATCH /api/documents/:id          (visibility change, admin/owner, Phase A2/B2)
 * Anything else (including elib's /internal/*, which is never under
 * /api/ and must stay unreachable from browsers) is refused here
 * instead of being forwarded.
 */
const ELIB_ALLOWLIST_EXACT = new Set([
  'auth/login',
  'auth/logout',
  'auth/me',
  'categories',
  'documents'
]);
const ELIB_ALLOWLIST_DOWNLOAD = /^documents\/[^/]+\/files\/[^/]+\/download$/;
/** Preview/full-view are read-only: GET only, exactly these two shapes. */
const ELIB_ALLOWLIST_PREVIEW_VIEW = /^documents\/[^/]+\/(preview|view)$/;
/** Visibility change (Phase A2): PATCH only, exactly documents/<id>. */
const ELIB_ALLOWLIST_DOCUMENT_PATCH = /^documents\/[^/]+$/;

/**
 * Path-traversal guard for the wildcard segment. Checks both the raw
 * (still percent-encoded) request path and the decoded wildcard:
 * `..` segments, `%2e` (encoded dot) and `%2f` (encoded slash) are
 * refused with 400 before anything is forwarded.
 */
function hasTraversal(rawPath: string, wildcard: string): boolean {
  const rawLower = rawPath.toLowerCase();
  if (rawLower.includes('%2e') || rawLower.includes('%2f') || rawLower.includes('%5c')) return true;
  const segments = wildcard.split('/');
  return segments.some(segment => segment === '..' || segment === '.' || segment.includes('\\'));
}

function isAllowlisted(wildcard: string, method: string): boolean {
  if (ELIB_ALLOWLIST_PREVIEW_VIEW.test(wildcard)) {
    return method === 'GET' || method === 'HEAD';
  }
  if (ELIB_ALLOWLIST_DOCUMENT_PATCH.test(wildcard)) {
    return method === 'PATCH';
  }
  return ELIB_ALLOWLIST_EXACT.has(wildcard) || ELIB_ALLOWLIST_DOWNLOAD.test(wildcard);
}

function forwardRequestHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (HOP_BY_HOP.has(name.toLowerCase())) continue;
    // A browser must never be able to inject the internal-API secret:
    // elib's /internal/* guard trusts this header, so a client-sent
    // copy is always dropped (our own server-side client sets it
    // directly on elib-net calls, never through this proxy).
    if (name.toLowerCase() === 'x-internal-token') continue;
    out[name] = value;
  }
  return out;
}

export function registerElibProxy(app: FastifyInstance, overrides: Partial<ElibProxyOptions> = {}): void {
  const opts: ElibProxyOptions = {
    baseUrl: (overrides.baseUrl ?? config.ELIB_BASE_URL).replace(/\/+$/, ''),
    enabled: overrides.enabled ?? config.ELIB_ENABLED,
    timeoutMs: overrides.timeoutMs ?? config.ELIB_TIMEOUT_MS
  };

  // Stream request bodies for proxy routes instead of buffering them.
  // The standards API is GET-only, so a wildcard stream parser is safe here;
  // application/json keeps Fastify's default parser (login bodies are tiny
  // and are re-serialised below).
  app.addContentTypeParser('multipart/form-data', (_request, payload, done) => {
    done(null, payload);
  });
  app.addContentTypeParser('*', (_request, payload, done) => {
    done(null, payload);
  });

  const handler = async (
    request: { method: string; url: string; headers: Record<string, string | string[] | undefined>; body?: unknown; params?: unknown; raw: { on: (event: string, listener: () => void) => void } },
    reply: {
      code: (status: number) => { send: (payload: unknown) => unknown };
      hijack: () => void;
      raw: {
        headersSent: boolean;
        setHeader: (name: string, value: string | string[]) => void;
        writeHead: (status: number) => void;
        destroy: () => void;
      };
      log: { error: (obj: unknown, msg: string) => void };
    }
  ) => {
    if (!opts.enabled) {
      return reply.code(503).send({
        error: { code: 'ELIB_DISABLED', message: 'Tính năng tài liệu (elib) hiện đang tắt trên máy chủ này.' }
      });
    }

    const wildcard = String((request.params as Record<string, string> | undefined)?.['*'] ?? '');
    const queryIndex = request.url.indexOf('?');
    const queryString = queryIndex >= 0 ? request.url.slice(queryIndex) : '';
    const rawPath = queryIndex >= 0 ? request.url.slice(0, queryIndex) : request.url;
    // Fastify's request.url is derived from the raw request line, but
    // check the untouched raw URL too (some clients/proxies normalize
    // dot segments in one place but not the other).
    const rawUrl = String((request.raw as { url?: string }).url ?? '');
    const rawUrlPath = rawUrl.split('?')[0] ?? '';

    if (hasTraversal(rawPath, wildcard) || hasTraversal(rawUrlPath, wildcard)) {
      return reply.code(400).send({
        error: { code: 'ELIB_BAD_PATH', message: 'Đường dẫn không hợp lệ.' }
      });
    }
    if (!isAllowlisted(wildcard, String(request.method).toUpperCase())) {
      return reply.code(404).send({
        error: { code: 'ELIB_ROUTE_NOT_FOUND', message: 'Đường dẫn tài liệu không tồn tại.' }
      });
    }

    const target = `${opts.baseUrl}/api/${wildcard}${queryString}`;

    const method = request.method.toUpperCase();
    const headers = forwardRequestHeaders(request.headers);

    let body: Readable | string | Buffer | undefined;
    const hasBodyMethod = method !== 'GET' && method !== 'HEAD';
    if (hasBodyMethod) {
      const rawBody = request.body;
      if (rawBody instanceof Readable) {
        body = rawBody;
      } else if (Buffer.isBuffer(rawBody)) {
        body = rawBody;
      } else if (typeof rawBody === 'string') {
        body = rawBody;
      } else if (rawBody !== undefined && rawBody !== null) {
        // Parsed JSON (e.g. login). Re-serialise; drop stale content-length.
        body = JSON.stringify(rawBody);
        headers['content-type'] = 'application/json';
        delete headers['content-length'];
      }
    } else {
      delete headers['content-length'];
      delete headers['content-type'];
    }

    let upstream: Awaited<ReturnType<typeof undiciRequest>>;
    try {
      upstream = await undiciRequest(target, {
        method: method as never,
        headers,
        body: body as never,
        headersTimeout: opts.timeoutMs,
        bodyTimeout: opts.timeoutMs
      });
    } catch (error) {
      // Never log headers/cookies/bodies — only the error itself.
      reply.log.error({ err: error }, 'Elib proxy request failed');
      return reply.code(502).send({
        error: { code: 'ELIB_UNAVAILABLE', message: 'Không kết nối được tới dịch vụ tài liệu (elib). Vui lòng thử lại sau.' }
      });
    }

    reply.hijack();
    for (const [name, value] of Object.entries(upstream.headers)) {
      if (value === undefined) continue;
      if (HOP_BY_HOP.has(name.toLowerCase())) continue;
      // set-cookie arrives as string[] from undici; Node's setHeader
      // accepts an array and emits one header line per cookie.
      reply.raw.setHeader(name, value as string | string[]);
    }
    reply.raw.writeHead(upstream.statusCode);
    upstream.body.on('error', () => reply.raw.destroy());
    request.raw.on('aborted', () => upstream.body.destroy());
    upstream.body.pipe(reply.raw as never);
    return reply;
  };

  app.all('/api/elib/*', { config: { rateLimit: false }, bodyLimit: ELIB_PROXY_BODY_LIMIT }, handler as never);
  app.all('/api/elib', { config: { rateLimit: false }, bodyLimit: ELIB_PROXY_BODY_LIMIT }, handler as never);
}
