import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  IngestRequestSchema,
  IngestResponseSchema,
  LookupResponseSchema
} from '../src/standards-db/contract.js';
import { StandardsDbClient } from '../src/standards-db/client.js';
import { detailFromDb } from '../src/standards-db/db-detail.js';
import type { Standard, StandardDetail } from '../src/types.js';

/**
 * Shared contract tests (item 5): the JSON fixture is validated
 * against the zod schemas mirrored from elib
 * (src/standards-db/contract.ts), and everything the RP client sends
 * or accepts is checked against the same schemas — replacing the old
 * hand-rolled stub shapes that could drift silently.
 */

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/standards-contract.json', import.meta.url), 'utf8')
) as Record<string, unknown>;

describe('shared contract fixture validates against contract schemas', () => {
  it('multi-source search ingest request', () => {
    const parsed = IngestRequestSchema.safeParse(fixture.ingestSearchMultiSource);
    expect(parsed.success).toBe(true);
  });

  it('detail ingest request', () => {
    const parsed = IngestRequestSchema.safeParse(fixture.ingestDetail);
    expect(parsed.success).toBe(true);
  });

  it('ingest response', () => {
    expect(IngestResponseSchema.safeParse(fixture.ingestResponse).success).toBe(true);
  });

  it('lookup found (relations + replacedBy + editions with titles)', () => {
    const parsed = LookupResponseSchema.safeParse(fixture.lookupFound);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.found) {
      expect(parsed.data.replacedBy).toBe('TCVN 9143:2022');
      expect(parsed.data.replaces).toEqual(['14 TCN 58-88']);
      expect(parsed.data.editions.every(edition => typeof edition.titleVi === 'string')).toBe(true);
    }
  });

  it('lookup not found', () => {
    expect(LookupResponseSchema.safeParse(fixture.lookupNotFound).success).toBe(true);
  });
});

describe('RP client speaks the contract', () => {
  function captureFetch(responseBody: unknown) {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : null
      });
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }) as typeof fetch;
    return { calls, fetchFn };
  }

  const items: Standard[] = [
    { code: 'TCVN 9143:2022', name: 'Tên VN', year: 2022, status: 'Active', ics: ['93.160'], source: 'TCVN_VN' },
    { code: 'TCVN 5574:2018', name: 'Tên VSQI', year: 2018, ics: [], source: 'VSQI' }
  ];

  it('ingestSearch sends ONE multi-source request that validates', async () => {
    const { calls, fetchFn } = captureFetch(fixture.ingestResponse);
    const client = new StandardsDbClient({ baseUrl: 'http://elib.test', token: 't', fetchFn });
    client.ingestSearch(items, 'TCVN 9143', true);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(calls).toHaveLength(1);
    const body = calls[0]?.body as Record<string, unknown>;
    expect(IngestRequestSchema.safeParse(body).success).toBe(true);
    expect(body.kind).toBe('search');
    const sources = body.sources as Array<{ source: string; items: unknown[] }>;
    expect(sources.map(group => group.source).sort()).toEqual(['TCVN_VN', 'VSQI']);
    expect(body.query).toBe('TCVN 9143');
    expect(body.hadResult).toBe(true);
  });

  it('ingestSearch with zero items still sends one request (search_log row)', async () => {
    const { calls, fetchFn } = captureFetch(fixture.ingestResponse);
    const client = new StandardsDbClient({ baseUrl: 'http://elib.test', token: 't', fetchFn });
    client.ingestSearch([], 'không có kết quả', false);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(calls).toHaveLength(1);
    expect(IngestRequestSchema.safeParse(calls[0]?.body).success).toBe(true);
  });

  it('ingestDetail sends a validating single-source request without raw', async () => {
    const { calls, fetchFn } = captureFetch(fixture.ingestResponse);
    const client = new StandardsDbClient({ baseUrl: 'http://elib.test', token: 't', fetchFn });
    const detail: StandardDetail = {
      code: 'TCVN 9143:2012',
      name: 'Công trình thủy lợi',
      englishName: 'Hydraulic structures',
      year: 2012,
      status: 'Withdrawn',
      issuedDate: '2012-12-27',
      effectiveDate: null,
      issuingAgency: null,
      replacedBy: 'TCVN 9143:2022',
      replaces: '14 TCN 58-88',
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
    client.ingestDetail(detail);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(calls).toHaveLength(1);
    const body = calls[0]?.body as { detail?: Record<string, unknown> };
    expect(IngestRequestSchema.safeParse(body).success).toBe(true);
    expect(body.detail && 'raw' in body.detail).toBe(false);
  });

  it('lookup parses a contract response; drifted response yields null', async () => {
    const good = captureFetch(fixture.lookupFound);
    const client = new StandardsDbClient({ baseUrl: 'http://elib.test', token: 't', fetchFn: good.fetchFn });
    const result = await client.lookup('TCVN 9143:2012');
    expect(result?.standard.normalizedCode).toBe('TCVN9143:2012');
    expect(result?.replacedBy).toBe('TCVN 9143:2022');
    expect(result?.editions).toHaveLength(2);

    const drifted = captureFetch({ found: true, standard: { normalizedCode: 'X' } });
    const client2 = new StandardsDbClient({ baseUrl: 'http://elib.test', token: 't', fetchFn: drifted.fetchFn });
    expect(await client2.lookup('TCVN 9143:2012')).toBeNull();
  });

  it('detailFromDb: TCVN 9143:2012 from DB shows Withdrawn + replacedBy 2022', async () => {
    const { fetchFn } = captureFetch(fixture.lookupFound);
    const client = new StandardsDbClient({ baseUrl: 'http://elib.test', token: 't', fetchFn });
    const lookup = await client.lookup('TCVN 9143:2012');
    expect(lookup).not.toBeNull();
    const detail = detailFromDb(lookup as NonNullable<typeof lookup>, 7);
    expect(detail?.status).toBe('Withdrawn');
    expect(detail?.replacedBy).toBe('TCVN 9143:2022');
    expect(detail?.replaces).toBe('14 TCN 58-88');
    expect(detail?.dbInfo?.servedFrom).toBe('db');
    const replacedByRelation = detail?.relations.find(relation => relation.type === 'replacedBy');
    expect(replacedByRelation?.code).toBe('TCVN 9143:2022');
  });
});
