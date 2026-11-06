import { describe, expect, it, vi } from 'vitest';
import { ResponseCache } from '../src/services/response-cache.js';

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
