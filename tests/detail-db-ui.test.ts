import { describe, expect, it } from 'vitest';
import '../public/playground.js';

/**
 * Detail view model: metadata-DB provenance (db) and fallback links
 * replacing the TCVN front-api JSON detailUrl (Phase 3).
 */

interface DbView {
  servedFrom: string;
  lastVerifiedAt: string | null;
  stale: boolean;
  staleDays: number | null;
}

interface DetailViewModel {
  source: { website: string; host: string | null; url: string | null } | null;
  db: DbView | null;
  fallbackLinks: Array<{ kind: string; url: string }>;
  isEmpty: boolean;
}

const detailModel = (globalThis as unknown as {
  __vsqiDetailModel: { buildDetailViewModel: (data: unknown) => DetailViewModel };
}).__vsqiDetailModel;

const baseDetail = {
  code: 'TCVN 9143:2022',
  name: 'Công trình thủy lợi',
  englishName: 'Hydraulic structures',
  year: 2022,
  status: 'Active',
  attributes: [],
  relations: [],
  raw: { page: { pageType: 'standard', detailUrl: '' } }
};

describe('buildDetailViewModel — DB provenance + fallback links', () => {
  it('TCVN front-api detailUrl yields ISO OBP + Google fallbacks, no VSQI link without snapshot', () => {
    const view = detailModel.buildDetailViewModel({
      ...baseDetail,
      source: 'TCVN_VN',
      detailUrl: 'http://tracuu.tcvn.vn/sdomain/front-api/vs-standard/abc'
    });
    expect(view.fallbackLinks.map(link => link.kind)).toEqual(['iso-obp', 'google']);
    expect(view.fallbackLinks[0]?.url).toContain('iso.org/obp');
    expect(view.fallbackLinks[1]?.url).toContain('google.com/search');
    expect(view.fallbackLinks[1]?.url).toContain(encodeURIComponent('TCVN 9143:2022'));
    expect(view.db).toBeNull();
  });

  it('VSQI detailUrl keeps the normal source link and no fallbacks', () => {
    const view = detailModel.buildDetailViewModel({
      ...baseDetail,
      source: 'VSQI',
      detailUrl: 'https://tieuchuan.vsqi.gov.vn/tieuchuan/view?sohieu=TCVN%209143%3A2022'
    });
    expect(view.fallbackLinks).toEqual([]);
    expect(view.source?.host).toBe('tieuchuan.vsqi.gov.vn');
  });

  it('dbInfo passes through; VSQI snapshot adds a VSQI fallback link first', () => {
    const view = detailModel.buildDetailViewModel({
      ...baseDetail,
      source: 'TCVN_VN',
      detailUrl: 'http://tracuu.tcvn.vn/sdomain/front-api/vs-standard/abc',
      dbInfo: {
        servedFrom: 'db',
        lastVerifiedAt: '2026-11-20T00:00:00.000Z',
        stale: false,
        staleDays: 7,
        sources: [
          { source: 'TCVN_VN', detailUrl: 'http://tracuu.tcvn.vn/sdomain/front-api/vs-standard/abc' },
          { source: 'VSQI', detailUrl: 'https://tieuchuan.vsqi.gov.vn/tieuchuan/view?sohieu=TCVN%209143%3A2022' }
        ]
      }
    });
    expect(view.db).toEqual({
      servedFrom: 'db',
      lastVerifiedAt: '2026-11-20T00:00:00.000Z',
      stale: false,
      staleDays: 7
    });
    expect(view.fallbackLinks.map(link => link.kind)).toEqual(['vsqi', 'iso-obp', 'google']);
    expect(view.fallbackLinks[0]?.url).toContain('tieuchuan.vsqi.gov.vn');
  });

  it('stale dbInfo is surfaced for the warning banner', () => {
    const view = detailModel.buildDetailViewModel({
      ...baseDetail,
      source: 'TCVN_VN',
      detailUrl: 'http://tracuu.tcvn.vn/sdomain/front-api/vs-standard/abc',
      dbInfo: {
        servedFrom: 'live',
        lastVerifiedAt: '2026-10-01T00:00:00.000Z',
        stale: true,
        staleDays: 7,
        sources: []
      }
    });
    expect(view.db?.stale).toBe(true);
    expect(view.db?.servedFrom).toBe('live');
  });
});
