import { createServer, request as httpRequest, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { StandardProvider } from '../src/types.js';

/**
 * Elib proxy hardening: route allowlist, path-traversal block, and
 * X-Internal-Token stripping (a browser must never inject the secret
 * that elib's /internal/* guard trusts).
 */

const provider: StandardProvider = {
  search: async () => ({ data: [], pagination: { currentPage: 1 }, source: 'MULTI' as const }),
  getDetail: async () => null
};

describe('Elib proxy security (allowlist / traversal / token strip)', () => {
  let server: Server;
  let app: Awaited<ReturnType<typeof createApp>>;
  let lastHeaders: Record<string, string | string[] | undefined> = {};
  let hits = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits += 1;
      lastHeaders = req.headers;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;
    app = await createApp(provider, {
      elib: { baseUrl: `http://127.0.0.1:${port}`, enabled: true, timeoutMs: 3000 }
    });
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('allowlisted routes still pass through', async () => {
    for (const url of [
      '/api/elib/auth/me',
      '/api/elib/categories',
      '/api/elib/documents',
      '/api/elib/documents/d1/files/f1/download'
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
    }
  });

  it('non-allowlisted paths are refused with 404 and never forwarded', async () => {
    const before = hits;
    for (const url of [
      '/api/elib/users',
      '/api/elib/internal/standards/lookup?q=TCVN%209143',
      '/api/elib/documents/d1',
      '/api/elib/auth/register',
      '/api/elib'
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
      expect(res.json().error.code).toBe('ELIB_ROUTE_NOT_FOUND');
    }
    expect(hits).toBe(before);
  });

  it('path traversal is refused with 400 and never forwarded', async () => {
    const before = hits;
    // inject/fetch URL parsing normalizes dot segments (literal and
    // %2e-encoded) away before the handler runs, so send these over a
    // real socket with node:http, which transmits the path verbatim.
    await app.listen({ host: '127.0.0.1', port: 0 });
    const port = (app.server.address() as { port: number }).port;
    const rawGet = (path: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      req.end();
    });
    for (const path of [
      '/api/elib/documents/../auth/me',
      '/api/elib/%2e%2e/auth/me',
      '/api/elib/documents%2f..%2fauth/me',
      '/api/elib/auth/%2e%2e/documents'
    ]) {
      const res = await rawGet(path);
      expect(res.status, path).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('ELIB_BAD_PATH');
    }
    expect(hits).toBe(before);
  });

  it('client-sent X-Internal-Token is stripped, other headers pass', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/elib/auth/me',
      headers: {
        'x-internal-token': 'attacker-supplied-secret',
        cookie: 'elib_session=good-token'
      }
    });
    expect(res.statusCode).toBe(200);
    expect(lastHeaders['x-internal-token']).toBeUndefined();
    expect(lastHeaders.cookie).toBe('elib_session=good-token');
  });
});
