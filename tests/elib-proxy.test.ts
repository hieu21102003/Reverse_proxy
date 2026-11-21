import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { StandardProvider } from '../src/types.js';

const provider: StandardProvider = {
  search: async () => ({
    data: [{ code: 'TCVN 9143:2022', name: 'Công trình thủy lợi', source: 'TCVN_VN' as const }],
    pagination: { currentPage: 1, totalResults: 1 },
    source: 'MULTI' as const
  }),
  getDetail: async () => null
};

const FILE_MARKER = 'ELIB-STUB-FILE-CONTENT-0123456789';
const DOWNLOAD_BYTES = Buffer.from('%PDF-1.4 stub-download-bytes');

function startStubElib(): Promise<{ server: Server; url: string; lastUpload: { bytes: number; sha256: string; contentType: string; hasMarker: boolean } | null }> {
  const state: { lastUpload: { bytes: number; sha256: string; contentType: string; hasMarker: boolean } | null } = { lastUpload: null };
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const sendJson = (status: number, payload: unknown, extraHeaders: Record<string, string | string[]> = {}) => {
      const body = JSON.stringify(payload);
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extraHeaders });
      res.end(body);
    };

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(200, { status: 'ok', service: 'elib-stub' });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        let parsed: { email?: string; password?: string } = {};
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* ignore */ }
        if (parsed.email === 'admin@congty.vn' && parsed.password === 'MatKhauManh') {
          return sendJson(200, { user: { id: 'u1', email: parsed.email, role: 'admin', displayName: 'Admin' } }, {
            'set-cookie': [
              'elib_session=good-token; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800',
              'elib_probe=1; Path=/'
            ]
          });
        }
        return sendJson(401, { error: { code: 'UNAUTHORIZED', message: 'Email hoặc mật khẩu không đúng' } });
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      return sendJson(200, { ok: true }, { 'set-cookie': 'elib_session=; HttpOnly; Path=/; Max-Age=0' });
    }
    if (req.method === 'GET' && url.pathname === '/api/auth/me') {
      const cookie = req.headers.cookie || '';
      if (cookie.includes('elib_session=good-token')) {
        return sendJson(200, { user: { id: 'u1', email: 'admin@congty.vn', role: 'admin', displayName: 'Admin' } });
      }
      return sendJson(401, { error: { code: 'UNAUTHORIZED', message: 'Bạn cần đăng nhập để thực hiện thao tác này' } });
    }
    if (req.method === 'GET' && url.pathname === '/api/categories') {
      return sendJson(200, {
        data: [{ id: 'c1', parent_id: null, name: 'Hạ tầng đường sắt', children: [{ id: 'c2', parent_id: 'c1', name: 'Thiết kế hạ tầng', children: [] }] }],
        flat: [
          { id: 'c1', parent_id: null, name: 'Hạ tầng đường sắt' },
          { id: 'c2', parent_id: 'c1', name: 'Thiết kế hạ tầng' }
        ],
        probe: url.searchParams.get('probe')
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/documents') {
      const hash = createHash('sha256');
      let bytes = 0;
      let hasMarker = false;
      req.on('data', (c: Buffer) => {
        bytes += c.length;
        hash.update(c);
        if (c.toString('utf8').includes(FILE_MARKER)) hasMarker = true;
      });
      req.on('end', () => {
        state.lastUpload = { bytes, sha256: hash.digest('hex'), contentType: String(req.headers['content-type'] || ''), hasMarker };
        return sendJson(201, {
          document: { id: 'd1', title: 'Tài liệu stub', slug: 'tai-lieu-stub' },
          file: { id: 'f1', document_id: 'd1', version: 1, original_filename: 'stub.pdf', mime_type: 'application/pdf', file_size: bytes },
          tags: []
        });
      });
      return;
    }
    const downloadMatch = url.pathname.match(/^\/api\/documents\/([^/]+)\/files\/([^/]+)\/download$/);
    if (req.method === 'GET' && downloadMatch) {
      res.writeHead(200, {
        'content-type': 'application/pdf',
        'content-disposition': "attachment; filename*=UTF-8''stub%20file.pdf",
        'content-length': String(DOWNLOAD_BYTES.length)
      });
      return res.end(DOWNLOAD_BYTES);
    }
    return sendJson(404, { error: { code: 'ROUTE_NOT_FOUND', message: 'Không tìm thấy đường dẫn' } });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${address.port}`, lastUpload: state.lastUpload });
    });
    // Expose live state for assertions.
    (server as unknown as { __state: typeof state }).__state = state;
  });
}

describe('Elib proxy (/api/elib/*)', () => {
  let stub: Awaited<ReturnType<typeof startStubElib>>;
  let app: Awaited<ReturnType<typeof createApp>>;
  let base = '';

  beforeAll(async () => {
    stub = await startStubElib();
    app = await createApp(provider, { elib: { baseUrl: stub.url, enabled: true, timeoutMs: 5000 } });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as { port: number };
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve) => stub.server.close(() => resolve()));
  });

  it('passes GET through with query string preserved', async () => {
    const res = await fetch(`${base}/api/elib/categories?probe=hello`);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { probe: string; flat: unknown[] };
    expect(payload.probe).toBe('hello');
    expect(payload.flat).toHaveLength(2);
  });

  it('forwards login JSON, returns Set-Cookie, and forwards Cookie on /me', async () => {
    const login = await fetch(`${base}/api/elib/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@congty.vn', password: 'MatKhauManh' })
    });
    expect(login.status).toBe(200);
    const cookies = login.headers.getSetCookie();
    expect(cookies.join(';')).toContain('elib_session=good-token');
    expect(cookies.join(';')).toContain('elib_probe=1');
    const loginBody = (await login.json()) as { user: { role: string } };
    expect(loginBody.user.role).toBe('admin');

    const me = await fetch(`${base}/api/elib/auth/me`, { headers: { cookie: 'elib_session=good-token' } });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { user: { email: string } };
    expect(meBody.user.email).toBe('admin@congty.vn');

    const anon = await fetch(`${base}/api/elib/auth/me`);
    expect(anon.status).toBe(401);
    const anonBody = (await anon.json()) as { error: { message: string } };
    expect(anonBody.error.message).toContain('đăng nhập');
  });

  it('streams multipart upload bytes with boundary intact', async () => {
    const form = new FormData();
    form.append('file', new Blob([FILE_MARKER], { type: 'application/pdf' }), 'stub.pdf');
    form.append('title', 'Tài liệu stub');
    const res = await fetch(`${base}/api/elib/documents`, {
      method: 'POST',
      headers: { cookie: 'elib_session=good-token' },
      body: form
    });
    expect(res.status).toBe(201);
    const payload = (await res.json()) as { document: { id: string }; file: { id: string } };
    expect(payload.document.id).toBe('d1');
    expect(payload.file.id).toBe('f1');
    const state = (stub.server as unknown as { __state: { lastUpload: { bytes: number; contentType: string; hasMarker: boolean } | null } }).__state;
    expect(state.lastUpload).not.toBeNull();
    expect(state.lastUpload?.hasMarker).toBe(true);
    expect(state.lastUpload?.contentType).toContain('multipart/form-data; boundary=');
    expect(state.lastUpload?.bytes).toBeGreaterThan(FILE_MARKER.length);
  });

  it('streams downloads with Content-Disposition passthrough', async () => {
    const res = await fetch(`${base}/api/elib/documents/d1/files/f1/download`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain("filename*=UTF-8''stub%20file.pdf");
    expect(res.headers.get('content-type')).toContain('application/pdf');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.equals(DOWNLOAD_BYTES)).toBe(true);
  });

  it('keeps standards routes unaffected', async () => {
    const res = await fetch(`${base}/api/v1/standards/search?q=TCVN%209143&page=1`);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { data: Array<{ code: string }> };
    expect(payload.data[0]?.code).toBe('TCVN 9143:2022');
  });

  it('returns 502 ELIB_UNAVAILABLE when elib is down', async () => {
    // Reserve then release a port so nothing listens there.
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
    const deadPort = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const downApp = await createApp(provider, { elib: { baseUrl: `http://127.0.0.1:${deadPort}`, enabled: true, timeoutMs: 3000 } });
    try {
      const res = await downApp.inject({ method: 'GET', url: '/api/elib/auth/me' });
      expect(res.statusCode).toBe(502);
      expect(res.json().error.code).toBe('ELIB_UNAVAILABLE');
      expect(res.json().error.message).toContain('elib');
      // Standards search still works while elib is down.
      const search = await downApp.inject({ method: 'GET', url: '/api/v1/standards/search?q=TCVN%209143&page=1' });
      expect(search.statusCode).toBe(200);
    } finally {
      await downApp.close();
    }
  });

  it('returns 503 ELIB_DISABLED when ELIB_ENABLED=false', async () => {
    const offApp = await createApp(provider, { elib: { baseUrl: stub.url, enabled: false, timeoutMs: 3000 } });
    try {
      const res = await offApp.inject({ method: 'GET', url: '/api/elib/categories' });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('ELIB_DISABLED');
    } finally {
      await offApp.close();
    }
  });
});
