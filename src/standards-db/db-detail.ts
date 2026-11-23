import type {
  DetailAttribute,
  DetailRelation,
  RawDetail,
  RelationType,
  SearchResult,
  Standard,
  StandardDbInfo,
  StandardDetail,
  StandardSource
} from '../types.js';
import type { DbLookupResult, DbRelation, DbStandard } from './client.js';
import { lightNormalizeCode } from './light-normalize.js';

/**
 * Rebuilding API shapes from elib metadata-DB lookup results, and
 * merging DB hits into live search results.
 *
 * Contract limits (elib lookup response): the stored snapshot payload
 * (ingested attributes verbatim) is NOT exposed — only the standard
 * fields, edition summaries (with titles) and relation edges. DB-served
 * details therefore synthesize attributes from the standard fields
 * (same labels as the TCVN mapper) and map relation edges back to
 * DetailRelation. `replacedBy`/`replaces` come from elib's derivations
 * over the single-direction relation graph (incoming 'replaces' edge =
 * the standard that replaces this one); incoming edges also carry
 * otherCodeDisplay/otherNormalizedCode when resolved.
 */

const VALID_SOURCES: readonly string[] = ['VSQI', 'TCVN_VN', 'TCVN_QT'];

export function isFreshStandard(
  standard: DbStandard,
  staleDays: number,
  now: Date = new Date()
): boolean {
  if (standard.detailLevel !== 'full') return false;
  if (!standard.lastVerifiedAt) return false;
  const verified = Date.parse(standard.lastVerifiedAt);
  if (Number.isNaN(verified)) return false;
  return now.getTime() - verified <= staleDays * 24 * 60 * 60 * 1000;
}

export function dbInfoFor(
  lookup: DbLookupResult,
  servedFrom: 'db' | 'live',
  staleDays: number,
  now: Date = new Date()
): StandardDbInfo {
  return {
    servedFrom,
    lastVerifiedAt: lookup.standard.lastVerifiedAt,
    stale: !isFreshStandard(lookup.standard, staleDays, now),
    staleDays,
    sources: lookup.sources
      .filter((entry): entry is { source: StandardSource; detailUrl: string | null; fetchedAt: string } =>
        VALID_SOURCES.includes(entry.source)
      )
      .map(entry => ({ source: entry.source, detailUrl: entry.detailUrl }))
  };
}

function emptyRaw(detailUrl: string, name: string | null): RawDetail {
  return {
    page: {
      title: name,
      metaDescription: null,
      heading: null,
      breadcrumb: [],
      pageType: 'standard',
      internalId: null,
      barcode: null,
      purchaseUrl: null,
      detailUrl
    },
    tables: [],
    sections: [],
    lists: [],
    links: [],
    documents: [],
    images: [],
    embeds: [],
    forms: [],
    dataAttributes: [],
    embeddedData: []
  };
}

function synthAttributes(standard: DbStandard): DetailAttribute[] {
  const rows: Array<{ label: string; labelEn: string; value: string | null }> = [
    { label: 'Số hiệu', labelEn: 'Standard code', value: standard.codeDisplay },
    { label: 'Tên tiếng Việt', labelEn: 'Vietnamese title', value: standard.titleVi },
    { label: 'Tên tiếng Anh', labelEn: 'English title', value: standard.titleEn },
    {
      label: 'Năm ban hành',
      labelEn: 'Year',
      value: standard.year !== null ? String(standard.year) : null
    },
    { label: 'Tình trạng', labelEn: 'Status', value: standard.status },
    { label: 'Ngày ban hành', labelEn: 'Issue date', value: standard.issuedDate },
    { label: 'Ngày hiệu lực', labelEn: 'Effective date', value: standard.effectiveDate },
    {
      label: 'Mã ICS',
      labelEn: 'ICS codes',
      value: standard.ics && standard.ics.length > 0 ? standard.ics.join(', ') : null
    }
  ];
  return rows
    .filter(row => row.value !== null && row.value !== '')
    .map((row, order) => ({
      order,
      label: row.label,
      labelRaw: row.label,
      labelEn: row.labelEn,
      value: row.value,
      valueHtml: row.value,
      links: [],
      lists: [],
      source: {
        strategy: 'fallback' as const,
        table: null,
        row: null,
        cell: null,
        labelColumn: null,
        valueColumns: [],
        selector: null
      }
    }));
}

function relationTypeFor(edge: DbRelation): RelationType {
  if (edge.type === 'replaces') return edge.direction === 'outgoing' ? 'replaces' : 'replacedBy';
  if (edge.type === 'equivalent') return 'equivalent';
  if (edge.type === 'normativeReference') return 'normativeReference';
  if (edge.type === 'history') return 'history';
  return 'other';
}

function synthRelations(lookup: DbLookupResult): DetailRelation[] {
  return lookup.relations.map(edge => {
    const type = relationTypeFor(edge);
    // Outgoing edges name their target (toCodeRaw). Incoming edges name
    // the OTHER end via otherCodeDisplay/otherNormalizedCode when elib
    // could resolve it; unresolved incoming edges stay codeless.
    const outgoing = edge.direction === 'outgoing';
    const otherCode = outgoing
      ? edge.toCodeRaw
      : edge.otherCodeDisplay ?? edge.otherNormalizedCode;
    return {
      type,
      label: type === 'replaces' ? 'Thay thế cho' : type === 'replacedBy' ? 'Được thay thế bởi' : edge.type,
      labelEn: null,
      text: otherCode ?? '',
      code: otherCode ?? null,
      url: null,
      status: null,
      active: null,
      sourceAttributeIndex: -1,
      links: [],
      listItems: []
    };
  });
}

/**
 * Reconstruct a StandardDetail from a DB lookup. Returns null when the
 * record has no usable source snapshot (detail.source is required).
 */
export function detailFromDb(
  lookup: DbLookupResult,
  staleDays: number,
  now: Date = new Date()
): StandardDetail | null {
  const standard = lookup.standard;
  const sourceEntry = lookup.sources.find(entry => VALID_SOURCES.includes(entry.source));
  if (!sourceEntry) return null;
  const source = sourceEntry.source as StandardSource;
  const detailUrl = sourceEntry.detailUrl ?? '';
  const relations = synthRelations(lookup);
  return {
    code: standard.codeDisplay,
    name: standard.titleVi,
    englishName: standard.titleEn,
    year: standard.year,
    status: standard.status,
    issuedDate: standard.issuedDate,
    effectiveDate: standard.effectiveDate,
    issuingAgency: null,
    // Derived by elib from the single-direction relation graph:
    // replacedBy = incoming 'replaces' edge, replaces = outgoing ones.
    replacedBy: lookup.replacedBy,
    replaces: lookup.replaces.length > 0 ? lookup.replaces.join(', ') : null,
    detailUrl,
    ics: standard.ics ?? [],
    source,
    dbInfo: dbInfoFor(lookup, 'db', staleDays, now),
    attributes: synthAttributes(standard),
    relations,
    raw: emptyRaw(detailUrl, standard.titleVi)
  };
}

/** Light-normalized merge key for a live item, or null when unkeyable. */
export function itemKey(item: Pick<Standard, 'code' | 'year'>): string | null {
  return lightNormalizeCode(item.code, item.year ?? null)?.normalized_code ?? null;
}

/**
 * Merge a DB lookup into a live search result (same page):
 * - live items whose normalized_code matches a DB edition gain
 *   lastVerifiedAt + fromDb (live fields win on conflict);
 * - EVERY DB edition with no live counterpart is added as its own
 *   DB-only item (editions carry titles in the lookup payload),
 *   newest first, ahead of the live items;
 * - pagination/sources/partialFailures are left untouched.
 */
export function mergeSearchWithDb(live: SearchResult, lookup: DbLookupResult | null): SearchResult {
  if (!lookup) return live;
  const byKey = new Map<string, string | null>();
  for (const edition of lookup.editions) {
    byKey.set(edition.normalizedCode, edition.lastVerifiedAt);
  }
  byKey.set(lookup.standard.normalizedCode, lookup.standard.lastVerifiedAt);

  const presentKeys = new Set<string>();
  const data = live.data.map(item => {
    const key = itemKey(item);
    if (key === null || !byKey.has(key)) return item;
    presentKeys.add(key);
    return {
      ...item,
      fromDb: true,
      ...(byKey.get(key) ? { lastVerifiedAt: byKey.get(key) as string } : {})
    };
  });

  // DB-only items: the top standard first (it carries the fullest
  // fields), then every other edition not already present live.
  const sourceEntry = lookup.sources.find(entry => VALID_SOURCES.includes(entry.source));
  if (sourceEntry) {
    const dbOnly: Standard[] = [];
    const seen = new Set<string>(presentKeys);
    const pushEdition = (
      normalizedCode: string,
      codeDisplay: string,
      titleVi: string | null,
      titleEn: string | null,
      year: number | null,
      status: string,
      lastVerifiedAt: string | null,
      ics: string[]
    ) => {
      if (seen.has(normalizedCode)) return;
      seen.add(normalizedCode);
      dbOnly.push({
        code: codeDisplay,
        name: titleVi ?? titleEn ?? codeDisplay,
        ...(titleEn ? { englishName: titleEn } : {}),
        ...(year !== null ? { year } : {}),
        status,
        ...(sourceEntry.detailUrl ? { detailUrl: sourceEntry.detailUrl } : {}),
        ics,
        source: sourceEntry.source as StandardSource,
        fromDb: true,
        ...(lastVerifiedAt ? { lastVerifiedAt } : {})
      });
    };
    const standard = lookup.standard;
    pushEdition(
      standard.normalizedCode,
      standard.codeDisplay,
      standard.titleVi,
      standard.titleEn,
      standard.year,
      standard.status,
      standard.lastVerifiedAt,
      standard.ics ?? []
    );
    for (const edition of lookup.editions) {
      pushEdition(
        edition.normalizedCode,
        edition.codeDisplay,
        edition.titleVi,
        edition.titleEn,
        edition.year,
        edition.status,
        edition.lastVerifiedAt,
        []
      );
    }
    data.unshift(...dbOnly);
  }

  return { ...live, data };
}
