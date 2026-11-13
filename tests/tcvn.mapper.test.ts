import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  detectQtOrg,
  isTcvnCodeQuery,
  mapTcvnDetail,
  mapTcvnSearchRecord,
  parseTcvnOrgList,
  parseTcvnSearchResponse,
  tcvnStatus,
  tcvnYear
} from '../src/providers/tcvn.mapper.js';

const BASE = 'http://tracuu.tcvn.vn/sdomain/front-api';

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf-8'));
}

describe('TCVN search mapping (Vietnamese)', () => {
  it('maps the verified TCVN 9143:2022 record', () => {
    const page = parseTcvnSearchResponse(loadFixture('tcvn-vs-search.json'));
    expect(page.total).toBe(1);
    expect(page.records).toHaveLength(1);

    const item = mapTcvnSearchRecord(page.records[0] as Record<string, unknown>, 'VN', BASE);
    expect(item).toMatchObject({
      code: 'TCVN 9143:2022',
      name: 'Công trình thủy lợi. Tính toán thấm dưới đáy và vai công trình trên nền không phải là đá',
      englishName: 'Hydraulic structures - Seepage analysis through non-rock foundation and around abutments of hydraulic structures',
      year: 2022,
      status: 'Active',
      source: 'TCVN_VN'
    });
    expect(item?.detailUrl).toBe(
      `${BASE}/vs-standard/39000c60-b330-11ed-a08f-d37f51aafcd9`
    );
  });

  it('rejects a search response with an unexpected structure', () => {
    expect(() => parseTcvnSearchResponse({ data: 'nope' })).toThrowError(/unexpected structure/i);
    expect(() => parseTcvnSearchResponse(null)).toThrowError(/unexpected structure/i);
  });
});

describe('TCVN search mapping (international)', () => {
  it('maps ISO 9001 and EN ISO 9001 without using the Spanish tn as a name', () => {
    const page = parseTcvnSearchResponse(loadFixture('tcvn-is-search.json'));
    expect(page.total).toBe(2);

    const items = page.records.map(record =>
      mapTcvnSearchRecord(record as Record<string, unknown>, 'QT', BASE)
    );
    expect(items[0]).toMatchObject({
      code: 'ISO 9001',
      name: 'Quality management systems - Requirements',
      englishName: 'Quality management systems - Requirements',
      year: 2015,
      status: 'Active',
      source: 'TCVN_QT'
    });
    expect(JSON.stringify(items[0])).not.toContain('Sistemas');
    expect(items[0]?.detailUrl).toBe(`${BASE}/is-standard/ISO-ISO%209001-DE_242367583`);
    expect(items[1]?.code).toBe('EN ISO 9001');
    expect(items[1]?.year).toBe(2015);
  });

  it('maps H to Withdrawn and parses the year from dp', () => {
    const record = { di: 'ISO 9001', ti: 'Quality management systems', dp: '2008-11-00', up: 'H', key: 'k' };
    const item = mapTcvnSearchRecord(record, 'QT', BASE);
    expect(item?.status).toBe('Withdrawn');
    expect(item?.year).toBe(2008);
  });

  it('returns null for a record without a code', () => {
    expect(mapTcvnSearchRecord({ ti: 'No code here' }, 'QT', BASE)).toBeNull();
  });
});

describe('TCVN detail mapping', () => {
  it('whitelists fields into attributes/relations and keeps raw minimal', () => {
    const detail = mapTcvnDetail(
      {
        key: '39000c60-b330-11ed-a08f-d37f51aafcd9',
        di: 'TCVN 9143:2022',
        tn: 'Công trình thủy lợi',
        ti: 'Hydraulic structures',
        up: 'A',
        fm: '60',
        pi: '2022-12-21,2593/QĐ-BKHCN',
        rz: 'TCVN 9143:2012',
        rx: null,
        ii: 'ISO 7726',
        ca: '93.160'
      },
      'VN',
      BASE
    );
    expect(detail?.code).toBe('TCVN 9143:2022');
    expect(detail?.source).toBe('TCVN_VN');
    expect(detail?.year).toBe(2022);
    expect(detail?.status).toBe('Active');
    expect(detail?.issuedDate).toBe('2022-12-21');
    expect(detail?.replaces).toBe('TCVN 9143:2012');
    expect(detail?.replacedBy).toBeNull();
    expect(detail?.detailUrl).toBe(`${BASE}/vs-standard/39000c60-b330-11ed-a08f-d37f51aafcd9`);
    expect(detail?.attributes.map(a => a.label)).toContain('Số hiệu');
    expect(detail?.attributes.map(a => a.label)).toContain('Thay thế cho');
    expect(detail?.relations.map(r => r.type)).toContain('replaces');
    expect(detail?.relations.map(r => r.type)).toContain('ics');
    expect(detail?.raw.page.internalId).toBe('39000c60-b330-11ed-a08f-d37f51aafcd9');
    expect(detail?.raw.tables).toEqual([]);
    expect(detail?.raw.embeddedData).toEqual([]);
    // The raw section never carries the upstream JSON: only the key and
    // detail URL (plus the display title) are there — no decision number,
    // no replaces value, no internal fields.
    expect(JSON.stringify(detail?.raw)).not.toContain('2593');
    expect(JSON.stringify(detail?.raw)).not.toContain('TCVN 9143:2012');
    expect(JSON.stringify(detail?.raw)).not.toContain('updatedBy');
  });
});

describe('TCVN query routing', () => {
  it('detects the QT organisation from a code prefix', () => {
    expect(detectQtOrg('ISO 9001')).toBe('ISO');
    expect(detectQtOrg('EN ISO 9001')).toBe('EN');
    expect(detectQtOrg('DIN EN ISO 9001')).toBe('DIN');
    expect(detectQtOrg('GB/T 19001')).toBe('TCTQ/GB');
    expect(detectQtOrg('ASTM E8/E8M')).toBe('ASTM');
    expect(detectQtOrg('BS EN 1234')).toBe('BS');
    // Title queries and unknown prefixes have no organisation.
    expect(detectQtOrg('Quality')).toBeNull();
    expect(detectQtOrg('ISO')).toBeNull();
    expect(detectQtOrg('NF X50-131')).toBeNull();
    // Never the ALL wildcard.
    expect(detectQtOrg('ISO 9001')).not.toBe('ALL');
  });

  it('classifies VN code queries', () => {
    expect(isTcvnCodeQuery('TCVN 9143:2022')).toBe(true);
    expect(isTcvnCodeQuery('TCVN 9143')).toBe(true);
    expect(isTcvnCodeQuery('QCVN 02:2016')).toBe(true);
    expect(isTcvnCodeQuery('9143:2022')).toBe(true);
    expect(isTcvnCodeQuery('Công trình thủy lợi')).toBe(false);
    expect(isTcvnCodeQuery('Hydraulic structures')).toBe(false);
  });

  it('parses the organisation list, dropping disabled entries', () => {
    const orgs = parseTcvnOrgList([
      { code: 'ISO', enabled: true, name: 'ISO', nameEn: 'ISO' },
      { code: 'JISimport', enabled: false, name: 'JISimport', nameEn: 'JISimport' },
      { code: 'BS', enabled: true, name: 'BS', nameEn: 'BS' },
      { code: 'ZZZ', enabled: true, name: 'ZZZ', nameEn: 'ZZZ' },
      { code: 'IEC', enabled: false, name: 'IEC', nameEn: 'IEC' }
    ]);
    expect(orgs).toEqual(['ISO', 'BS', 'ZZZ']);
  });

  it('maps status and year helpers', () => {
    expect(tcvnStatus({ up: 'A' })).toBe('Active');
    expect(tcvnStatus({ up: 'H' })).toBe('Withdrawn');
    expect(tcvnStatus({ up: 'X' })).toBeUndefined();
    expect(tcvnYear({ di: 'TCVN 1:2020' })).toBe(2020);
    expect(tcvnYear({ di: 'ISO 9001', dp: '2015-09-00' })).toBe(2015);
    expect(tcvnYear({ di: 'TCVN 1', pi: '2022-12-21,2593/QĐ-BKHCN' })).toBe(2022);
    expect(tcvnYear({ di: 'ISO 9001' })).toBeUndefined();
  });
});
