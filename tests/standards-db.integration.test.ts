import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { StandardsDbClient, type DbLookupResult } from '../src/standards-db/client.js';
import type { StandardDetail, StandardProvider } from '../src/types.js';

/**
 * Standards metadata DB integration (Phase 3) against a stub elib
 * internal API. No live elib/PostgreSQL exists in this sandbox — the
 * stub implements the exact contract of elib's
 * src/routes/internal-standards.ts (token guard, lookup/ingest shapes).
 */

const TOKEN = 'test-internal-token';

interface RecordedRequest {
  method: string;
  path: string;
  token: string | undefined;
  body: Record<string, unknown> | null;
}

interface StubInternal {
  server: Server;
  url: string;
  requests: RecordedRequest[];
  setLookup: (fn: (q: string) => unknown) => void;
  setFail: (fail: boolean) => void;
  setIngestDelayMs: (ms: number) => void;
}

function startStubInternal(): Promise<StubInternal> {
  const requests: RecordedRequest[] = [];
  let lookupFn: (q: string) => unknown = () => ({ found: false });
  let fail = false;
  let ingestDelayMs = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let body: Record<string, unknown> | null = null;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>; } catch { /* empty */ }
      requests.push({
        method: req.method || '',
        path: url.pathname,
        token: req.headers['x-internal-token'] as string | undefined,
        body
      });
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (fail) return send(500, { error: { code: 'BOOM' } });
      if (req.headers['x-internal-token'] !== TOKEN) {
        return send(401, { error: { code: 'INTERNAL_UNAUTHORIZED' } });
      }
      if (req.method === 'GET' && url.pathname === '/internal/standards/lookup') {
        return send(200, lookupFn(url.searchParams.get('q') || ''));
      }
      if (req.method === 'POST' && url.pathname === '/internal/standards/ingest') {
        const items = Array.isArray(body?.items) ? body.items : [];
        const respond = () => send(200, { ok: true, stored: items.length, skipped: 0 });
        if (ingestDelayMs > 0) setTimeout(respond, ingestDelayMs);
        else respond();
        return;
      }
      return send(404, { error: { code: 'ROUTE_NOT_FOUND' } });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number };
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}`,
        requests,
        setLookup: (fn) => { lookupFn = fn; },
        setFail: (value) => { fail = value; },
        setIngestDelayMs: (ms) => { ingestDelayMs = ms; }
      });
    });
  });
}

function lookupPayload(overrides: Partial<DbLookupResult['standard']> = {}): unknown {
  const now = new Date().toISOString();
  const standard = {
    id: 'std-1',
    org: 'TCVN',
    number: '9143',
    part: null,
    year: 2022,
    amendment: null,
    suffix: null,
    normalizedCode: 'TCVN9143:2022',
    baseKey: 'TCVN9143',
    codeDisplay: 'TCVN 9143:2022',
    titleVi: 'Công trình thủy lợi. Tính toán thấm (DB)',
    titleEn: 'Hydraulic structures (DB)',
    status: 'Active',
    issuedDate: '2022-12-21',
    effectiveDate: null,
    ics: ['93.160'],
    detailLevel: 'full',
    parseConfidence: 0.95,
    isAmendment: false,
    needsReview: false,
    lastVerifiedAt: now,
    updatedAt: now,
    ...overrides
  };
  return {
    found: true,
    standard,
    editions: [{
      id: standard.id,
      normalizedCode: standard.normalizedCode,
      baseKey: standard.baseKey,
      codeDisplay: standard.codeDisplay,
      year: standard.year,
      status: standard.status,
      isAmendment: false,
      needsReview: false,
      detailLevel: standard.detailLevel,
      lastVerifiedAt: standard.lastVerifiedAt
    }],
    sources: [{ source: 'TCVN_VN', detailUrl: 'http://tracuu.tcvn.vn/sdomain/front-api/vs-standard/abc', fetchedAt: now }],
    relations: [{
      direction: 'outgoing',
      type: 'replaces',
      toCodeRaw: 'TCVN 9143:2012',
      toNorm: 'TCVN9143:2012',
      toBaseKey: 'TCVN9143',
      toId: 'std-0',
      fromId: 'std-1',
      source: 'TCVN_VN'
    }]
  };
}

function liveDetail(code: string): StandardDetail {
  return {
    code,
    name: 'Tên live',
    englishName: 'Live title',
    year: 2022,
    status: 'Active',
    issuedDate: '2022-12-21',
    effectiveDate: null,
    issuingAgency: null,
    replacedBy: null,
    replaces: 'TCVN 9143:2012',
    detailUrl: 'http://tracuu.tcvn.vn/sdomain/front-api/vs-standard/abc',
    ics: ['93.160'],
    source: 'TCVN_VN',
    attributes: [],
    relations: [],
    raw: {
      page: { title: null, metaDescription: null, heading: null, breadcrumb: [], pageType: 'standard', internalId: null, barcode: null, purchaseUrl: null, detailUrl: '' },
      tables: [], sections: [], lists: [], links: [], documents: [], images: [], embeds: [], forms: [], dataAttributes: [], embeddedData: []
    }
  };
}

describe('standards metadata DB integration (stub elib internal API)', () => {
  let stub: StubInternal | null = null;
  let app: Awaited<ReturnType<typeof createApp>> | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
    if (stub) await new Promise<void>((resolve) => stub?.server.close(() => resolve()));
    stub = null;
  });

  async function makeApp(provider: StandardProvider, clientOptions: Record<string, unknown> = {}) {
    stub = await startStubInternal();
    const client = new StandardsDbClient({
      baseUrl: stub.url,
      token: TOKEN,
      timeoutMs: 2000,
      ...clientOptions
    });
    app = await createApp(provider, { standardsDb: { client, staleDays: 7 } });
    return { stub, client, app };
  }

  it('search: live item enriched from DB, live fields win; ingest fired per source', async () => {
    const provider: StandardProvider = {
      search: async () => ({
        data: [
          { code: 'TCVN 9143:2022', name: 'Tên live thắng', year: 2022, status: 'Active', ics: [], source: 'TCVN_VN' as const },
          { code: 'TCVN 5574:2018', name: 'Kết cấu bê tông', year: 2018, ics: [], source: 'VSQI' as const }
        ],
        pagination: { currentPage: 1, totalResults: 2 },
        source: 'MULTI' as const
      }),
      getDetail: async () => null
    };
    const { stub: s, app: a } = await makeApp(provider);
    s.setLookup(() => lookupPayload());

    const res = await a.inject({ method: 'GET', url: '/api/v1/standards/search?q=TCVN%209143&page=1' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(2);
    const enriched = body.data[0] as Record<string, unknown>;
    expect(enriched.name).toBe('Tên live thắng'); // live wins
    expect(enriched.fromDb).toBe(true);
    expect(typeof enriched.lastVerifiedAt).toBe('string');
    expect(body.data[1]?.fromDb).toBeUndefined();

    // lookup carried the token; ingest grouped by source (2 requests),
    // with query + hadResult, items without `raw`.
    const lookups = s.requests.filter(r => r.path === '/internal/standards/lookup');
    expect(lookups).toHaveLength(1);
    expect(lookups[0]?.token).toBe(TOKEN);
    await new Promise(resolve => setTimeout(resolve, 50));
    const ingests = s.requests.filter(r => r.path === '/internal/standards/ingest');
    expect(ingests.map(r => r.body?.source).sort()).toEqual(['TCVN_VN', 'VSQI']);
    for (const ingest of ingests) {
      expect(ingest.body?.kind).toBe('search');
      expect(ingest.body?.query).toBe('TCVN 9143');
      expect(ingest.body?.hadResult).toBe(true);
      const items = ingest.body?.items as Array<Record<string, unknown>>;
      expect(items.every(item => !('raw' in item))).toBe(true);
    }
  });

  it('search: DB-only top standard is added when live has no matching key', async () => {
    const provider: StandardProvider = {
      search: async () => ({
        data: [{ code: 'TCVN 5574:2018', name: 'Kết cấu bê tông', year: 2018, ics: [], source: 'VSQI' as const }],
        pagination: { currentPage: 1, totalResults: 1 },
        source: 'MULTI' as const
      }),
      getDetail: async () => null
    };
    const { stub: s, app: a } = await makeApp(provider);
    s.setLookup(() => lookupPayload());
    const res = await a.inject({ method: 'GET', url: '/api/v1/standards/search?q=TCVN%209143&page=1' });
    const body = res.json() as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(2);
    expect(body.data[0]?.code).toBe('TCVN 9143:2022');
    expect(body.data[0]?.fromDb).toBe(true);
    expect(body.data[0]?.name).toContain('(DB)');
  });

  it('detail: fresh full DB record is served from DB without calling live provider', async () => {
    let detailCalls = 0;
    const provider: StandardProvider = {
      search: async () => ({ data: [], pagination: { currentPage: 1 }, source: 'MULTI' as const }),
      getDetail: async (code) => { detailCalls += 1; return liveDetail(code); }
    };
    const { stub: s, app: a } = await makeApp(provider);
    s.setLookup(() => lookupPayload());
    const res = await a.inject({ method: 'GET', url: '/api/v1/standards/TCVN%209143%3A2022' });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: StandardDetail }).data;
    expect(detailCalls).toBe(0);
    expect(data.dbInfo?.servedFrom).toBe('db');
    expect(data.dbInfo?.stale).toBe(false);
    expect(data.name).toContain('(DB)');
    expect(data.replaces).toBe('TCVN 9143:2012');
    expect(data.ics).toEqual(['93.160']);
    expect(data.attributes.some(attr => attr.label === 'Mã ICS')).toBe(true);
  });

  it('detail: stale DB record falls back to live, marks stale, and ingests the live detail', async () => {
    let detailCalls = 0;
    const provider: StandardProvider = {
      search: async () => ({ data: [], pagination: { currentPage: 1 }, source: 'MULTI' as const }),
      getDetail: async (code) => { detailCalls += 1; return liveDetail(code); }
    };
    const { stub: s, app: a } = await makeApp(provider);
    const stale = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    s.setLookup(() => lookupPayload({ lastVerifiedAt: stale }));
    const res = await a.inject({ method: 'GET', url: '/api/v1/standards/TCVN%209143%3A2022' });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: StandardDetail }).data;
    expect(detailCalls).toBe(1);
    expect(data.name).toBe('Tên live');
    expect(data.dbInfo?.servedFrom).toBe('live');
    expect(data.dbInfo?.stale).toBe(true);
    expect(data.dbInfo?.lastVerifiedAt).toBe(stale);
    await new Promise(resolve => setTimeout(resolve, 50));
    const ingests = s.requests.filter(r => r.path === '/internal/standards/ingest');
    expect(ingests).toHaveLength(1);
    expect(ingests[0]?.body?.kind).toBe('detail');
    const detail = ingests[0]?.body?.detail as Record<string, unknown>;
    expect(detail.code).toBe('TCVN 9143:2022');
    expect('raw' in detail).toBe(false);
  });

  it('detail: DB miss serves live without dbInfo and still ingests', async () => {
    const provider: StandardProvider = {
      search: async () => ({ data: [], pagination: { currentPage: 1 }, source: 'MULTI' as const }),
      getDetail: async (code) => liveDetail(code)
    };
    const { stub: s, app: a } = await makeApp(provider);
    s.setLookup(() => ({ found: false }));
    const res = await a.inject({ method: 'GET', url: '/api/v1/standards/TCVN%209143%3A2022' });
    const data = (res.json() as { data: StandardDetail }).data;
    expect(data.dbInfo).toBeUndefined();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(s.requests.filter(r => r.path === '/internal/standards/ingest')).toHaveLength(1);
  });

  it('ingest never blocks the search response (slow ingest endpoint)', async () => {
    const provider: StandardProvider = {
      search: async () => ({
        data: [{ code: 'TCVN 9143:2022', name: 'X', year: 2022, ics: [], source: 'TCVN_VN' as const }],
        pagination: { currentPage: 1, totalResults: 1 },
        source: 'MULTI' as const
      }),
      getDetail: async () => null
    };
    const { stub: s, app: a } = await makeApp(provider);
    s.setIngestDelayMs(1500);
    const started = Date.now();
    const res = await a.inject({ method: 'GET', url: '/api/v1/standards/search?q=TCVN%209143&page=1' });
    expect(res.statusCode).toBe(200);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('client: lookup returns null on elib error; breaker opens after consecutive failures', async () => {
    stub = await startStubInternal();
    stub.setFail(true);
    const client = new StandardsDbClient({
      baseUrl: stub.url,
      token: TOKEN,
      timeoutMs: 1000,
      failureThreshold: 3,
      cooldownMs: 60_000
    });
    expect(await client.lookup('TCVN 9143')).toBeNull();
    expect(await client.lookup('TCVN 9143')).toBeNull();
    expect(await client.lookup('TCVN 9143')).toBeNull();
    expect(client.breakerOpen).toBe(true);
    const hits = stub.requests.length;
    expect(await client.lookup('TCVN 9143')).toBeNull();
    expect(stub.requests.length).toBe(hits); // breaker open: no HTTP call
    // Ingest is also paused while open.
    client.ingestSearch([], 'TCVN 9143', false);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(stub.requests.length).toBe(hits);
  });

  it('client: wrong token yields null lookup (401 swallowed)', async () => {
    stub = await startStubInternal();
    const client = new StandardsDbClient({ baseUrl: stub.url, token: 'wrong', timeoutMs: 1000 });
    expect(await client.lookup('TCVN 9143')).toBeNull();
  });
});
