import { config } from '../config.js';
import { VsqiError } from '../errors.js';
import type { StandardsDbClient, DbLookupResult } from '../standards-db/client.js';
import { detailFromDb, mergeSearchWithDb } from '../standards-db/db-detail.js';
import { lightNormalizeCode } from '../standards-db/light-normalize.js';
import type { SearchInput, SearchResult, StandardDetail, StandardProvider, StandardSource } from '../types.js';

const STANDARD_SOURCES: readonly string[] = ['VSQI', 'TCVN_VN', 'TCVN_QT'];

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

  async getOrLoad<T>(key: string, loader: () => Promise<T>, options?: { shouldCache?: (value: T) => boolean }): Promise<T>;
  async getOrLoad<T>(key: string, loader: () => Promise<T | null>, options?: { shouldCache?: (value: T) => boolean }): Promise<T | null>;
  async getOrLoad<T>(
    key: string,
    loader: () => Promise<T | null>,
    options?: { shouldCache?: (value: T) => boolean }
  ): Promise<T | null> {
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
      if (value !== null && this.ttlMs > 0 && this.maxEntries > 0 && (options?.shouldCache?.(value) ?? true)) {
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
    && (value.source === 'VSQI' || value.source === 'MULTI')
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
      && STANDARD_SOURCES.includes(item.source)
    );
}

function isStandardDetail(value: StandardDetail, requestedCode: string): boolean {
  return Boolean(value)
    && typeof value === 'object'
    && STANDARD_SOURCES.includes(value.source)
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

export interface StandardsDbIntegration {
  client: StandardsDbClient;
  /** Freshness threshold in days (STANDARDS_STALE_DAYS). */
  staleDays: number;
}

/**
 * True when a DB lookup actually describes the requested code (lookup
 * falls back to title trigram matching, which must never serve a
 * detail for a different standard).
 */
function lookupMatchesCode(lookup: DbLookupResult, requestedCode: string): boolean {
  const key = lightNormalizeCode(requestedCode);
  if (!key?.normalized_code) return false;
  const standard = lookup.standard;
  const keyMatches =
    standard.normalizedCode === key.normalized_code ||
    (key.year === null && standard.baseKey === key.base_key);
  // The cached-provider validator compares display codes with its own
  // normalizeCode; a DB record whose display code differs in spacing
  // would fail validation, so only serve when they agree.
  return keyMatches && normalizeCode(standard.codeDisplay) === normalizeCode(requestedCode);
}

/**
 * Cache ↔ live ↔ DB order (STANDARDS_DB_ENABLED on):
 * 1. In-memory response cache (CACHE_TTL_SECONDS, default 300s) — a hit
 *    short-circuits everything below, including DB lookups.
 * 2. Live upstream providers (VSQI + TCVN) — search always runs live
 *    (DB editions are merged into the page); detail is served LIVE
 *    whenever upstream answers.
 * 3. Metadata DB (elib /internal/standards/lookup) — for detail it is
 *    ONLY a fallback: consulted when live fails (upstream error or
 *    not found), and served with dbInfo.servedFrom='db' so the UI can
 *    label it "dữ liệu từ DB, có thể chưa đầy đủ". DB-first serving
 *    (fresh ≤ STANDARDS_STALE_DAYS) was removed 2026-11-23; the
 *    threshold now only drives the stale-data warning. Revisit DB
 *    priority only once lookup payloads are complete.
 * Live results are ingested back fire-and-forget (ONE multi-source
 * ingest request per results page, one per detail; `raw` never sent);
 * ingest never blocks or fails a response. With the flag off, none of
 * this runs and behavior is identical to the live-proxy-only service.
 */
export class CachedStandardProvider implements StandardProvider {
  constructor(
    private readonly provider: StandardProvider,
    private readonly cache = new ResponseCache(),
    private readonly standardsDb?: StandardsDbIntegration
  ) {}

  search(input: SearchInput): Promise<SearchResult> {
    const normalizedQuery = input.query.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
    const key = `search:${JSON.stringify([normalizedQuery, input.page])}`;
    return this.cache.getOrLoad(key, async () => {
      const db = this.standardsDb;
      const looksLikeCode = db !== undefined && lightNormalizeCode(input.query)?.normalized_code != null;
      const [result, lookup] = await Promise.all([
        this.provider.search(input),
        looksLikeCode && db ? db.client.lookup(input.query) : Promise.resolve(null)
      ]);
      if (!isSearchResult(result)) {
        throw new VsqiError('VSQI search response has an unexpected structure', 'INVALID_UPSTREAM_RESPONSE', 502);
      }
      const merged = mergeSearchWithDb(result, lookup);
      if (db) {
        // Fire-and-forget: ingest the LIVE items of this page (never
        // DB-added ones) so elib can upsert + write search_log.
        db.client.ingestSearch(result.data, input.query, merged.data.length > 0);
      }
      return merged;
    }, {
      // A partial result (some source failed) must not be cached: one
      // transient upstream outage would otherwise hide that source's
      // records for the whole TTL.
      shouldCache: result => !result.partialFailures || result.partialFailures.length === 0
    });
  }

  getDetail(code: string, source?: StandardSource): Promise<StandardDetail | null> {
    const normalizedCode = normalizeCode(code);
    const key = `detail:${normalizedCode}:${source ?? 'ALL'}`;
    return this.cache.getOrLoad(key, async () => {
      const db = this.standardsDb;
      // Live first (2026-11-23): the metadata DB is only a fallback
      // for when upstream fails or has no such standard. Pass no
      // second argument when no source was pinned, so providers that
      // inspect their arguments (and existing callers) see the
      // original one-argument call.
      let result: StandardDetail | null = null;
      let liveError: unknown = null;
      try {
        result = source === undefined
          ? await this.provider.getDetail(normalizedCode)
          : await this.provider.getDetail(normalizedCode, source);
        if (result !== null && !isStandardDetail(result, normalizedCode)) {
          throw new VsqiError('VSQI detail response has an unexpected structure', 'INVALID_UPSTREAM_RESPONSE', 502);
        }
      } catch (error) {
        liveError = error;
        result = null;
      }
      if (result !== null) {
        if (db) db.client.ingestDetail(result);
        return result;
      }
      // Live failed (error or not found): try the metadata DB before
      // surfacing the original outcome. A pinned source is honored by
      // only serving records that actually have that source snapshot.
      if (db) {
        const lookup = await db.client.lookup(normalizedCode);
        if (
          lookup &&
          lookupMatchesCode(lookup, normalizedCode) &&
          (source === undefined || lookup.sources.some(entry => entry.source === source))
        ) {
          const fromDb = detailFromDb(lookup, db.staleDays);
          if (fromDb && isStandardDetail(fromDb, normalizedCode)) {
            return fromDb;
          }
        }
      }
      if (liveError !== null) throw liveError;
      return null;
    }, {
      // A fallback result served by a different source than the pinned
      // one must not be cached under the pinned source's key: the next
      // request for the pinned source should try that source again
      // instead of silently receiving another source's record.
      shouldCache: (result) => result !== null && (source === undefined || result.source === source)
    });
  }
}
