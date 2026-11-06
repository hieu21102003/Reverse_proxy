import { config } from '../config.js';
import { VsqiError } from '../errors.js';
import type { SearchInput, SearchResult, StandardDetail, StandardProvider } from '../types.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class ResponseCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly ttlMs = config.CACHE_TTL_SECONDS * 1000,
    private readonly maxEntries = config.CACHE_MAX_ENTRIES
  ) {}

  async getOrLoad<T>(key: string, loader: () => Promise<T>): Promise<T>;
  async getOrLoad<T>(key: string, loader: () => Promise<T | null>): Promise<T | null>;
  async getOrLoad<T>(key: string, loader: () => Promise<T | null>): Promise<T | null> {
    const now = Date.now();
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt > now) {
      this.entries.delete(key);
      this.entries.set(key, entry);
      return structuredClone(entry.value as T);
    }
    if (entry) this.entries.delete(key);

    const pending = this.inFlight.get(key);
    if (pending) return structuredClone(await pending as T | null);

    const request = loader().then(value => {
      if (value !== null && this.ttlMs > 0 && this.maxEntries > 0) {
        while (this.entries.size >= this.maxEntries) {
          const oldestKey = this.entries.keys().next().value as string | undefined;
          if (oldestKey === undefined) break;
          this.entries.delete(oldestKey);
        }
        this.entries.set(key, {
          value: structuredClone(value),
          expiresAt: Date.now() + this.ttlMs
        });
      }
      return value;
    }).finally(() => {
      this.inFlight.delete(key);
    });

    this.inFlight.set(key, request);
    return structuredClone(await request);
  }
}

function normalizeCode(code: string): string {
  return code.trim().replace(/\s+/g, ' ').replace(/\s*:\s*/, ':').toLocaleUpperCase('en');
}

function isSearchResult(value: SearchResult): boolean {
  return value !== null
    && typeof value === 'object'
    && value.source === 'VSQI'
    && Array.isArray(value.data)
    && value.pagination !== null
    && typeof value.pagination === 'object'
    && Number.isInteger(value.pagination.currentPage)
    && (value.pagination.totalPages === undefined || Number.isInteger(value.pagination.totalPages))
    && (value.pagination.totalResults === undefined || Number.isInteger(value.pagination.totalResults))
    && value.data.every(item =>
      item !== null
      && typeof item === 'object'
      && typeof item.code === 'string'
      && item.code.length > 0
      && typeof item.name === 'string'
      && item.name.length > 0
      && (item.englishName === undefined || typeof item.englishName === 'string')
      && (item.year === undefined || Number.isInteger(item.year))
      && (item.status === undefined || typeof item.status === 'string')
      && (item.detailUrl === undefined || typeof item.detailUrl === 'string')
      && item.source === 'VSQI'
    );
}

function isStandardDetail(value: StandardDetail, requestedCode: string): boolean {
  return Boolean(value)
    && typeof value === 'object'
    && value.source === 'VSQI'
    && typeof value.code === 'string'
    && normalizeCode(value.code) === normalizeCode(requestedCode)
    && (typeof value.name === 'string' || value.name === null)
    && (typeof value.englishName === 'string' || value.englishName === null)
    && (typeof value.year === 'number' || value.year === null)
    && (typeof value.status === 'string' || value.status === null)
    && (typeof value.issuedDate === 'string' || value.issuedDate === null)
    && (typeof value.effectiveDate === 'string' || value.effectiveDate === null)
    && (typeof value.issuingAgency === 'string' || value.issuingAgency === null)
    && (typeof value.replacedBy === 'string' || value.replacedBy === null)
    && (typeof value.replaces === 'string' || value.replaces === null)
    && typeof value.detailUrl === 'string';
}

export class CachedStandardProvider implements StandardProvider {
  constructor(
    private readonly provider: StandardProvider,
    private readonly cache = new ResponseCache()
  ) {}

  search(input: SearchInput): Promise<SearchResult> {
    const normalizedQuery = input.query.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
    const key = `search:${JSON.stringify([normalizedQuery, input.page])}`;
    return this.cache.getOrLoad(key, async () => {
      const result = await this.provider.search(input);
      if (!isSearchResult(result)) {
        throw new VsqiError('VSQI search response has an unexpected structure', 'INVALID_UPSTREAM_RESPONSE', 502);
      }
      return result;
    });
  }

  getDetail(code: string): Promise<StandardDetail | null> {
    const normalizedCode = normalizeCode(code);
    const key = `detail:${normalizedCode}`;
    return this.cache.getOrLoad(key, async () => {
      const result = await this.provider.getDetail(normalizedCode);
      if (result !== null && !isStandardDetail(result, normalizedCode)) {
        throw new VsqiError('VSQI detail response has an unexpected structure', 'INVALID_UPSTREAM_RESPONSE', 502);
      }
      return result;
    });
  }
}
