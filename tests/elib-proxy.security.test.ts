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

describe('Elib proxy — đăng ký / đổi mật khẩu / quản trị người dùng (Giai đoạn B3)', () => {
  let server: Server;
  let app: Awaited<ReturnType<typeof createApp>>;
  let lastHeaders: Record<string, string | string[] | undefined> = {};
  let hits = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits += 1;
      lastHeaders = req.headers;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: req.url, method: req.method }));
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

  it('POST register + change-password được cho qua; method khác bị chặn', async () => {
    for (const url of ['/api/elib/auth/register', '/api/elib/auth/change-password']) {
      const res = await app.inject({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({})
      });
      expect(res.statusCode, `POST ${url}`).toBe(200);
    }
    const before = hits;
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH'] as const) {
      for (const url of ['/api/elib/auth/register', '/api/elib/auth/change-password']) {
        const res = await app.inject({ method, url });
        expect(res.statusCode, `${method} ${url}`).toBe(404);
        expect(res.json().error.code).toBe('ELIB_ROUTE_NOT_FOUND');
      }
    }
    expect(hits).toBe(before);
  });

  it('GET admin/users được cho qua; POST/DELETE trên cùng pattern bị chặn', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/elib/admin/users?status=pending' });
    expect(res.statusCode).toBe(200);
    const before = hits;
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'] as const) {
      const blocked = await app.inject({ method, url: '/api/elib/admin/users' });
      expect(blocked.statusCode, method).toBe(404);
    }
    expect(hits).toBe(before);
  });

  it('POST approve/reject/reset-password/unlock/bulk-reject + PATCH admin/users/:id được cho qua', async () => {
    const posts = [
      '/api/elib/admin/users/u1/approve',
      '/api/elib/admin/users/u1/reject',
      '/api/elib/admin/users/u1/reset-password',
      '/api/elib/admin/users/u1/unlock',
      '/api/elib/admin/users/bulk-reject'
    ];
    for (const url of posts) {
      const res = await app.inject({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/json', cookie: 'elib_session=good-token' },
        payload: JSON.stringify({})
      });
      expect(res.statusCode, `POST ${url}`).toBe(200);
      expect(lastHeaders.cookie, url).toBe('elib_session=good-token');
    }
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/elib/admin/users/u1',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ role: 'viewer' })
    });
    expect(patch.statusCode).toBe(200);
  });

  it('method sai / route gần giống của admin bị chặn, không forward', async () => {
    const before = hits;
    const blocked: Array<[string, string]> = [
      ['GET', '/api/elib/admin/users/u1/approve'],
      ['PATCH', '/api/elib/admin/users/u1/approve'],
      ['DELETE', '/api/elib/admin/users/u1'],
      ['POST', '/api/elib/admin/users/u1'],
      ['GET', '/api/elib/admin/users/u1'],
      ['GET', '/api/elib/admin/users/bulk-reject'],
      ['PATCH', '/api/elib/admin/users/bulk-reject'],
      ['POST', '/api/elib/admin/users/u1/approve/extra'],
      ['POST', '/api/elib/admin/users/u1/delete'],
      ['GET', '/api/elib/admin/roles'],
      ['POST', '/api/elib/admin/users/u1/resetpassword']
    ];
    for (const [method, url] of blocked) {
      const res = await app.inject({ method: method as never, url });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.json().error.code).toBe('ELIB_ROUTE_NOT_FOUND');
    }
    expect(hits).toBe(before);
  });

  it('Origin được chuyển tiếp nguyên vẹn; X-Forwarded-Host đặt từ Host (ghi đè giá trị client gửi)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/elib/auth/register',
      headers: {
        'content-type': 'application/json',
        origin: 'https://192.168.1.66:8443',
        host: '192.168.1.66:8443',
        'x-forwarded-host': 'evil.example.com'
      },
      payload: JSON.stringify({})
    });
    expect(res.statusCode).toBe(200);
    expect(lastHeaders.origin).toBe('https://192.168.1.66:8443');
    expect(lastHeaders['x-forwarded-host']).toBe('192.168.1.66:8443');
  });
});

describe('Elib proxy — file tiêu chuẩn (Phase B standard-pdf)', () => {
  let server: Server;
  let app: Awaited<ReturnType<typeof createApp>>;
  let lastBody = '';
  let hits = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits += 1;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        lastBody = Buffer.concat(chunks).toString('utf8');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: req.url, method: req.method }));
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

  it('GET standards/:code/files được cho qua (kể cả mã có khoảng trắng/dấu hai chấm đã encode)', async () => {
    for (const url of [
      '/api/elib/standards/TCVN%209143%3A2022/files',
      '/api/elib/standards/ISO%209001/files'
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, `GET ${url}`).toBe(200);
      expect(res.json().method).toBe('GET');
    }
  });

  it('PATCH documents/:id/current-version được cho qua, body JSON giữ nguyên', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/elib/documents/d1/current-version',
      headers: { 'content-type': 'application/json', cookie: 'elib_session=good-token' },
      payload: JSON.stringify({ file_id: 'f-old' })
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().method).toBe('PATCH');
    expect(JSON.parse(lastBody)).toEqual({ file_id: 'f-old' });
  });

  it('method sai / route gần giống bị chặn 404, không forward', async () => {
    const before = hits;
    const blocked: Array<[string, string]> = [
      ['POST', '/api/elib/standards/TCVN%209143/files'],
      ['PUT', '/api/elib/standards/TCVN%209143/files'],
      ['PATCH', '/api/elib/standards/TCVN%209143/files'],
      ['DELETE', '/api/elib/standards/TCVN%209143/files'],
      ['GET', '/api/elib/standards/TCVN%209143'],
      ['GET', '/api/elib/standards/TCVN%209143/files/extra'],
      ['GET', '/api/elib/standards'],
      ['GET', '/api/elib/documents/d1/current-version'],
      ['POST', '/api/elib/documents/d1/current-version'],
      ['PUT', '/api/elib/documents/d1/current-version'],
      ['DELETE', '/api/elib/documents/d1/current-version'],
      ['PATCH', '/api/elib/documents/d1/current-version/extra'],
      ['PATCH', '/api/elib/documents/d1/currentversion']
    ];
    for (const [method, url] of blocked) {
      const res = await app.inject({ method: method as never, url });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.json().error.code).toBe('ELIB_ROUTE_NOT_FOUND');
    }
    expect(hits).toBe(before);
  });
});

describe('Elib proxy — metadata nhập tay admin/standards/:code (summary-detail)', () => {
  let server: Server;
  let app: Awaited<ReturnType<typeof createApp>>;
  let lastHeaders: Record<string, string | string[] | undefined> = {};
  let lastBody = '';
  let hits = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits += 1;
      lastHeaders = req.headers;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        lastBody = Buffer.concat(chunks).toString('utf8');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: req.url, method: req.method }));
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

  it('GET admin/standards/:code được cho qua (mã đã encode)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/elib/admin/standards/TCVN%2014553-1%3A2025',
      headers: { cookie: 'elib_session=good-token' }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().method).toBe('GET');
    expect(lastHeaders.cookie).toBe('elib_session=good-token');
  });

  it('PUT admin/standards/:code được cho qua, body JSON giữ nguyên', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/elib/admin/standards/TCVN%2014553-1%3A2025',
      headers: { 'content-type': 'application/json', cookie: 'elib_session=good-token' },
      payload: JSON.stringify({ title_vi: 'Tên nhập tay', ics: ['45.020'] })
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().method).toBe('PUT');
    expect(JSON.parse(lastBody)).toEqual({ title_vi: 'Tên nhập tay', ics: ['45.020'] });
  });

  it('method sai / route gần giống bị chặn 404, không forward', async () => {
    const before = hits;
    const blocked: Array<[string, string]> = [
      ['POST', '/api/elib/admin/standards/TCVN%2014553-1%3A2025'],
      ['PATCH', '/api/elib/admin/standards/TCVN%2014553-1%3A2025'],
      ['DELETE', '/api/elib/admin/standards/TCVN%2014553-1%3A2025'],
      ['GET', '/api/elib/admin/standards'],
      ['PUT', '/api/elib/admin/standards'],
      ['GET', '/api/elib/admin/standards/TCVN%2014553/files'],
      ['PUT', '/api/elib/admin/standards/TCVN%2014553/files'],
      ['GET', '/api/elib/admin/standards/TCVN%2014553/extra'],
      ['GET', '/api/elib/admin/standard/TCVN%2014553'],
      ['PUT', '/api/elib/admin/standard/TCVN%2014553'],
      ['GET', '/api/elib/standards/TCVN%2014553'],
      ['PUT', '/api/elib/standards/TCVN%2014553'],
      ['GET', '/api/elib/admin/standards/TCVN%2014553/files/extra']
    ];
    for (const [method, url] of blocked) {
      const res = await app.inject({ method: method as never, url });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.json().error.code).toBe('ELIB_ROUTE_NOT_FOUND');
    }
    expect(hits).toBe(before);
  });
});

describe('Elib proxy — mục lục PDF (P1)', () => {
  let server: Server;
  let app: Awaited<ReturnType<typeof createApp>>;
  let hits = 0;
  let lastMethod = '';
  let lastPath = '';
  let lastHeaders: Record<string, string | string[] | undefined> = {};

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits += 1;
      lastMethod = req.method || '';
      lastPath = req.url || '';
      lastHeaders = req.headers;

      const sendJson = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
        if (lastMethod === 'HEAD') {
          res.end();
          return;
        }
        res.end(JSON.stringify(payload));
      };

      if (lastPath.includes('/documents/forbidden-doc/')) {
        return sendJson(403, {
          error: { code: 'FORBIDDEN', message: 'Bạn không có quyền xem tài liệu này' }
        });
      }
      if (lastPath.includes('/documents/missing-doc/')) {
        return sendJson(404, {
          error: { code: 'NOT_FOUND', message: 'Không tìm thấy' }
        });
      }
      return sendJson(
        200,
        { document_id: 'd1', state: 'ready', displayable: true, nodes: [] },
        { 'cache-control': 'public, max-age=60' }
      );
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

  it('GET /api/elib/documents/:id/toc và /files/:fileId/toc đi qua, giữ cookie/CSRF/headers', async () => {
    const routes: Array<[string, string]> = [
      ['/api/elib/documents/d1/toc', '/api/documents/d1/toc'],
      ['/api/elib/documents/d1/files/f1/toc', '/api/documents/d1/files/f1/toc']
    ];
    for (const [proxyUrl, upstreamPath] of routes) {
      const res = await app.inject({
        method: 'GET',
        url: proxyUrl,
        headers: {
          cookie: 'elib_session=good-token',
          origin: 'https://smartrail.local:8443',
          host: 'smartrail.local:8443',
          'x-forwarded-host': 'evil.example.com',
          'x-internal-token': 'attacker-supplied-secret'
        }
      });
      expect(res.statusCode, proxyUrl).toBe(200);
      expect(res.headers['cache-control'], proxyUrl).toBe('public, max-age=60');
      expect(res.json(), proxyUrl).toEqual({
        document_id: 'd1',
        state: 'ready',
        displayable: true,
        nodes: []
      });
      expect(lastMethod).toBe('GET');
      expect(lastPath).toBe(upstreamPath);
      expect(lastHeaders.cookie).toBe('elib_session=good-token');
      expect(lastHeaders.origin).toBe('https://smartrail.local:8443');
      expect(lastHeaders['x-forwarded-host']).toBe('smartrail.local:8443');
      expect(lastHeaders['x-internal-token']).toBeUndefined();
    }
  });

  it('HEAD trên 2 route đọc TOC được cho qua và giữ cache-control', async () => {
    const routes: Array<[string, string]> = [
      ['/api/elib/documents/d1/toc', '/api/documents/d1/toc'],
      ['/api/elib/documents/d1/files/f1/toc', '/api/documents/d1/files/f1/toc']
    ];
    for (const [proxyUrl, upstreamPath] of routes) {
      const res = await app.inject({ method: 'HEAD', url: proxyUrl });
      expect(res.statusCode, `HEAD ${proxyUrl}`).toBe(200);
      expect(res.headers['cache-control'], `HEAD ${proxyUrl}`).toBe('public, max-age=60');
      expect(lastMethod).toBe('HEAD');
      expect(lastPath).toBe(upstreamPath);
    }
  });

  it('trả nguyên trạng 403 và 404 từ upstream cho 2 route đọc TOC', async () => {
    const forbiddenRes = await app.inject({
      method: 'GET',
      url: '/api/elib/documents/forbidden-doc/toc',
      headers: { cookie: 'elib_session=user-token' }
    });
    expect(forbiddenRes.statusCode).toBe(403);
    expect(forbiddenRes.json()).toEqual({
      error: { code: 'FORBIDDEN', message: 'Bạn không có quyền xem tài liệu này' }
    });

    const missingRes = await app.inject({
      method: 'GET',
      url: '/api/elib/documents/missing-doc/files/f1/toc'
    });
    expect(missingRes.statusCode).toBe(404);
    expect(missingRes.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Không tìm thấy' }
    });
  });

  it('method sai trên 2 route đọc TOC bị chặn 404 ELIB_ROUTE_NOT_FOUND, không forward', async () => {
    const before = hits;
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      for (const url of ['/api/elib/documents/d1/toc', '/api/elib/documents/d1/files/f1/toc']) {
        const res = await app.inject({ method, url });
        expect(res.statusCode, `${method} ${url}`).toBe(404);
        expect(res.json().error.code).toBe('ELIB_ROUTE_NOT_FOUND');
      }
    }
    expect(hits).toBe(before);
  });

  it('route gần giống với route TOC bị chặn 404 ELIB_ROUTE_NOT_FOUND, không forward', async () => {
    const before = hits;
    for (const url of [
      '/api/elib/documents/d1/toc/extra',
      '/api/elib/documents/d1/files/f1/toc/extra',
      '/api/elib/documents/d1/files/f1/toc/manual',
      '/api/elib/documents/d1/tocs',
      '/api/elib/documents/d1/files/f1/tocs',
      '/api/elib/documents/toc',
      '/api/elib/documents/d1/files/toc',
      '/api/elib/documents/d1/toc/promote-auto',
      '/api/elib/documents/d1/toc/reextract'
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
      expect(res.json().error.code).toBe('ELIB_ROUTE_NOT_FOUND');
    }
    expect(hits).toBe(before);
  });

  it('path traversal trên route TOC bị chặn 400 ELIB_BAD_PATH, không forward', async () => {
    const before = hits;
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
      '/api/elib/documents/d1/../d2/toc',
      '/api/elib/documents/d1/files/%2e%2e/toc',
      '/api/elib/documents/d1%2ftoc'
    ]) {
      const res = await rawGet(path);
      expect(res.status, path).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('ELIB_BAD_PATH');
    }
    expect(hits).toBe(before);
  });
});

describe('Elib proxy — quản trị mục lục PDF (P3)', () => {
  let server: Server;
  let app: Awaited<ReturnType<typeof createApp>>;
  let hits = 0;
  let lastMethod = '';
  let lastPath = '';
  let lastBody = '';
  let lastHeaders: Record<string, string | string[] | undefined> = {};

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits += 1;
      lastMethod = req.method || '';
      lastPath = req.url || '';
      lastHeaders = req.headers;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        lastBody = Buffer.concat(chunks).toString('utf8');
        const send = (status: number, payload: unknown) => {
          res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(payload));
        };
        if (lastPath.includes('/files/forbidden-file/')) {
          return send(403, { error: { code: 'FORBIDDEN', message: 'Chỉ quản trị viên mới quản lý được mục lục tài liệu' } });
        }
        if (lastPath.includes('/files/bad-file/')) {
          return send(400, { error: { code: 'INVALID_PAGE_RANGE', message: 'Số trang vượt ngoài phạm vi' } });
        }
        if (lastPath.includes('/files/processing-file/')) {
          return send(409, { error: { code: 'TOC_ALREADY_PROCESSING', message: 'Tài liệu đang được trích xuất mục lục' } });
        }
        return send(200, { ok: true, method: lastMethod, path: lastPath });
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

  it('cho qua đủ 6 route admin TOC với đúng method, giữ query/body/cookie/CSRF/headers', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/elib/admin/tocs?auto_status=partial&outdated_algorithm=true&limit=20&offset=0',
      headers: { cookie: 'elib_session=admin-token', 'x-internal-token': 'evil-token' }
    });
    expect(listRes.statusCode).toBe(200);
    expect(lastMethod).toBe('GET');
    expect(lastPath).toBe('/api/admin/tocs?auto_status=partial&outdated_algorithm=true&limit=20&offset=0');
    expect(lastHeaders.cookie).toBe('elib_session=admin-token');
    expect(lastHeaders['x-internal-token']).toBeUndefined();

    const detailRes = await app.inject({
      method: 'GET',
      url: '/api/elib/admin/files/f1/toc',
      headers: { cookie: 'elib_session=admin-token' }
    });
    expect(detailRes.statusCode).toBe(200);
    expect(lastPath).toBe('/api/admin/files/f1/toc');

    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/elib/admin/files/f1/toc/manual',
      headers: {
        'content-type': 'application/json',
        cookie: 'elib_session=admin-token',
        origin: 'https://smartrail.local:8443',
        host: 'smartrail.local:8443',
        'x-forwarded-host': 'spoof.example.com'
      },
      payload: JSON.stringify({ note: 'Kiểm duyệt', nodes: [{ title: 'Chương 1', level: 1, page_pdf: 2 }] })
    });
    expect(putRes.statusCode).toBe(200);
    expect(lastMethod).toBe('PUT');
    expect(lastPath).toBe('/api/admin/files/f1/toc/manual');
    expect(lastHeaders.origin).toBe('https://smartrail.local:8443');
    expect(lastHeaders['x-forwarded-host']).toBe('smartrail.local:8443');
    expect(JSON.parse(lastBody)).toEqual({
      note: 'Kiểm duyệt',
      nodes: [{ title: 'Chương 1', level: 1, page_pdf: 2 }]
    });

    const delRes = await app.inject({
      method: 'DELETE',
      url: '/api/elib/admin/files/f1/toc/manual',
      headers: {
        cookie: 'elib_session=admin-token',
        origin: 'https://smartrail.local:8443',
        host: 'smartrail.local:8443'
      }
    });
    expect(delRes.statusCode).toBe(200);
    expect(lastMethod).toBe('DELETE');
    expect(lastPath).toBe('/api/admin/files/f1/toc/manual');

    const promoteRes = await app.inject({
      method: 'POST',
      url: '/api/elib/admin/files/f1/toc/promote-auto',
      headers: {
        'content-type': 'application/json',
        cookie: 'elib_session=admin-token',
        origin: 'https://smartrail.local:8443',
        host: 'smartrail.local:8443'
      },
      payload: JSON.stringify({ activate: true })
    });
    expect(promoteRes.statusCode).toBe(200);
    expect(lastMethod).toBe('POST');
    expect(lastPath).toBe('/api/admin/files/f1/toc/promote-auto');
    expect(JSON.parse(lastBody)).toEqual({ activate: true });

    const reextractRes = await app.inject({
      method: 'POST',
      url: '/api/elib/admin/files/f1/toc/reextract',
      headers: {
        'content-type': 'application/json',
        cookie: 'elib_session=admin-token',
        origin: 'https://smartrail.local:8443',
        host: 'smartrail.local:8443'
      },
      payload: '{}'
    });
    expect(reextractRes.statusCode).toBe(200);
    expect(lastMethod).toBe('POST');
    expect(lastPath).toBe('/api/admin/files/f1/toc/reextract');
  });

  it('truyền nguyên trạng lỗi 403 / 400 / 409 từ upstream', async () => {
    const r403 = await app.inject({ method: 'GET', url: '/api/elib/admin/files/forbidden-file/toc' });
    expect(r403.statusCode).toBe(403);
    expect(r403.json().error.code).toBe('FORBIDDEN');

    const r400 = await app.inject({
      method: 'PUT',
      url: '/api/elib/admin/files/bad-file/toc/manual',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ nodes: [] })
    });
    expect(r400.statusCode).toBe(400);
    expect(r400.json().error.code).toBe('INVALID_PAGE_RANGE');

    const r409 = await app.inject({
      method: 'POST',
      url: '/api/elib/admin/files/processing-file/toc/reextract',
      headers: { 'content-type': 'application/json' },
      payload: '{}'
    });
    expect(r409.statusCode).toBe(409);
    expect(r409.json().error.code).toBe('TOC_ALREADY_PROCESSING');
  });

  it('method sai trên 6 route admin TOC bị chặn 404 ELIB_ROUTE_NOT_FOUND, không forward', async () => {
    const before = hits;
    const blocked: Array<[string, string]> = [
      ['POST', '/api/elib/admin/tocs'],
      ['PUT', '/api/elib/admin/tocs'],
      ['PATCH', '/api/elib/admin/tocs'],
      ['DELETE', '/api/elib/admin/tocs'],
      ['POST', '/api/elib/admin/files/f1/toc'],
      ['PUT', '/api/elib/admin/files/f1/toc'],
      ['PATCH', '/api/elib/admin/files/f1/toc'],
      ['DELETE', '/api/elib/admin/files/f1/toc'],
      ['GET', '/api/elib/admin/files/f1/toc/manual'],
      ['POST', '/api/elib/admin/files/f1/toc/manual'],
      ['PATCH', '/api/elib/admin/files/f1/toc/manual'],
      ['GET', '/api/elib/admin/files/f1/toc/promote-auto'],
      ['PUT', '/api/elib/admin/files/f1/toc/promote-auto'],
      ['PATCH', '/api/elib/admin/files/f1/toc/promote-auto'],
      ['DELETE', '/api/elib/admin/files/f1/toc/promote-auto'],
      ['GET', '/api/elib/admin/files/f1/toc/reextract'],
      ['PUT', '/api/elib/admin/files/f1/toc/reextract'],
      ['PATCH', '/api/elib/admin/files/f1/toc/reextract'],
      ['DELETE', '/api/elib/admin/files/f1/toc/reextract']
    ];
    for (const [method, url] of blocked) {
      const res = await app.inject({ method: method as never, url });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.json().error.code).toBe('ELIB_ROUTE_NOT_FOUND');
    }
    expect(hits).toBe(before);
  });

  it('route gần giống với route admin TOC bị chặn 404 ELIB_ROUTE_NOT_FOUND, không forward', async () => {
    const before = hits;
    const blocked: Array<[string, string]> = [
      ['GET', '/api/elib/admin/tocs/extra'],
      ['GET', '/api/elib/admin/toc'],
      ['GET', '/api/elib/admin/files/f1'],
      ['GET', '/api/elib/admin/files/f1/toc/extra'],
      ['PUT', '/api/elib/admin/files/f1/toc/manual/extra'],
      ['DELETE', '/api/elib/admin/files/f1/toc/manual/extra'],
      ['POST', '/api/elib/admin/files/f1/toc/promote-auto/extra'],
      ['POST', '/api/elib/admin/files/f1/toc/reextract/extra'],
      ['POST', '/api/elib/admin/files/f1/toc/delete'],
      ['POST', '/api/elib/admin/files/toc/reextract']
    ];
    for (const [method, url] of blocked) {
      const res = await app.inject({ method: method as never, url });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.json().error.code).toBe('ELIB_ROUTE_NOT_FOUND');
    }
    expect(hits).toBe(before);
  });

  it('path traversal trên route admin TOC bị chặn 400 ELIB_BAD_PATH, không forward', async () => {
    const before = hits;
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
      '/api/elib/admin/files/../tocs',
      '/api/elib/admin/files/%2e%2e/toc',
      '/api/elib/admin/files/f1%2ftoc'
    ]) {
      const res = await rawGet(path);
      expect(res.status, path).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('ELIB_BAD_PATH');
    }
    expect(hits).toBe(before);
  });
});
