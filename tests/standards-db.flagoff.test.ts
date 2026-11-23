import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { StandardProvider } from '../src/types.js';

/**
 * With STANDARDS_DB_ENABLED=false (the default), the metadata-DB
 * integration must be completely inert: no internal API calls at all,
 * and search/detail behave exactly as the live-proxy-only service.
 * Env is stubbed before importing the app so config parses the flag.
 */

const provider: StandardProvider = {
  search: async () => ({
    data: [{ code: 'TCVN 9143:2022', name: 'Công trình thủy lợi', year: 2022, ics: [], source: 'TCVN_VN' as const }],
    pagination: { currentPage: 1, totalResults: 1 },
    source: 'MULTI' as const
  }),
  getDetail: async () => ({
    code: 'TCVN 9143:2022',
    name: 'Công trình thủy lợi',
    englishName: null,
    year: 2022,
    status: 'Active',
    issuedDate: null,
    effectiveDate: null,
    issuingAgency: null,
    replacedBy: null,
    replaces: null,
    detailUrl: 'http://tracuu.tcvn.vn/sdomain/front-api/vs-standard/abc',
    ics: [],
    source: 'TCVN_VN' as const,
    attributes: [],
    relations: [],
    raw: {
      page: { title: null, metaDescription: null, heading: null, breadcrumb: [], pageType: 'standard' as const, internalId: null, barcode: null, purchaseUrl: null, detailUrl: '' },
      tables: [], sections: [], lists: [], links: [], documents: [], images: [], embeds: [], forms: [], dataAttributes: [], embeddedData: []
    }
  })
};

describe('STANDARDS_DB_ENABLED=false — no internal calls, behavior unchanged', () => {
  let server: Server;
  let hits = 0;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      hits += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ found: false }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;
    vi.stubEnv('STANDARDS_DB_ENABLED', 'false');
    vi.stubEnv('STANDARDS_INTERNAL_TOKEN', 'should-not-be-used');
    vi.stubEnv('ELIB_BASE_URL', `http://127.0.0.1:${port}`);
    vi.resetModules();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('search + detail never touch the internal API and carry no DB fields', async () => {
    const { createApp } = await import('../src/app.js');
    const app = await createApp(provider);
    try {
      const search = await app.inject({ method: 'GET', url: '/api/v1/standards/search?q=TCVN%209143&page=1' });
      expect(search.statusCode).toBe(200);
      const searchBody = search.json() as { data: Array<Record<string, unknown>> };
      expect(searchBody.data[0]?.fromDb).toBeUndefined();
      expect(searchBody.data[0]?.lastVerifiedAt).toBeUndefined();

      const detail = await app.inject({ method: 'GET', url: '/api/v1/standards/TCVN%209143%3A2022' });
      expect(detail.statusCode).toBe(200);
      const detailBody = detail.json() as { data: Record<string, unknown> };
      expect(detailBody.data.dbInfo).toBeUndefined();

      // Give any (buggy) fire-and-forget call a chance to land.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(hits).toBe(0);
    } finally {
      await app.close();
    }
  });
});
