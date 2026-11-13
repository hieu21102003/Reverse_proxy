import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { TcvnVnProvider } from '../src/providers/tcvn-vn.provider.js';
import { TcvnQtProvider } from '../src/providers/tcvn-qt.provider.js';

const BASE = 'http://tracuu.tcvn.vn/sdomain/front-api';

type JsonFn = (url: URL) => Promise<unknown>;

/** Fake TCVN JSON client: records every URL, answers from a handler. */
function fakeClient(handler: JsonFn): { getJson: JsonFn; urls: URL[] } {
  const urls: URL[] = [];
  return {
    urls,
    getJson: async (url: URL) => {
      urls.push(new URL(url.toString()));
      return handler(url);
    }
  };
}

const vnRecord = (di: string, key: string) => ({
  key, di, tn: `Tên ${di}`, ti: `Title ${di}`, up: 'A', fm: '10', pi: '2022-01-01,1/QĐ', rz: null, rx: null, ca: '93.160'
});
const qtRecord = (di: string, key: string) => ({
  key, di, tn: 'Título sintético', ti: `Title ${di}`, dp: '2015-09-00', up: 'A', fm: '29', ca: '03.100.70'
});

const searchPage = (records: unknown[], total: number) => ({ total, offset: 0, limit: 20, data: records });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TcvnVnProvider search', () => {
  it('sends status=A and di for a code query, never tn+ti together', async () => {
    const client = fakeClient(async url => {
      expect(url.searchParams.get('status')).toBe('A');
      expect(url.searchParams.get('di')).toBe('TCVN 9143:2022');
      expect(url.searchParams.has('tn')).toBe(false);
      expect(url.searchParams.has('ti')).toBe(false);
      return searchPage([vnRecord('TCVN 9143:2022', 'key-1')], 1);
    });
    const provider = new TcvnVnProvider(client, BASE);
    const result = await provider.search({ query: 'TCVN 9143:2022', page: 1 });
    expect(result.source).toBe('TCVN_VN');
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.code).toBe('TCVN 9143:2022');
    expect(result.pagination.totalResults).toBe(1);
    expect(result.pagination.totalPages).toBe(1);
    expect(client.urls).toHaveLength(1);
    expect(client.urls[0]?.pathname).toBe('/sdomain/front-api/vs-standard/search');
  });

  it('fans a title query out to tn and ti in parallel and dedups by key', async () => {
    const shared = vnRecord('TCVN 9143:2022', 'key-1');
    const client = fakeClient(async url => {
      const field = url.searchParams.get('tn') ? 'tn' : 'ti';
      expect(url.searchParams.get('status')).toBe('A');
      return searchPage(
        field === 'tn' ? [shared, vnRecord('TCVN 9143:2012', 'key-2')] : [shared],
        field === 'tn' ? 2 : 1
      );
    });
    const provider = new TcvnVnProvider(client, BASE);
    const result = await provider.search({ query: 'Công trình thủy lợi', page: 1 });
    expect(result.data.map(item => item.code)).toEqual(['TCVN 9143:2022', 'TCVN 9143:2012']);
    expect(client.urls).toHaveLength(2);
    expect(client.urls.map(url => url.searchParams.get('tn') ?? url.searchParams.get('ti')).sort())
      .toEqual(['Công trình thủy lợi', 'Công trình thủy lợi']);
  });

  it('still returns the ti results when the tn search fails', async () => {
    const client = fakeClient(async url => {
      if (url.searchParams.has('tn')) {
        throw new Error('tn upstream down');
      }
      return searchPage([vnRecord('TCVN 1:2020', 'key-1')], 1);
    });
    const provider = new TcvnVnProvider(client, BASE);
    const result = await provider.search({ query: 'Tiêu chuẩn', page: 1 });
    expect(result.data.map(item => item.code)).toEqual(['TCVN 1:2020']);
  });

  it('throws PROVIDER_DISABLED when TCVN is disabled', async () => {
    const original = config.TCVN_ENABLED;
    (config as { TCVN_ENABLED: string }).TCVN_ENABLED = 'false';
    try {
      const provider = new TcvnVnProvider(fakeClient(async () => searchPage([], 0)), BASE);
      await expect(provider.search({ query: 'TCVN 9143', page: 1 }))
        .rejects.toMatchObject({ code: 'PROVIDER_DISABLED', statusCode: 503 });
    } finally {
      (config as { TCVN_ENABLED: string }).TCVN_ENABLED = original;
    }
  });
});

describe('TcvnVnProvider detail', () => {
  it('finds the record by search, then fetches it by key', async () => {
    const client = fakeClient(async url => {
      if (url.pathname.endsWith('/vs-standard/search')) {
        return searchPage([vnRecord('TCVN 9143:2022', 'key-1')], 1);
      }
      expect(url.pathname).toBe('/sdomain/front-api/vs-standard/key-1');
      return vnRecord('TCVN 9143:2022', 'key-1');
    });
    const provider = new TcvnVnProvider(client, BASE);
    const detail = await provider.getDetail('TCVN 9143:2022');
    expect(detail?.code).toBe('TCVN 9143:2022');
    expect(detail?.source).toBe('TCVN_VN');
    expect(client.urls).toHaveLength(2);
  });

  it('returns null without a detail fetch when the code is not found', async () => {
    const client = fakeClient(async () => searchPage([], 0));
    const provider = new TcvnVnProvider(client, BASE);
    await expect(provider.getDetail('TCVN 9999:2099')).resolves.toBeNull();
    expect(client.urls).toHaveLength(1);
  });
});

describe('TcvnQtProvider search', () => {
  it('sends a real orgCode and status=A for a code query, never ALL', async () => {
    const client = fakeClient(async url => {
      expect(url.searchParams.get('orgCode')).toBe('ISO');
      expect(url.searchParams.get('status')).toBe('A');
      expect(url.searchParams.get('di')).toBe('ISO 9001');
      return searchPage([qtRecord('ISO 9001', 'k-iso')], 1);
    });
    const provider = new TcvnQtProvider(client, BASE, ['ISO']);
    const result = await provider.search({ query: 'ISO 9001', page: 1 });
    expect(result.source).toBe('TCVN_QT');
    expect(result.data).toHaveLength(1);
    expect(client.urls).toHaveLength(1);
  });

  it('fans a title query out across the enabled orgs with ti', async () => {
    const client = fakeClient(async url => {
      expect(url.searchParams.get('status')).toBe('A');
      expect(url.searchParams.get('ti')).toBe('Quality');
      const org = url.searchParams.get('orgCode') as string;
      return searchPage(org === 'ISO' ? [qtRecord('ISO 9001', 'k-iso')] : [], org === 'ISO' ? 1 : 0);
    });
    const provider = new TcvnQtProvider(client, BASE, ['ISO', 'IEC', 'ASTM']);
    const result = await provider.search({ query: 'Quality', page: 1 });
    expect(result.data.map(item => item.code)).toEqual(['ISO 9001']);
    expect(client.urls.map(url => url.searchParams.get('orgCode')).sort())
      .toEqual(['ASTM', 'IEC', 'ISO']);
    expect(result.pagination.totalResults).toBe(1);
  });

  it('dedups a record returned under several organisations', async () => {
    const shared = qtRecord('EN ISO 9001', 'k-en-iso');
    const client = fakeClient(async () => searchPage([shared], 1));
    const provider = new TcvnQtProvider(client, BASE, ['EN', 'ISO']);
    const result = await provider.search({ query: 'Quality', page: 1 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.code).toBe('EN ISO 9001');
  });

  it('returns the surviving organisations when one of them fails', async () => {
    const client = fakeClient(async url => {
      if (url.searchParams.get('orgCode') === 'IEC') {
        throw new Error('IEC upstream down');
      }
      return searchPage([qtRecord('ISO 9001', 'k-iso')], 1);
    });
    const provider = new TcvnQtProvider(client, BASE, ['ISO', 'IEC']);
    const result = await provider.search({ query: 'Quality', page: 1 });
    expect(result.data.map(item => item.code)).toEqual(['ISO 9001']);
  });

  it('answers TCVN codes empty without any network call', async () => {
    const client = fakeClient(async () => searchPage([qtRecord('ISO 9001', 'k-iso')], 1));
    const provider = new TcvnQtProvider(client, BASE, ['ISO']);
    const result = await provider.search({ query: 'TCVN 9143', page: 1 });
    expect(result.data).toEqual([]);
    expect(result.pagination.totalResults).toBe(0);
    expect(client.urls).toHaveLength(0);
  });

  it('fetches the organisation list once and caches it', async () => {
    let orgCalls = 0;
    const client = fakeClient(async url => {
      if (url.pathname.endsWith('/is-organization/all')) {
        orgCalls++;
        return [
          { code: 'ISO', enabled: true },
          { code: 'JISimport', enabled: false },
          { code: 'IEC', enabled: true }
        ];
      }
      return searchPage([], 0);
    });
    const provider = new TcvnQtProvider(client, BASE);
    await provider.search({ query: 'Quality', page: 1 });
    await provider.search({ query: 'Quality', page: 2 });
    expect(orgCalls).toBe(1);
    expect(client.urls.map(url => url.searchParams.get('orgCode')).filter(Boolean).sort())
      .toEqual(['IEC', 'IEC', 'ISO', 'ISO']);
  });
});

describe('TcvnQtProvider detail', () => {
  it('returns null for TCVN codes without any network call', async () => {
    const client = fakeClient(async () => searchPage([], 0));
    const provider = new TcvnQtProvider(client, BASE, ['ISO']);
    await expect(provider.getDetail('TCVN 9143:2022')).resolves.toBeNull();
    expect(client.urls).toHaveLength(0);
  });

  it('finds an ISO record by search, then fetches it by key', async () => {
    const client = fakeClient(async url => {
      if (url.pathname.endsWith('/is-standard/search')) {
        expect(url.searchParams.get('orgCode')).toBe('ISO');
        return searchPage([qtRecord('ISO 9001', 'k-iso')], 1);
      }
      expect(url.pathname).toBe('/sdomain/front-api/is-standard/k-iso');
      return qtRecord('ISO 9001', 'k-iso');
    });
    const provider = new TcvnQtProvider(client, BASE, ['ISO']);
    const detail = await provider.getDetail('ISO 9001');
    expect(detail?.code).toBe('ISO 9001');
    expect(detail?.source).toBe('TCVN_QT');
    expect(detail?.year).toBe(2015);
  });
});
