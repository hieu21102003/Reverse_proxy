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

describe('Elib proxy — preview/view routes (Phase B)', () => {
  let server: Server;
  let app: Awaited<ReturnType<typeof createApp>>;
  let lastHeaders: Record<string, string | string[] | undefined> = {};
  let hits = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits += 1;
      lastHeaders = req.headers;
      if (req.headers.range) {
        res.writeHead(206, {
          'content-type': 'application/pdf',
          'content-disposition': 'inline; filename="preview-x.pdf"',
          'cache-control': 'private, no-store',
          'content-range': 'bytes 0-0/100',
          'accept-ranges': 'bytes'
        });
        res.end(Buffer.from('%'));
        return;
      }
      res.writeHead(200, {
        'content-type': 'application/pdf',
        'content-disposition': 'inline; filename="preview-x.pdf"',
        'cache-control': 'public, max-age=3600',
        etag: '"abc-v1-p2"'
      });
      res.end(Buffer.from('%PDF-fake'));
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

  it('GET preview và view được cho qua, header cache/content giữ nguyên', async () => {
    for (const url of ['/api/elib/documents/d1/preview', '/api/elib/documents/d1/view']) {
      const res = await app.inject({ method: 'GET', url, headers: { cookie: 'elib_session=good-token' } });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type'], url).toContain('application/pdf');
      expect(res.headers['content-disposition'], url).toContain('inline');
      expect(res.headers['cache-control'], url).toBe('public, max-age=3600');
      expect(lastHeaders.cookie, url).toBe('elib_session=good-token');
    }
  });

  it('Range request được chuyển tiếp, 206 + Content-Range đi qua nguyên vẹn', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/elib/documents/d1/view',
      headers: { range: 'bytes=0-0' }
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 0-0/100');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(lastHeaders.range).toBe('bytes=0-0');
  });

  it('preview/view chỉ GET: POST/PUT/DELETE bị chặn 404, không forward', async () => {
    const before = hits;
    for (const method of ['POST', 'PUT', 'DELETE'] as const) {
      for (const url of ['/api/elib/documents/d1/preview', '/api/elib/documents/d1/view']) {
        const res = await app.inject({ method, url });
        expect(res.statusCode, `${method} ${url}`).toBe(404);
      }
    }
    expect(hits).toBe(before);
  });

  it('route gần giống nhưng ngoài allowlist vẫn bị chặn', async () => {
    const before = hits;
    for (const url of [
      '/api/elib/documents/d1/preview/extra',
      '/api/elib/documents/d1/views',
      '/api/elib/documents/d1/files/f1/preview'
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
    }
    expect(hits).toBe(before);
  });
});

describe('Elib proxy — PATCH documents/:id đổi visibility (Giai đoạn A2/B2)', () => {
  let server: Server;
  let app: Awaited<ReturnType<typeof createApp>>;
  let hits = 0;
  let lastMethod = '';
  let lastBody = '';

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits += 1;
      lastMethod = req.method || '';
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        lastBody = Buffer.concat(chunks).toString('utf8');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ document: { id: 'd1', visibility: 'public' } }));
      });
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

  it('PATCH /api/elib/documents/:id được cho qua, body JSON giữ nguyên', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/elib/documents/d1',
      headers: { 'content-type': 'application/json', cookie: 'elib_session=good-token' },
      payload: JSON.stringify({ visibility: 'public' })
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().document.visibility).toBe('public');
    expect(lastMethod).toBe('PATCH');
    expect(JSON.parse(lastBody)).toEqual({ visibility: 'public' });
  });

  it('documents/:id chỉ PATCH: GET/POST/PUT/DELETE bị chặn 404, không forward', async () => {
    const before = hits;
    for (const method of ['GET', 'POST', 'PUT', 'DELETE'] as const) {
      const res = await app.inject({ method, url: '/api/elib/documents/d1' });
      expect(res.statusCode, method).toBe(404);
      expect(res.json().error.code).toBe('ELIB_ROUTE_NOT_FOUND');
    }
    expect(hits).toBe(before);
  });

  it('PATCH route khác vẫn bị chặn (preview, view, route lạ)', async () => {
    const before = hits;
    // Lưu ý: pattern download từ trước không giới hạn method (hành vi
    // có sẵn, không đổi ở B2) nên không đưa vào danh sách này.
    for (const url of [
      '/api/elib/documents/d1/preview',
      '/api/elib/documents/d1/view',
      '/api/elib/documents/d1/extra',
      '/api/elib/users/u1'
    ]) {
      const res = await app.inject({
        method: 'PATCH',
        url,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ visibility: 'public' })
      });
      expect(res.statusCode, url).toBe(404);
    }
    expect(hits).toBe(before);
  });
});
