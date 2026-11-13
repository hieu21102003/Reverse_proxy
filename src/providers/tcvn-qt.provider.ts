import { config } from '../config.js';
import { VsqiError } from '../errors.js';
import { TcvnJsonClient } from '../http/tcvn-client.js';
import {
  detectQtOrg,
  mapTcvnDetail,
  mapTcvnSearchRecord,
  parseTcvnOrgList,
  parseTcvnSearchResponse
} from './tcvn.mapper.js';
import type { SearchInput, SearchResult, Standard, StandardDetail, StandardProvider } from '../types.js';

/**
 * International standards from tracuu.tcvn.vn (`/is-standard/*`).
 *
 * A real `orgCode` is required: `orgCode=ALL` returns nothing. A code
 * query with a known organisation prefix ("ISO 9001", "EN ISO 9001",
 * "GB/T 19001") searches that single organisation; a title query fans out
 * across the enabled organisations from
 * GET /is-standard/is-organization/all (cached briefly, capped by
 * TCVN_QT_MAX_ORGS). `status=A` is always sent. Note the `tn` field on IS
 * records is a non-English title, so title search uses `ti` only and the
 * mapper never uses `tn` as the record name.
 */
export class TcvnQtProvider implements StandardProvider {
  private readonly json: Pick<TcvnJsonClient, 'getJson'>;
  private readonly baseUrl: string;
  private orgsCache: { orgs: string[]; fetchedAt: number } | null = null;

  constructor(
    json?: Pick<TcvnJsonClient, 'getJson'>,
    baseUrl: string = config.TCVN_BASE_URL,
    private readonly injectedOrgs?: string[]
  ) {
    this.json = json ?? new TcvnJsonClient(baseUrl);
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private ensureEnabled(): void {
    if (config.TCVN_ENABLED.toLowerCase() !== 'true') {
      throw new VsqiError('TCVN integration is disabled', 'PROVIDER_DISABLED', 503);
    }
  }

  private async enabledOrgs(): Promise<string[]> {
    if (this.injectedOrgs) return this.injectedOrgs.slice(0, config.TCVN_QT_MAX_ORGS);
    const ttlMs = config.TCVN_ORG_LIST_TTL_SECONDS * 1000;
    if (this.orgsCache && ttlMs > 0 && Date.now() - this.orgsCache.fetchedAt < ttlMs) {
      return this.orgsCache.orgs;
    }
    const payload = await this.json.getJson(
      new URL(`${this.baseUrl}/is-standard/is-organization/all`)
    );
    const orgs = parseTcvnOrgList(payload).slice(0, config.TCVN_QT_MAX_ORGS);
    this.orgsCache = { orgs, fetchedAt: Date.now() };
    return orgs;
  }

  private async runSearch(
    orgCode: string,
    params: Record<string, string>,
    page: number
  ): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/is-standard/search`);
    url.searchParams.set('orgCode', orgCode);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set('status', 'A');
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(config.TCVN_SEARCH_LIMIT));
    const payload = await this.json.getJson(url);
    const { total, records } = parseTcvnSearchResponse(payload);
    const data = records
      .map(record => mapTcvnSearchRecord(record, 'QT', this.baseUrl))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    return {
      data,
      pagination: {
        currentPage: page,
        ...(total > 0
          ? {
              totalPages: Math.max(1, Math.ceil(total / config.TCVN_SEARCH_LIMIT)),
              totalResults: total
            }
          : { totalResults: 0 })
      },
      source: 'TCVN_QT'
    };
  }

  /** Merge per-org pages, deduplicated by record key (same record can be
   *  returned under several organisations, e.g. EN ISO 9001 under EN/ISO).
   *  totalResults is the sum of the per-organisation totals and may
   *  double-count such records; totalPages is omitted because a combined
   *  page count would imply one sorted list at one page size, which a
   *  fan-out is not. */
  private mergeOrgResults(results: SearchResult[], page: number): SearchResult {
    const seen = new Set<string>();
    const data: Standard[] = [];
    let totalResults = 0;
    for (const result of results) {
      totalResults += result.pagination.totalResults ?? 0;
      for (const item of result.data) {
        const key = item.detailUrl ?? item.code;
        if (seen.has(key)) continue;
        seen.add(key);
        data.push(item);
      }
    }
    return {
      data,
      pagination: { currentPage: page, totalResults },
      source: 'TCVN_QT'
    };
  }

  /**
   * Fan a search out across organisations. One organisation failing (or
   * timing out) must not lose the others' results; only when every
   * organisation fails does the search throw.
   */
  private async fanOut(
    orgs: string[],
    params: Record<string, string>,
    page: number
  ): Promise<SearchResult> {
    const settled = await Promise.allSettled(
      orgs.map(orgCode => this.runSearch(orgCode, params, page))
    );
    const fulfilled = settled
      .filter((o): o is PromiseFulfilledResult<SearchResult> => o.status === 'fulfilled')
      .map(o => o.value);
    if (fulfilled.length === 0) {
      throw (settled[0] as PromiseRejectedResult).reason;
    }
    return this.mergeOrgResults(fulfilled, page);
  }

  async search({ query, page }: SearchInput): Promise<SearchResult> {
    this.ensureEnabled();
    const trimmed = query.trim();
    // TCVN/QCVN codes never live in the international catalogue; answer
    // empty without firing (up to 11) pointless organisation searches.
    if (/^(TCVN|QCVN)\b/i.test(trimmed)) {
      return { data: [], pagination: { currentPage: page, totalResults: 0 }, source: 'TCVN_QT' };
    }
    const org = detectQtOrg(trimmed);
    if (org) {
      return this.runSearch(org, { di: trimmed }, page);
    }
    if (/\d/.test(trimmed)) {
      // A code fragment without a known organisation prefix: try the code
      // in every enabled organisation.
      return this.fanOut(await this.enabledOrgs(), { di: trimmed }, page);
    }
    // Title query: English title (`ti`) across the enabled organisations.
    return this.fanOut(await this.enabledOrgs(), { ti: trimmed }, page);
  }

  async getDetail(code: string): Promise<StandardDetail | null> {
    this.ensureEnabled();
    const trimmed = code.trim();
    // TCVN/QCVN codes never live in the international catalogue; skip the
    // (up to 11-way) fan-out for them.
    if (/^(TCVN|QCVN)\b/i.test(trimmed)) return null;
    const org = detectQtOrg(trimmed);
    const search = org
      ? await this.runSearch(org, { di: trimmed }, 1)
      : await this.search({ query: trimmed, page: 1 });
    const found = search.data.find(
      item => item.code.toLocaleLowerCase('en') === trimmed.toLocaleLowerCase('en')
    );
    if (!found?.detailUrl) return null;
    const payload = await this.json.getJson(new URL(found.detailUrl));
    return mapTcvnDetail(payload, 'QT', this.baseUrl);
  }
}
