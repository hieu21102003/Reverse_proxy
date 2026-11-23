import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import type { Standard, StandardDetail, StandardSource } from '../types.js';
import {
  IngestRequestSchema,
  LookupResponseSchema,
  MAX_ITEMS_PER_INGEST,
  type IngestRequest,
  type LookupEdition,
  type LookupRelation,
  type LookupSource,
  type LookupStandard,
  type Detail as ContractDetail,
  type SearchItem as ContractSearchItem
} from './contract.js';

/**
 * Client for elib's internal standards-metadata API
 * (POST /internal/standards/ingest, GET /internal/standards/lookup).
 *
 * Contract (shared zod schemas in ./contract.ts — elib is the source
 * of truth; contract tests in both repos validate the same JSON
 * fixture so drift fails loudly):
 * - every call needs the X-Internal-Token shared secret; elib answers
 *   503 when its own token env is missing, 401 on mismatch;
 * - search ingest uses the multi-source shape { kind: 'search',
 *   sources: [{ source, items }, ...], query, hadResult } — ONE
 *   request per results page, exactly ONE search_log row per search;
 *   detail ingest stays single-source { kind: 'detail', source,
 *   detail }; `raw` is stripped by elib's zod schema and never stored
 *   (we never send it either);
 * - lookup returns { found: false } or { found: true, standard,
 *   editions[] (with titles), sources[], relations[] (with
 *   otherNormalizedCode/otherCodeDisplay), replaces[], replacedBy }.
 *   The stored snapshot payload (ingested attributes verbatim) is NOT
 *   exposed; DB-served details synthesize attributes from the
 *   standard fields (see db-detail.ts).
 * - request bodies are validated against IngestRequestSchema before
 *   sending and lookup responses against LookupResponseSchema, so a
 *   contract drift on either side is caught here (and in tests)
 *   instead of silently corrupting the DB.
 *
 * Failure policy: the metadata DB is an accelerator, never a
 * dependency. Every error is swallowed (logged once per breaker trip);
 * lookup failures return null, ingest is fire-and-forget. A circuit
 * breaker pauses all calls after consecutive failures so a down elib
 * cannot add latency to every search.
 */

export type DbStandard = LookupStandard;
export type DbEdition = LookupEdition;
export type DbSourceSnapshot = LookupSource;
export type DbRelation = LookupRelation;

export interface DbLookupResult {
  standard: DbStandard;
  editions: DbEdition[];
  sources: DbSourceSnapshot[];
  relations: DbRelation[];
  /** Codes this standard replaces (outgoing 'replaces' edges). */
  replaces: string[];
  /** Code of the standard that replaces this one, or null. */
  replacedBy: string | null;
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
const MAX_ATTRIBUTES = 500;
const MAX_RELATIONS = 500;

function searchItemPayload(item: Standard): ContractSearchItem {
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

function detailPayload(detail: StandardDetail): ContractDetail {
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
      const parsed = LookupResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        // Contract drift: treat like a failed call (breaker counts it).
        this.recordFailure('lookup response contract');
        return null;
      }
      if (!parsed.data.found) return null;
      return {
        standard: parsed.data.standard,
        editions: parsed.data.editions,
        sources: parsed.data.sources,
        relations: parsed.data.relations,
        replaces: parsed.data.replaces,
        replacedBy: parsed.data.replacedBy
      };
    } catch {
      this.recordFailure('lookup response parse');
      return null;
    }
  }

  private postIngest(payload: IngestRequest): void {
    // Validate against the shared contract before sending: a drifted
    // body is dropped (and counted as a failure) instead of letting
    // elib 400 it. Fire-and-forget: never awaited by callers.
    const parsed = IngestRequestSchema.safeParse(payload);
    if (!parsed.success) {
      this.recordFailure('ingest request contract');
      return;
    }
    void this.call('/internal/standards/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data)
    });
  }

  /**
   * Ingest one results page as ONE multi-source request (elib writes
   * exactly one search_log row for it). Items are grouped by source;
   * an empty page still sends one request with no groups so the
   * search is logged with hadResult=false.
   */
  ingestSearch(items: Standard[], query: string, hadResult: boolean): void {
    if (this.token === null || this.breakerOpen) return;
    const bySource = new Map<StandardSource, Standard[]>();
    for (const item of items) {
      const group = bySource.get(item.source) ?? [];
      group.push(item);
      bySource.set(item.source, group);
    }
    this.postIngest({
      kind: 'search',
      sources: [...bySource].map(([source, group]) => ({
        source,
        items: group.slice(0, MAX_ITEMS_PER_INGEST).map(searchItemPayload)
      })),
      query,
      hadResult
    });
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
