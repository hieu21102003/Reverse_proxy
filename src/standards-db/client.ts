import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import type { Standard, StandardDetail, StandardSource } from '../types.js';

/**
 * Client for elib's internal standards-metadata API
 * (POST /internal/standards/ingest, GET /internal/standards/lookup).
 *
 * Contract (elib src/routes/internal-standards.ts):
 * - every call needs the X-Internal-Token shared secret; elib answers
 *   503 when its own token env is missing, 401 on mismatch;
 * - ingest body: { kind: 'search'|'detail', source, items?|detail?,
 *   query?, hadResult? } — ONE source per request, max 100 items, 2 MB;
 *   `raw` is stripped by elib's zod schema and never stored (we never
 *   send it either);
 * - search_log is written by elib ONLY on kind='search' ingest, with
 *   hadResult from us;
 * - lookup returns { found: false } or { found: true, standard,
 *   editions[], sources[], relations[] } — NOTE: the stored snapshot
 *   payload (attributes/relations as ingested) is NOT exposed; only the
 *   standard fields, edition summaries and relation edges are.
 *
 * Failure policy: the metadata DB is an accelerator, never a
 * dependency. Every error is swallowed (logged once per breaker trip);
 * lookup failures return null, ingest is fire-and-forget. A circuit
 * breaker pauses all calls after consecutive failures so a down elib
 * cannot add latency to every search.
 */

export interface DbStandard {
  id: string;
  org: string | null;
  number: string | null;
  part: string | null;
  year: number | null;
  amendment: string | null;
  suffix: string | null;
  normalizedCode: string;
  baseKey: string;
  codeDisplay: string;
  titleVi: string | null;
  titleEn: string | null;
  status: string;
  issuedDate: string | null;
  effectiveDate: string | null;
  ics: string[] | null;
  detailLevel: 'stub' | 'summary' | 'full' | 'manual';
  parseConfidence: number | null;
  isAmendment: boolean;
  needsReview: boolean;
  lastVerifiedAt: string | null;
  updatedAt: string;
}

export interface DbEdition {
  id: string;
  normalizedCode: string;
  baseKey: string;
  codeDisplay: string;
  year: number | null;
  status: string;
  isAmendment: boolean;
  needsReview: boolean;
  detailLevel: 'stub' | 'summary' | 'full' | 'manual';
  lastVerifiedAt: string | null;
}

export interface DbSourceSnapshot {
  source: string;
  detailUrl: string | null;
  fetchedAt: string;
}

export interface DbRelation {
  direction: 'outgoing' | 'incoming';
  type: string;
  toCodeRaw: string;
  toNorm: string;
  toBaseKey: string | null;
  toId: string | null;
  fromId: string;
  source: string | null;
}

export interface DbLookupResult {
  standard: DbStandard;
  editions: DbEdition[];
  sources: DbSourceSnapshot[];
  relations: DbRelation[];
}

export interface StandardsDbClientOptions {
  baseUrl?: string;
  token?: string | null;
  timeoutMs?: number;
  /** Consecutive failures before the breaker opens. */
  failureThreshold?: number;
  /** How long the breaker stays open (ms). */
  cooldownMs?: number;
  logger?: Pick<FastifyBaseLogger, 'warn' | 'error'>;
  fetchFn?: typeof fetch;
}

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_ITEMS_PER_INGEST = 100;
const MAX_ATTRIBUTES = 500;
const MAX_RELATIONS = 500;

function searchItemPayload(item: Standard): Record<string, unknown> {
  return {
    code: item.code,
    name: item.name,
    ...(item.englishName !== undefined ? { englishName: item.englishName } : {}),
    ...(item.year !== undefined ? { year: item.year } : {}),
    ...(item.status !== undefined ? { status: item.status } : {}),
    ...(item.detailUrl !== undefined ? { detailUrl: item.detailUrl } : {}),
    ics: item.ics ?? []
  };
}

function detailPayload(detail: StandardDetail): Record<string, unknown> {
  // Whitelist exactly what elib's detailSchema accepts. `raw` is never
  // sent (elib would strip it anyway); dbInfo is our own annotation.
  return {
    code: detail.code,
    name: detail.name,
    englishName: detail.englishName,
    year: detail.year,
    status: detail.status,
    detailUrl: detail.detailUrl,
    ics: detail.ics ?? [],
    issuedDate: detail.issuedDate,
    effectiveDate: detail.effectiveDate,
    replaces: detail.replaces,
    replacedBy: detail.replacedBy,
    attributes: detail.attributes.slice(0, MAX_ATTRIBUTES),
    relations: detail.relations.slice(0, MAX_RELATIONS).map(relation => ({
      type: relation.type,
      code: relation.code,
      text: relation.text,
      url: relation.url
    }))
  };
}

export class StandardsDbClient {
  private readonly baseUrl: string;
  private readonly token: string | null;
  private readonly timeoutMs: number;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly logger?: Pick<FastifyBaseLogger, 'warn' | 'error'>;
  private readonly fetchFn: typeof fetch;
  private consecutiveFailures = 0;
  private openUntil = 0;

  constructor(options: StandardsDbClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? config.ELIB_BASE_URL).replace(/\/+$/, '');
    this.token = options.token !== undefined ? options.token : config.STANDARDS_INTERNAL_TOKEN;
    this.timeoutMs = options.timeoutMs ?? config.STANDARDS_DB_TIMEOUT_MS;
    this.failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.logger = options.logger;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  /** True while the circuit breaker is open (calls are paused). */
  get breakerOpen(): boolean {
    return Date.now() < this.openUntil;
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openUntil = 0;
  }

  private recordFailure(context: string): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold && !this.breakerOpen) {
      this.openUntil = Date.now() + this.cooldownMs;
      // Log once per trip — never the token, never request bodies.
      this.logger?.warn(
        `Standards DB circuit breaker opened after ${this.consecutiveFailures} consecutive failures (${context}); pausing internal calls for ${this.cooldownMs}ms`
      );
    }
  }

  private async call(path: string, init: RequestInit): Promise<Response | null> {
    if (this.token === null || this.breakerOpen) return null;
    try {
      const response = await this.fetchFn(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          'x-internal-token': this.token
        },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (!response.ok) {
        // Drain so the socket can be reused; body is never logged.
        await response.text().catch(() => undefined);
        this.recordFailure(`${init.method ?? 'GET'} ${path} -> ${response.status}`);
        return null;
      }
      this.recordSuccess();
      return response;
    } catch {
      this.recordFailure(`${init.method ?? 'GET'} ${path}`);
      return null;
    }
  }

  /** Lookup by user-typed code. Returns null on miss AND on any error. */
  async lookup(query: string): Promise<DbLookupResult | null> {
    const response = await this.call(`/internal/standards/lookup?q=${encodeURIComponent(query)}`, {
      method: 'GET'
    });
    if (!response) return null;
    try {
      const body = (await response.json()) as {
        found?: boolean;
        standard?: DbStandard;
        editions?: DbEdition[];
        sources?: DbSourceSnapshot[];
        relations?: DbRelation[];
      };
      if (!body.found || !body.standard) return null;
      return {
        standard: body.standard,
        editions: body.editions ?? [],
        sources: body.sources ?? [],
        relations: body.relations ?? []
      };
    } catch {
      this.recordFailure('lookup response parse');
      return null;
    }
  }

  private postIngest(payload: Record<string, unknown>): void {
    // Fire-and-forget: never awaited by callers, errors only feed the
    // breaker. The floating promise is intentional.
    void this.call('/internal/standards/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  /**
   * Ingest one results page. Elib accepts ONE source per request, so
   * items are grouped by source (at most one request per source per
   * page). hadResult/query ride along so elib can write search_log.
   */
  ingestSearch(items: Standard[], query: string, hadResult: boolean): void {
    if (this.token === null || this.breakerOpen) return;
    const bySource = new Map<StandardSource, Standard[]>();
    for (const item of items) {
      const group = bySource.get(item.source) ?? [];
      group.push(item);
      bySource.set(item.source, group);
    }
    if (bySource.size === 0) {
      // No items (e.g. a search with zero results): still record the
      // search_log row via an empty ingest under a neutral source.
      this.postIngest({ kind: 'search', source: 'VSQI', items: [], query, hadResult });
      return;
    }
    for (const [source, group] of bySource) {
      this.postIngest({
        kind: 'search',
        source,
        items: group.slice(0, MAX_ITEMS_PER_INGEST).map(searchItemPayload),
        query,
        hadResult
      });
    }
  }

  /** Ingest one live detail (fire-and-forget). */
  ingestDetail(detail: StandardDetail): void {
    if (this.token === null || this.breakerOpen) return;
    this.postIngest({
      kind: 'detail',
      source: detail.source,
      detail: detailPayload(detail)
    });
  }
}
