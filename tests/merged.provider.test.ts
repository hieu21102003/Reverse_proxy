import { describe, expect, it, vi } from 'vitest';
import { VsqiError } from '../src/errors.js';
import { MergedStandardProvider } from '../src/providers/merged.provider.js';
import type { SearchResult, StandardDetail, StandardProvider } from '../src/types.js';

function std(source: 'VSQI' | 'TCVN_VN' | 'TCVN_QT', code: string, name = `Name ${code}`) {
  return { code, name, source };
}

function searchResult(source: 'VSQI' | 'TCVN_VN' | 'TCVN_QT', codes: string[], total: number): SearchResult {
  return {
    data: codes.map(code => std(source, code)),
    pagination: {
      currentPage: 1,
      totalPages: Math.max(1, Math.ceil(total / 20)),
      totalResults: total
    },
    source
  };
}

function stub(overrides: Partial<StandardProvider> = {}): StandardProvider {
  return {
    search: async () => ({ data: [], pagination: { currentPage: 1 }, source: 'VSQI' }),
    getDetail: async () => null,
    ...overrides
  };
}

const detailFor = (code: string, source: 'VSQI' | 'TCVN_VN' | 'TCVN_QT'): StandardDetail => ({
  code,
  name: `Name ${code}`,
  englishName: null,
  year: null,
  status: 'Active',
  issuedDate: null,
  effectiveDate: null,
  issuingAgency: null,
  replacedBy: null,
  replaces: null,
  detailUrl: `https://example.invalid/${encodeURIComponent(code)}`,
  source,
  attributes: [],
  relations: [],
  raw: {
    page: {
      title: null,
      metaDescription: null,
      heading: null,
      breadcrumb: [],
      pageType: 'standard',
      internalId: null,
      barcode: null,
      purchaseUrl: null,
      detailUrl: `https://example.invalid/${encodeURIComponent(code)}`
    },
    tables: [],
    sections: [],
    lists: [],
    links: [],
    documents: [],
    images: [],
    embeds: [],
    forms: [],
    dataAttributes: [],
    embeddedData: []
  }
});

describe('merged search', () => {
  it('returns one list in VSQI, TCVN_VN, TCVN_QT order with summed totals', async () => {
    const provider = new MergedStandardProvider({
      VSQI: stub({ search: async () => searchResult('VSQI', ['TCVN 9143:2022'], 2) }),
      TCVN_VN: stub({ search: async () => searchResult('TCVN_VN', ['TCVN 9143:2022'], 1) }),
      TCVN_QT: stub({ search: async () => searchResult('TCVN_QT', ['ISO 9001'], 2) })
    });
    const result = await provider.search({ query: 'TCVN 9143', page: 1 });
    expect(result.source).toBe('MULTI');
    // Same code in two sources is kept once per source.
    expect(result.data.map(item => `${item.source}:${item.code}`)).toEqual([
      'VSQI:TCVN 9143:2022',
      'TCVN_VN:TCVN 9143:2022',
      'TCVN_QT:ISO 9001'
    ]);
    expect(result.pagination).toEqual({ currentPage: 1, totalResults: 5 });
    expect(result.pagination.totalPages).toBeUndefined();
    expect(result.sources).toEqual([
      { source: 'VSQI', ok: true, totalResults: 2, totalPages: 1 },
      { source: 'TCVN_VN', ok: true, totalResults: 1, totalPages: 1 },
      { source: 'TCVN_QT', ok: true, totalResults: 2, totalPages: 1 }
    ]);
    expect(result.partialFailures).toBeUndefined();
  });

  it('dedups within a source and tolerates one failing source', async () => {
    const provider = new MergedStandardProvider({
      VSQI: stub({
        search: async () => ({
          data: [std('VSQI', 'TCVN 9143:2022'), std('VSQI', 'TCVN 9143:2022')],
          pagination: { currentPage: 1, totalResults: 2 },
          source: 'VSQI' as const
        })
      }),
      TCVN_VN: stub({
        search: async () => {
          throw new VsqiError('TCVN returned HTTP 500', 'UPSTREAM_HTTP_ERROR', 502);
        }
      }),
      TCVN_QT: stub({ search: async () => searchResult('TCVN_QT', ['ISO 9001'], 1) })
    });
    const result = await provider.search({ query: 'x', page: 1 });
    expect(result.data).toHaveLength(2);
    expect(result.partialFailures).toEqual(['TCVN_VN']);
    expect(result.sources?.find(s => s.source === 'TCVN_VN')).toMatchObject({
      ok: false,
      error: 'UPSTREAM_HTTP_ERROR'
    });
    expect(result.pagination.totalResults).toBe(3);
  });

  it('throws 502 only when every source fails', async () => {
    const failing = stub({
      search: async () => {
        throw new VsqiError('Unable to reach upstream', 'UPSTREAM_UNAVAILABLE', 502);
      }
    });
    const provider = new MergedStandardProvider({ VSQI: failing, TCVN_VN: failing, TCVN_QT: failing });
    await expect(provider.search({ query: 'x', page: 1 }))
      .rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', statusCode: 502 });
  });
});

describe('merged detail', () => {
  it('tries VSQI, then TCVN_VN, then TCVN_QT; first hit wins', async () => {
    const getDetailVn = vi.fn(async () => detailFor('ISO 9001', 'TCVN_VN'));
    const getDetailQt = vi.fn(async () => detailFor('ISO 9001', 'TCVN_QT'));
    const provider = new MergedStandardProvider({
      VSQI: stub({ getDetail: async () => null }),
      TCVN_VN: stub({ getDetail: getDetailVn }),
      TCVN_QT: stub({ getDetail: getDetailQt })
    });
    const detail = await provider.getDetail('ISO 9001');
    expect(detail?.source).toBe('TCVN_VN');
    expect(getDetailQt).not.toHaveBeenCalled();
  });

  it('only consults the pinned source when one is given', async () => {
    const getDetailVsqi = vi.fn(async () => detailFor('TCVN 9143:2022', 'VSQI'));
    const getDetailQt = vi.fn(async () => detailFor('TCVN 9143:2022', 'TCVN_QT'));
    const provider = new MergedStandardProvider({
      VSQI: stub({ getDetail: getDetailVsqi }),
      TCVN_VN: stub({ getDetail: async () => null }),
      TCVN_QT: stub({ getDetail: getDetailQt })
    });
    const detail = await provider.getDetail('TCVN 9143:2022', 'TCVN_QT');
    expect(detail?.source).toBe('TCVN_QT');
    expect(getDetailVsqi).not.toHaveBeenCalled();
  });

  it('skips a throwing source and returns null only when no source has it', async () => {
    const provider = new MergedStandardProvider({
      VSQI: stub({
        getDetail: async () => {
          throw new VsqiError('Unable to reach VSQI', 'UPSTREAM_UNAVAILABLE', 502);
        }
      }),
      TCVN_VN: stub({ getDetail: async () => null }),
      TCVN_QT: stub({ getDetail: async () => null })
    });
    await expect(provider.getDetail('TCVN 9999:2099')).resolves.toBeNull();
  });

  it('rethrows when every source throws', async () => {
    const failing = stub({
      getDetail: async () => {
        throw new VsqiError('Unable to reach upstream', 'UPSTREAM_UNAVAILABLE', 502);
      }
    });
    const provider = new MergedStandardProvider({ VSQI: failing, TCVN_VN: failing, TCVN_QT: failing });
    await expect(provider.getDetail('TCVN 9143:2022'))
      .rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });
});
