import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { StandardsDbClient } from '../src/standards-db/client.js';
import { detailFromDb } from '../src/standards-db/db-detail.js';
import type { StandardDetail } from '../src/types.js';

/**
 * REAL integration run against elib + PostgreSQL (item 6).
 *
 * Gated: skipped unless STANDARDS_LIVE_TEST=1 AND ELIB_BASE_URL +
 * STANDARDS_INTERNAL_TOKEN point at a running elib with migration 003
 * applied. See docs/standards-db-live-test.md for the exact docker
 * commands (dev machine — the sandbox has no Docker/PostgreSQL, so
 * this file is preparation; the live run itself is pending).
 *
 * What it proves end-to-end through the RP client:
 *  (a) detail ingest of real sample payloads (raw stripped),
 *  (b) lookup returns the ingested standards,
 *  (c) two searches ingest without error (search_log row count is
 *      verified by SQL in the runbook — the API does not expose it),
 *  (d) DB detail for TCVN 9143:2012 carries replacedBy 2022.
 */

const liveEnabled =
  process.env.STANDARDS_LIVE_TEST === '1' &&
  Boolean(process.env.ELIB_BASE_URL) &&
  Boolean(process.env.STANDARDS_INTERNAL_TOKEN);

const SAMPLE_DIR = new URL('../../standards-lookup-samples/', import.meta.url);

function loadSampleDetail(file: string): StandardDetail {
  const path = new URL(file, SAMPLE_DIR);
  if (!existsSync(path)) {
    throw new Error(`Sample payload missing: ${path.pathname} (see docs/standards-db-live-test.md)`);
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const data = (parsed.data ?? parsed) as Record<string, unknown>;
  // Whitelist to the StandardDetail shape; `raw` is dropped here and
  // again by the client's payload builder.
  return {
    code: String(data.code),
    name: (data.name as string | null) ?? null,
    englishName: (data.englishName as string | null) ?? null,
    year: (data.year as number | null) ?? null,
    status: (data.status as string | null) ?? null,
    issuedDate: (data.issuedDate as string | null) ?? null,
    effectiveDate: (data.effectiveDate as string | null) ?? null,
    issuingAgency: (data.issuingAgency as string | null) ?? null,
    replacedBy: (data.replacedBy as string | null) ?? null,
    replaces: (data.replaces as string | null) ?? null,
    detailUrl: String(data.detailUrl ?? ''),
    ics: Array.isArray(data.ics) ? (data.ics as string[]) : [],
    source: data.source as StandardDetail['source'],
    attributes: (data.attributes as StandardDetail['attributes']) ?? [],
    relations: (data.relations as StandardDetail['relations']) ?? [],
    raw: {
      page: { title: null, metaDescription: null, heading: null, breadcrumb: [], pageType: 'standard', internalId: null, barcode: null, purchaseUrl: null, detailUrl: '' },
      tables: [], sections: [], lists: [], links: [], documents: [], images: [], embeds: [], forms: [], dataAttributes: [], embeddedData: []
    }
  };
}

describe.skipIf(!liveEnabled)('standards DB — REAL elib + PostgreSQL integration', () => {
  const client = new StandardsDbClient({
    baseUrl: process.env.ELIB_BASE_URL as string,
    token: process.env.STANDARDS_INTERNAL_TOKEN as string,
    timeoutMs: 10_000,
    failureThreshold: 100 // do not let the breaker mask a real failure here
  });

  it('(a)+(b) ingests real detail payloads and lookup returns them', async () => {
    const detail2012 = loadSampleDetail('detail-tcvn-9143-2012.json');
    const detail2022 = loadSampleDetail('detail-tcvn-9143-2022.json');
    const detailIso = loadSampleDetail('detail-iso-9001.json');
    client.ingestDetail(detail2012);
    client.ingestDetail(detail2022);
    client.ingestDetail(detailIso);
    // Ingest is fire-and-forget; give elib a moment to commit.
    await new Promise(resolve => setTimeout(resolve, 1500));

    const found2012 = await client.lookup('TCVN 9143:2012');
    expect(found2012?.standard.normalizedCode).toBe('TCVN9143:2012');
    expect(found2012?.standard.status).toBe('Withdrawn');

    const foundIso = await client.lookup('ISO 9001');
    expect(foundIso?.standard.normalizedCode).toBe('ISO9001:2015');
  }, 30_000);

  it('(d) DB detail for TCVN 9143:2012 has replacedBy 2022', async () => {
    const lookup = await client.lookup('TCVN 9143:2012');
    expect(lookup).not.toBeNull();
    expect(lookup?.replacedBy).toBe('TCVN 9143:2022');
    const detail = detailFromDb(lookup as NonNullable<typeof lookup>, 7);
    expect(detail?.status).toBe('Withdrawn');
    expect(detail?.replacedBy).toBe('TCVN 9143:2022');
  }, 30_000);

  it('(c) two searches ingest cleanly (search_log rows verified by SQL — see runbook)', async () => {
    const detail2022 = loadSampleDetail('detail-tcvn-9143-2022.json');
    const items = [{
      code: detail2022.code,
      name: detail2022.name ?? detail2022.code,
      ...(detail2022.englishName ? { englishName: detail2022.englishName } : {}),
      ...(detail2022.year !== null ? { year: detail2022.year } : {}),
      ...(detail2022.status ? { status: detail2022.status } : {}),
      ics: detail2022.ics,
      source: detail2022.source
    }];
    client.ingestSearch(items, 'TCVN 9143 (live test 1)', true);
    client.ingestSearch(items, 'TCVN 9143 (live test 2)', true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    // Indirect proof the ingests landed: lookup still resolves and the
    // breaker never opened. The exact search_log count (2 new rows)
    // is checked with the SQL in docs/standards-db-live-test.md.
    expect(client.breakerOpen).toBe(false);
    const lookup = await client.lookup('TCVN 9143:2022');
    expect(lookup?.standard.normalizedCode).toBe('TCVN9143:2022');
  }, 30_000);
});
