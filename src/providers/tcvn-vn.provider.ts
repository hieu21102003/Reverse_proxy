import { config } from '../config.js';
import { VsqiError } from '../errors.js';
import { TcvnJsonClient } from '../http/tcvn-client.js';
import {
  isTcvnCodeQuery,
  mapTcvnDetail,
  mapTcvnSearchRecord,
  parseTcvnSearchResponse
} from './tcvn.mapper.js';
import type { SearchInput, SearchResult, StandardDetail, StandardProvider } from '../types.js';

/**
 * Vietnamese standards from tracuu.tcvn.vn (`/vs-standard/*`).
 *
 * Search parameters are the site's form controls. They are ANDed by the
 * backend (sending tn and ti together returns nothing), so a title query
 * fans out into two parallel calls — one by Vietnamese title (tn), one by
 * English title (ti) — and merges them, deduplicated by record key.
 * `status=A` (still effective) is always sent for search: without it the
 * backend returns zero results. Detail lookups additionally retry with
 * `status=H` (withdrawn) so replaced standards remain reachable.
 */
export class TcvnVnProvider implements StandardProvider {
  private readonly json: Pick<TcvnJsonClient, 'getJson'>;
  private readonly baseUrl: string;

  constructor(json?: Pick<TcvnJsonClient, 'getJson'>, baseUrl: string = config.TCVN_BASE_URL) {
    this.json = json ?? new TcvnJsonClient(baseUrl);
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private ensureEnabled(): void {
    if (config.TCVN_ENABLED.toLowerCase() !== 'true') {
      throw new VsqiError('TCVN integration is disabled', 'PROVIDER_DISABLED', 503);
    }
  }

  private searchUrl(params: Record<string, string>, page: number, status: 'A' | 'H' = 'A'): URL {
    const url = new URL(`${this.baseUrl}/vs-standard/search`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set('status', status);
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(config.TCVN_SEARCH_LIMIT));
    return url;
  }

  private async runSearch(params: Record<string, string>, page: number, status: 'A' | 'H' = 'A'): Promise<SearchResult> {
    const payload = await this.json.getJson(this.searchUrl(params, page, status));
    const { total, records } = parseTcvnSearchResponse(payload);
    const data = records
      .map(record => mapTcvnSearchRecord(record, 'VN', this.baseUrl))
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
      source: 'TCVN_VN'
    };
  }

  async search(input: SearchInput): Promise<SearchResult> {
    this.ensureEnabled();
    return this.searchWithStatus(input, 'A');
  }

  private async searchWithStatus({ query, page }: SearchInput, status: 'A' | 'H'): Promise<SearchResult> {
    const trimmed = query.trim();
    if (isTcvnCodeQuery(trimmed)) {
      return this.runSearch({ di: trimmed }, page, status);
    }
    // Title search: tn and ti are ANDed upstream, so query each separately.
    // One field failing must not lose the other's results.
    const settled = await Promise.allSettled([
      this.runSearch({ tn: trimmed }, page, status),
      this.runSearch({ ti: trimmed }, page, status)
    ]);
    const fulfilled = settled
      .filter((o): o is PromiseFulfilledResult<SearchResult> => o.status === 'fulfilled')
      .map(o => o.value);
    if (fulfilled.length === 0) {
      throw (settled[0] as PromiseRejectedResult).reason;
    }
    const seen = new Set<string>();
    const data = fulfilled.flatMap(result => result.data).filter(item => {
      const key = item.detailUrl ?? item.code;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // totalResults is the sum of the fulfilled field searches and may
    // double-count records matching both titles; totalPages is omitted for
    // the same reason as in the QT fan-out (no single page size). The page
    // itself is deduplicated by record key.
    const totalResults = fulfilled.reduce(
      (sum, result) => sum + (result.pagination.totalResults ?? 0),
      0
    );
    return {
      data,
      pagination: { currentPage: page, totalResults },
      source: 'TCVN_VN'
    };
  }

  async getDetail(code: string): Promise<StandardDetail | null> {
    this.ensureEnabled();
    // Search stays effective-only (status=A), but a detail lookup must
    // also find replaced/withdrawn standards (status=H) — e.g. following
    // "replaces TCVN 9143:2012" from the current edition's page.
    for (const status of ['A', 'H'] as const) {
      const search = await this.searchWithStatus({ query: code, page: 1 }, status);
      const found = search.data.find(
        item => item.code.toLocaleLowerCase('en') === code.toLocaleLowerCase('en')
      );
      if (!found?.detailUrl) continue;
      const payload = await this.json.getJson(new URL(found.detailUrl));
      return mapTcvnDetail(payload, 'VN', this.baseUrl);
    }
    return null;
  }
}
