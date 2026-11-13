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
 * - `page` applies per source (page N of each source). `totalResults` is
 *   the sum of the per-source totals; there is no combined `totalPages`.
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

  async search(input: SearchInput): Promise<SearchResult> {
    const settled = await Promise.allSettled(
      MERGE_ORDER.map(source => this.providers[source].search(input))
    );

    const data: Standard[] = [];
    const seen = new Set<string>();
    const summaries: SearchSourceSummary[] = [];
    const partialFailures: StandardSource[] = [];
    let totalResults = 0;
    let anyTotal = false;

    settled.forEach((outcome, index) => {
      const source = MERGE_ORDER[index] as StandardSource;
      if (outcome.status === 'fulfilled') {
        const result = outcome.value;
        if (result.pagination.totalResults !== undefined) {
          totalResults += result.pagination.totalResults;
          anyTotal = true;
        }
        summaries.push({
          source,
          ok: true,
          ...(result.pagination.totalResults !== undefined
            ? { totalResults: result.pagination.totalResults }
            : {}),
          ...(result.pagination.totalPages !== undefined
            ? { totalPages: result.pagination.totalPages }
            : {})
        });
        for (const item of result.data) {
          const key = `${source}::${normalizeCode(item.code)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          data.push(item);
        }
      } else {
        partialFailures.push(source);
        summaries.push({ source, ok: false, error: errorCode(outcome.reason) });
        this.logger?.warn(
          { source, errorCode: errorCode(outcome.reason) },
          'Upstream source search failed; returning partial merged results'
        );
      }
    });

    if (partialFailures.length === MERGE_ORDER.length) {
      throw new VsqiError(
        'All upstream sources failed',
        'UPSTREAM_UNAVAILABLE',
        502
      );
    }

    return {
      data,
      pagination: {
        currentPage: input.page,
        ...(anyTotal ? { totalResults } : {})
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
