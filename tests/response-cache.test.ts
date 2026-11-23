import { describe, expect, it, vi } from 'vitest';
import { CachedStandardProvider, ResponseCache } from '../src/services/response-cache.js';
import type { SearchResult, StandardProvider } from '../src/types.js';

describe('ResponseCache', () => {
  it('coalesces concurrent loads and only caches successful non-null values', async () => {
    const cache = new ResponseCache(1000, 10);
    const loader = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return { result: 'ok' };
    });

    const [first, second] = await Promise.all([
      cache.getOrLoad('key', loader),
      cache.getOrLoad('key', loader)
    ]);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ result: 'ok' });
    expect(second).toEqual(first);
    await cache.getOrLoad('key', loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('expires values after the configured TTL and does not cache null results', async () => {
    const cache = new ResponseCache(5, 10);
    const loader = vi.fn(async () => 'value');
    await cache.getOrLoad('expires', loader);
    await new Promise(resolve => setTimeout(resolve, 10));
    await cache.getOrLoad('expires', loader);
    expect(loader).toHaveBeenCalledTimes(2);

    const missingLoader = vi.fn(async () => null);
    await cache.getOrLoad('missing', missingLoader);
    await cache.getOrLoad('missing', missingLoader);
    expect(missingLoader).toHaveBeenCalledTimes(2);
  });
});

describe('CachedStandardProvider search caching', () => {
  const cleanResult: SearchResult = {
    data: [{ code: 'TCVN 9143:2022', name: 'Công trình thủy lợi', source: 'TCVN_VN' }],
    pagination: { currentPage: 1, totalResults: 1, totalPages: 1 },
    source: 'MULTI',
    sources: [{ source: 'TCVN_VN', ok: true, totalResults: 1 }]
  };
  const partialResult: SearchResult = {
    ...cleanResult,
    partialFailures: ['VSQI']
  };

  function providerReturning(result: SearchResult) {
    const search = vi.fn(async () => result);
    const provider: StandardProvider = { search, getDetail: async () => null };
    return { provider, search };
  }

  it('caches a clean merged result', async () => {
    const { provider, search } = providerReturning(cleanResult);
    const cached = new CachedStandardProvider(provider, new ResponseCache(1000, 10));
    await cached.search({ query: 'TCVN 9143', page: 1 });
    await cached.search({ query: 'TCVN 9143', page: 1 });
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('does not cache a result with partialFailures', async () => {
    const { provider, search } = providerReturning(partialResult);
    const cached = new CachedStandardProvider(provider, new ResponseCache(1000, 10));
    const first = await cached.search({ query: 'TCVN 9143', page: 1 });
    expect(first.partialFailures).toEqual(['VSQI']);
    await cached.search({ query: 'TCVN 9143', page: 1 });
    // Second call must re-fetch upstream instead of serving the partial
    // result from cache for the whole TTL.
    expect(search).toHaveBeenCalledTimes(2);
  });
});
