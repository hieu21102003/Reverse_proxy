import { VsqiError } from '../errors.js';
import { VsqiProvider } from './vsqi.provider.js';
import { TcvnVnProvider } from './tcvn-vn.provider.js';
import { TcvnQtProvider } from './tcvn-qt.provider.js';
import type {
  FastifyBaseLogger
} from 'fastify';
import type {
  SearchInput,
  SearchResult,
  SearchSourceSummary,
  Standard,
  StandardDetail,
  StandardProvider,
  StandardSource
} from '../types.js';

export const MERGE_ORDER: StandardSource[] = ['VSQI', 'TCVN_VN', 'TCVN_QT'];

/** Items per merged page. Sources are over-fetched (see search()) so a
 *  merged page is always full unless the sources are exhausted. */
export const MERGED_PAGE_SIZE = 20;

/** Hard cap on upstream pages fetched per source for one merged search.
 *  Bounds the fan-out amplification of deep pages; beyond the cap a deep
 *  page may return fewer (or zero) items even if totals say more exist. */
export const MAX_SOURCE_PAGES = 10;

function errorCode(error: unknown): string {
  return error instanceof VsqiError ? error.code : 'UPSTREAM_ERROR';
}

function normalizeCode(code: string): string {
  return code.trim().replace(/\s+/g, ' ').toLocaleUpperCase('en');
}

/**
 * Fans a search out to VSQI + TCVN_VN + TCVN_QT in parallel and returns one
 * merged list, each item tagged with its source.
 *
 * Semantics (see README "Merged search"):
 * - Order is VSQI first, then TCVN_VN, then TCVN_QT; each source's own
 *   order is preserved. The same code may appear under several sources and
 *   is kept once per source (dedup is by source + code).
 * - Pagination is over the merged list at MERGED_PAGE_SIZE items per page.
 *   Each source is over-fetched page by page (up to MAX_SOURCE_PAGES)
 *   until it has contributed `page * MERGED_PAGE_SIZE` items or is
 *   exhausted; the merged list is then sliced to the requested page, so
 *   pages have no gaps while any source still has records. (Previously
 *   `page` applied per source, which could yield an empty page 2 while
 *   totals said more results existed.)
 * - `totalResults` is the sum of the per-source totals — an upper bound:
 *   the same standard can be counted by several sources (and, inside
 *   TCVN, by several fields/organisations). `totalPages` is
 *   ceil(totalResults / MERGED_PAGE_SIZE), except when every successful
 *   source was exhausted, in which case it is exact.
 * - One source failing (or disabled) never fails the whole search: its
 *   records are absent, it is listed in `partialFailures` and in
 *   `sources`, and the failure is logged. Only when every source fails
 *   does search throw (502).
 * - Detail without a `source` hint tries VSQI, then TCVN_VN, then TCVN_QT;
 *   first hit wins. A provider that throws during detail lookup is skipped
 *   and the next one is tried; if all throw, the first error is rethrown.
 */
export class MergedStandardProvider implements StandardProvider {
  private readonly providers: Record<StandardSource, StandardProvider>;

  constructor(
    providers?: Partial<Record<StandardSource, StandardProvider>>,
    private readonly logger?: Pick<FastifyBaseLogger, 'warn'>
  ) {
    this.providers = {
      VSQI: providers?.VSQI ?? new VsqiProvider(undefined, logger),
      TCVN_VN: providers?.TCVN_VN ?? new TcvnVnProvider(),
      TCVN_QT: providers?.TCVN_QT ?? new TcvnQtProvider()
    };
  }

  /**
   * Fetch pages 1..N from one source until it has contributed `target`
   * items, is exhausted (empty page / known last page / known total
   * reached), or the MAX_SOURCE_PAGES cap is hit. A failure on page 1
   * fails the source; a failure on a later page keeps the items already
   * fetched and still marks the source failed (partial).
   */
  private async fetchSourcePages(
    source: StandardSource,
    input: SearchInput,
    target: number
  ): Promise<{
    items: Standard[];
    totalResults?: number;
    totalPages?: number;
    exhausted: boolean;
    error?: unknown;
  }> {
    const provider = this.providers[source];
    const items: Standard[] = [];
    let totalResults: number | undefined;
    let totalPages: number | undefined;
    let exhausted = false;

    for (let page = 1; page <= MAX_SOURCE_PAGES; page++) {
      let result: SearchResult;
      try {
        result = await provider.search({ query: input.query, page });
      } catch (error) {
        return { items, totalResults, totalPages, exhausted, error };
      }
      if (page === 1) {
        totalResults = result.pagination.totalResults;
        totalPages = result.pagination.totalPages;
      }
      items.push(...result.data);
      if (result.data.length === 0) {
        exhausted = true;
        break;
      }
      if (totalPages !== undefined && page >= totalPages) {
        exhausted = true;
        break;
      }
      if (totalResults !== undefined && totalResults > 0 && items.length >= totalResults) {
        exhausted = true;
        break;
      }
      if (items.length >= target) break;
    }
    return { items, totalResults, totalPages, exhausted };
  }

  async search(input: SearchInput): Promise<SearchResult> {
    const page = Math.max(1, input.page);
    const target = page * MERGED_PAGE_SIZE;
    const settled = await Promise.allSettled(
      MERGE_ORDER.map(source => this.fetchSourcePages(source, input, target))
    );

    const data: Standard[] = [];
    const seen = new Set<string>();
    const summaries: SearchSourceSummary[] = [];
    const partialFailures: StandardSource[] = [];
    let totalResults = 0;
    let anyTotal = false;
    let anySuccess = false;
    let allExhausted = true;

    settled.forEach((outcome, index) => {
      const source = MERGE_ORDER[index] as StandardSource;
      // fetchSourcePages never rejects (it captures errors), but stay safe.
      const fetched: {
        items: Standard[];
        totalResults?: number;
        totalPages?: number;
        exhausted: boolean;
        error?: unknown;
      } = outcome.status === 'fulfilled'
        ? outcome.value
        : { items: [], exhausted: false, error: outcome.reason };
      const failed = fetched.error !== undefined;
      if (failed) {
        partialFailures.push(source);
        this.logger?.warn(
          { source, errorCode: errorCode(fetched.error) },
          'Upstream source search failed; returning partial merged results'
        );
      }
      if (!failed || fetched.items.length > 0 || fetched.totalResults !== undefined) {
        anySuccess = true;
      }
      if (!fetched.exhausted) allExhausted = false;
      if (fetched.totalResults !== undefined) {
        totalResults += fetched.totalResults;
        anyTotal = true;
      }
      summaries.push({
        source,
        ok: !failed,
        ...(fetched.totalResults !== undefined ? { totalResults: fetched.totalResults } : {}),
        ...(fetched.totalPages !== undefined ? { totalPages: fetched.totalPages } : {}),
        ...(failed ? { error: errorCode(fetched.error) } : {})
      });
      for (const item of fetched.items) {
        const key = `${source}::${normalizeCode(item.code)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        data.push(item);
      }
    });

    if (!anySuccess) {
      throw new VsqiError(
        'All upstream sources failed',
        'UPSTREAM_UNAVAILABLE',
        502
      );
    }

    const start = (page - 1) * MERGED_PAGE_SIZE;
    const pageData = data.slice(start, start + MERGED_PAGE_SIZE);
    // When every successful source was exhausted we know the exact merged
    // length; otherwise totalResults is an upper bound (see class docs).
    const effectiveTotal = allExhausted ? data.length : totalResults;

    return {
      data: pageData,
      pagination: {
        currentPage: page,
        ...(anyTotal ? { totalResults } : {}),
        ...(anyTotal || allExhausted
          ? { totalPages: Math.max(1, Math.ceil(effectiveTotal / MERGED_PAGE_SIZE)) }
          : {})
      },
      source: 'MULTI',
      sources: summaries,
      ...(partialFailures.length > 0 ? { partialFailures } : {})
    };
  }

  async getDetail(code: string, source?: StandardSource): Promise<StandardDetail | null> {
    const order = source ? [source] : MERGE_ORDER;
    let firstError: unknown;
    let anyCompleted = false;
    for (const name of order) {
      try {
        const found = await this.providers[name].getDetail(code);
        anyCompleted = true;
        if (found) return found;
      } catch (error) {
        // A single source being down must not hide a record another source
        // has — unless the caller pinned that source, in which case the
        // error is theirs to see.
        if (source) throw error;
        firstError ??= error;
        this.logger?.warn(
          { source: name, errorCode: errorCode(error) },
          'Upstream source detail lookup failed; trying the next source'
        );
      }
    }
    // No record anywhere: if every source threw, surface the failure
    // instead of a misleading 404; if at least one source answered
    // cleanly with "not found", the code simply does not exist.
    if (firstError !== undefined && !anyCompleted) throw firstError;
    return null;
  }
}
