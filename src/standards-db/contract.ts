// Shared contract for the internal standards-metadata API
// (POST /internal/standards/ingest, GET /internal/standards/lookup).
//
// SYNC NOTICE: this file is a verbatim copy of elib's
// src/standards/contract.ts — elib is the source of truth. Change
// shapes there first, then mirror here. Contract tests in both repos
// (tests/standards-db.contract.test.ts here) validate the same JSON
// fixture (tests/fixtures/standards-contract.json) so drift fails
// loudly instead of silently breaking the integration.
//
// This module is the SINGLE source of truth for the wire shapes between
// elib (server) and Reverse_proxy (client). Reverse_proxy copies this
// file (or its schemas) for its own contract tests — change shapes here
// first, then mirror. All changes must stay additive: existing fields
// are never removed or re-typed.
//
// NOTE: zod strips unknown keys by default. `raw` is intentionally
// absent from every schema, so a raw payload sent by a buggy caller is
// dropped, never stored. Do NOT add .passthrough() here.

import { z } from 'zod';

export const StandardSourceSchema = z.enum(['VSQI', 'TCVN_VN', 'TCVN_QT']);
export type StandardSourceName = z.infer<typeof StandardSourceSchema>;

export const MAX_ITEMS_PER_INGEST = 100;
export const MAX_SOURCES_PER_INGEST = 3;

export const SearchItemSchema = z.object({
  code: z.string().trim().min(1).max(200),
  name: z.string().max(2000).nullable().optional(),
  englishName: z.string().max(2000).nullable().optional(),
  year: z.number().int().min(1000).max(9999).nullable().optional(),
  status: z.string().max(100).nullable().optional(),
  detailUrl: z.string().max(2000).nullable().optional(),
  ics: z.array(z.string().max(50)).max(50).nullable().optional()
});
export type SearchItem = z.infer<typeof SearchItemSchema>;

export const RelationSchema = z.object({
  type: z.string().trim().min(1).max(100),
  code: z.string().max(500).nullable().optional(),
  text: z.string().max(2000).nullable().optional(),
  url: z.string().max(2000).nullable().optional()
});
export type Relation = z.infer<typeof RelationSchema>;

export const DetailSchema = SearchItemSchema.extend({
  issuedDate: z.string().max(50).nullable().optional(),
  effectiveDate: z.string().max(50).nullable().optional(),
  replaces: z.string().max(5000).nullable().optional(),
  replacedBy: z.string().max(5000).nullable().optional(),
  // attributes are stored verbatim in the snapshot payload; cap the array.
  attributes: z.array(z.unknown()).max(500).nullable().optional(),
  relations: z.array(RelationSchema).max(500).nullable().optional()
});
export type Detail = z.infer<typeof DetailSchema>;

/** One source group inside a multi-source search ingest. */
export const IngestSourceGroupSchema = z.object({
  source: StandardSourceSchema,
  items: z.array(SearchItemSchema).max(MAX_ITEMS_PER_INGEST)
});
export type IngestSourceGroup = z.infer<typeof IngestSourceGroupSchema>;

/**
 * Ingest request.
 *
 * kind='search' accepts TWO shapes (both stay supported):
 * - NEW (preferred): { kind:'search', sources: [{source, items}, ...],
 *   query?, hadResult? } — one request for a whole results page, and
 *   exactly ONE search_log row is written for it.
 * - LEGACY: { kind:'search', source, items, query?, hadResult? } — one
 *   source per request. One search_log row per request, UNLESS the
 *   caller sets `log: false` (callers that fan one search out into
 *   several legacy requests must set log:false on all but the first,
 *   so one user search still produces exactly one search_log row).
 *
 * kind='detail' is always single-source: { kind:'detail', source,
 * detail } and never writes search_log.
 */
export const IngestRequestSchema = z
  .object({
    kind: z.enum(['search', 'detail']),
    source: StandardSourceSchema.optional(),
    sources: z.array(IngestSourceGroupSchema).max(MAX_SOURCES_PER_INGEST).optional(),
    query: z.string().max(500).optional(),
    hadResult: z.boolean().optional(),
    /** kind='search' only: set false to skip the search_log row. */
    log: z.boolean().optional(),
    items: z.array(SearchItemSchema).max(MAX_ITEMS_PER_INGEST).optional(),
    detail: DetailSchema.optional()
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'search') {
      const hasLegacy = value.source !== undefined && value.items !== undefined;
      const hasMulti = value.sources !== undefined;
      if (!hasLegacy && !hasMulti) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'kind=search requires either sources[] (multi-source) or source + items (legacy)'
        });
      }
      if (hasLegacy && hasMulti) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'kind=search accepts sources[] OR source + items, not both'
        });
      }
      if (value.detail !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'kind=search must not carry detail'
        });
      }
    }
    if (value.kind === 'detail') {
      if (value.detail === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'kind=detail requires detail' });
      }
      if (value.source === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'kind=detail requires source' });
      }
      if (value.sources !== undefined || value.items !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'kind=detail is single-source: no sources[]/items'
        });
      }
    }
  });
export type IngestRequest = z.infer<typeof IngestRequestSchema>;

export const IngestResponseSchema = z.object({
  ok: z.literal(true),
  stored: z.number().int().min(0),
  skipped: z.number().int().min(0)
});
export type IngestResponse = z.infer<typeof IngestResponseSchema>;

const detailLevelSchema = z.enum(['stub', 'summary', 'full', 'manual']);

export const LookupStandardSchema = z.object({
  id: z.string(),
  org: z.string().nullable(),
  number: z.string().nullable(),
  part: z.string().nullable(),
  year: z.number().nullable(),
  amendment: z.string().nullable(),
  suffix: z.string().nullable(),
  normalizedCode: z.string(),
  baseKey: z.string(),
  codeDisplay: z.string(),
  titleVi: z.string().nullable(),
  titleEn: z.string().nullable(),
  status: z.string(),
  issuedDate: z.string().nullable(),
  effectiveDate: z.string().nullable(),
  ics: z.array(z.string()).nullable(),
  detailLevel: detailLevelSchema,
  parseConfidence: z.number().nullable(),
  isAmendment: z.boolean(),
  needsReview: z.boolean(),
  lastVerifiedAt: z.string().nullable(),
  updatedAt: z.string()
});
export type LookupStandard = z.infer<typeof LookupStandardSchema>;

export const LookupEditionSchema = z.object({
  id: z.string(),
  normalizedCode: z.string(),
  baseKey: z.string(),
  codeDisplay: z.string(),
  year: z.number().nullable(),
  status: z.string(),
  titleVi: z.string().nullable(),
  titleEn: z.string().nullable(),
  isAmendment: z.boolean(),
  needsReview: z.boolean(),
  detailLevel: detailLevelSchema,
  lastVerifiedAt: z.string().nullable()
});
export type LookupEdition = z.infer<typeof LookupEditionSchema>;

export const LookupSourceSchema = z.object({
  source: z.string(),
  detailUrl: z.string().nullable(),
  fetchedAt: z.string()
});
export type LookupSource = z.infer<typeof LookupSourceSchema>;

export const LookupRelationSchema = z.object({
  direction: z.enum(['outgoing', 'incoming']),
  type: z.string(),
  toCodeRaw: z.string(),
  toNorm: z.string(),
  toBaseKey: z.string().nullable(),
  toId: z.string().nullable(),
  fromId: z.string(),
  source: z.string().nullable(),
  // The OTHER end of the edge, resolved against standards when possible:
  // outgoing -> the target standard; incoming -> the source standard.
  // Null when that end is unresolved (to_id NULL / raw-only edge).
  otherNormalizedCode: z.string().nullable(),
  otherCodeDisplay: z.string().nullable()
});
export type LookupRelation = z.infer<typeof LookupRelationSchema>;

export const LookupResponseSchema = z.union([
  z.object({ found: z.literal(false) }),
  z.object({
    found: z.literal(true),
    standard: LookupStandardSchema,
    /** All matching editions, newest first; standard === editions[0]. */
    editions: z.array(LookupEditionSchema),
    sources: z.array(LookupSourceSchema),
    relations: z.array(LookupRelationSchema),
    /**
     * Convenience derivations from relations (codes as code_display
     * when resolvable, else normalized_code / to_code_raw):
     * - replaces: standards this one replaces (outgoing 'replaces');
     * - replacedBy: the standard that replaces this one (incoming
     *   'replaces'), or null.
     */
    replaces: z.array(z.string()),
    replacedBy: z.string().nullable()
  })
]);
export type LookupResponse = z.infer<typeof LookupResponseSchema>;
