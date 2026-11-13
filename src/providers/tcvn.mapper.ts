import { VsqiError } from '../errors.js';
import type {
  DetailAttribute,
  DetailRelation,
  RawDetail,
  Standard,
  StandardDetail,
  StandardSource
} from '../types.js';

/**
 * Mapping between tracuu.tcvn.vn front-api JSON and the app's types.
 *
 * SECURITY: TCVN detail responses embed a staff-user object (`updatedBy`)
 * containing a password hash, plus other internal fields (`vnuserin`,
 * `@timestamp`, `fileUrl`, ...). This module is the only place that touches
 * raw TCVN records, and it whitelists fields one by one. It never spreads,
 * logs, or returns a raw record, and it never exposes file-download fields
 * (`vb`, `fileUrl`): this service returns metadata only, never full
 * standard documents.
 */

// --- raw record access (whitelisted keys only) -----------------------------

type RawRecord = Record<string, unknown>;

function asRecord(value: unknown): RawRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RawRecord)
    : null;
}

function str(record: RawRecord, key: string): string | null {
  const value = record[key];
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Split a `*`-separated field (ICS codes, equivalents) into clean parts. */
function starSplit(value: string | null): string[] {
  if (!value) return [];
  return value.split('*').map(part => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** ICS codes from the `ca` string and from `categories[].categoryCode`. */
export function tcvnIcs(record: RawRecord): string[] {
  const codes: string[] = [];
  for (const code of starSplit(str(record, 'ca'))) {
    if (!codes.includes(code)) codes.push(code);
  }
  const categories = record['categories'];
  if (Array.isArray(categories)) {
    for (const entry of categories) {
      const item = asRecord(entry);
      const code = item ? str(item, 'categoryCode') : null;
      if (code && !codes.includes(code)) codes.push(code);
    }
  }
  return codes;
}

/** `up`: A = effective, H = expired. Anything else maps to undefined. */
export function tcvnStatus(record: RawRecord): 'Active' | 'Withdrawn' | undefined {
  const up = str(record, 'up');
  if (up === 'A') return 'Active';
  if (up === 'H') return 'Withdrawn';
  return undefined;
}

/** Year from the code (`:YYYY`), else the publication/issue date prefix. */
export function tcvnYear(record: RawRecord): number | undefined {
  const code = str(record, 'di');
  const fromCode = code?.match(/:(\d{4})\s*$/);
  if (fromCode) return Number(fromCode[1]);
  for (const key of ['dp', 'pi']) {
    const match = str(record, key)?.match(/^(\d{4})-/);
    if (match) return Number(match[1]);
  }
  return undefined;
}

/** Front-api detail URL for a record key (the app has no HTML detail page). */
export function tcvnDetailUrl(
  kind: 'VN' | 'QT',
  baseUrl: string,
  key: string | null
): string | undefined {
  if (!key) return undefined;
  const segment = kind === 'VN' ? 'vs-standard' : 'is-standard';
  return `${baseUrl.replace(/\/$/, '')}/${segment}/${encodeURIComponent(key)}`;
}

function titles(
  record: RawRecord,
  kind: 'VN' | 'QT'
): { name: string; englishName?: string } {
  // On IS records `tn` is a non-English (e.g. Spanish) title, never the
  // Vietnamese name — ignore it there and use the English title instead.
  const ti = str(record, 'ti');
  const tn = kind === 'VN' ? str(record, 'tn') : null;
  const code = str(record, 'di') ?? '';
  if (kind === 'VN') {
    return { name: tn ?? ti ?? code, ...(ti ? { englishName: ti } : {}) };
  }
  return { name: ti ?? code, ...(ti ? { englishName: ti } : {}) };
}

// --- search / list shapes ---------------------------------------------------

export interface TcvnSearchPage {
  total: number;
  records: RawRecord[];
}

export function parseTcvnSearchResponse(payload: unknown): TcvnSearchPage {
  const body = asRecord(payload);
  if (!body || !Array.isArray(body['data'])) {
    throw new VsqiError('TCVN search response has an unexpected structure', 'INVALID_UPSTREAM_RESPONSE', 502);
  }
  const total = typeof body['total'] === 'number' ? body['total'] : body['data'].length;
  const records = (body['data'] as unknown[]).map(asRecord).filter((r): r is RawRecord => r !== null);
  return { total, records };
}

export function mapTcvnSearchRecord(
  record: RawRecord,
  kind: 'VN' | 'QT',
  baseUrl: string
): Standard | null {
  const code = str(record, 'di');
  if (!code) return null;
  const source: StandardSource = kind === 'VN' ? 'TCVN_VN' : 'TCVN_QT';
  const { name, englishName } = titles(record, kind);
  const year = tcvnYear(record);
  const status = tcvnStatus(record);
  const detailUrl = tcvnDetailUrl(kind, baseUrl, str(record, 'key'));
  return {
    code,
    name,
    ...(englishName ? { englishName } : {}),
    ...(year !== undefined ? { year } : {}),
    ...(status ? { status } : {}),
    ...(detailUrl ? { detailUrl } : {}),
    source
  };
}

// --- detail ------------------------------------------------------------------

function emptyRaw(detailUrl: string, key: string | null, name: string | null): RawDetail {
  return {
    page: {
      title: name,
      metaDescription: null,
      heading: null,
      breadcrumb: [],
      pageType: 'standard',
      internalId: key,
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

function detailAttributes(record: RawRecord, kind: 'VN' | 'QT'): DetailAttribute[] {
  const rows: Array<{ label: string; labelEn: string; value: string | null }> = [
    { label: 'Số hiệu', labelEn: 'Standard code', value: str(record, 'di') },
    ...(kind === 'VN'
      ? [{ label: 'Tên tiếng Việt', labelEn: 'Vietnamese title', value: str(record, 'tn') }]
      : []),
    { label: 'Tên tiếng Anh', labelEn: 'English title', value: str(record, 'ti') },
    {
      label: 'Năm ban hành',
      labelEn: 'Year',
      value: tcvnYear(record) !== undefined ? String(tcvnYear(record)) : null
    },
    { label: 'Tình trạng', labelEn: 'Status', value: tcvnStatus(record) ?? null },
    { label: 'Số trang', labelEn: 'Pages', value: str(record, 'fm') },
    kind === 'VN'
      ? { label: 'Ngày ban hành / Quyết định', labelEn: 'Issue date / decision', value: str(record, 'pi') }
      : { label: 'Ngày công bố', labelEn: 'Publication date', value: str(record, 'dp') },
    { label: 'Thay thế cho', labelEn: 'Replaces', value: str(record, 'rz') },
    { label: 'Được thay thế bởi', labelEn: 'Replaced by', value: str(record, 'rx') },
    { label: 'Tương đương', labelEn: 'Equivalent', value: str(record, 'ii') },
    {
      label: 'Mã ICS',
      labelEn: 'ICS codes',
      value: tcvnIcs(record).join(', ') || null
    }
  ];

  return rows
    .filter(row => row.value !== null)
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

function detailRelations(record: RawRecord, attributes: DetailAttribute[]): DetailRelation[] {
  const relations: DetailRelation[] = [];
  const attrIndex = (label: string): number =>
    attributes.findIndex(attribute => attribute.label === label);

  const replaces = str(record, 'rz');
  if (replaces) {
    relations.push({
      type: 'replaces',
      label: 'Thay thế cho',
      labelEn: 'Replaces',
      text: replaces,
      code: replaces,
      url: null,
      status: null,
      active: null,
      sourceAttributeIndex: attrIndex('Thay thế cho'),
      links: [],
      listItems: []
    });
  }
  const replacedBy = str(record, 'rx');
  if (replacedBy) {
    relations.push({
      type: 'replacedBy',
      label: 'Được thay thế bởi',
      labelEn: 'Replaced by',
      text: replacedBy,
      code: replacedBy,
      url: null,
      status: null,
      active: null,
      sourceAttributeIndex: attrIndex('Được thay thế bởi'),
      links: [],
      listItems: []
    });
  }
  const equivalents = str(record, 'ii');
  if (equivalents) {
    relations.push({
      type: 'equivalent',
      label: 'Tương đương',
      labelEn: 'Equivalent',
      text: equivalents,
      code: null,
      url: null,
      status: null,
      active: null,
      sourceAttributeIndex: attrIndex('Tương đương'),
      links: [],
      listItems: []
    });
  }
  for (const ics of tcvnIcs(record)) {
    relations.push({
      type: 'ics',
      label: 'Mã ICS',
      labelEn: 'ICS codes',
      text: ics,
      code: null,
      url: null,
      status: null,
      active: null,
      sourceAttributeIndex: attrIndex('Mã ICS'),
      links: [],
      listItems: []
    });
  }
  return relations;
}

export function mapTcvnDetail(
  record: unknown,
  kind: 'VN' | 'QT',
  baseUrl: string
): StandardDetail | null {
  const data = asRecord(record);
  if (!data) return null;
  const code = str(data, 'di');
  if (!code) return null;
  const source: StandardSource = kind === 'VN' ? 'TCVN_VN' : 'TCVN_QT';
  const { name, englishName } = titles(data, kind);
  const year = tcvnYear(data);
  const status = tcvnStatus(data);
  const key = str(data, 'key');
  const detailUrl = tcvnDetailUrl(kind, baseUrl, key) ?? '';
  const attributes = detailAttributes(data, kind);
  const issuedDate =
    kind === 'VN'
      ? (str(data, 'pi')?.split(',')[0] ?? null)
      : (str(data, 'dp') ?? null);
  return {
    code,
    name,
    englishName: englishName ?? null,
    year: year ?? null,
    status: status ?? null,
    issuedDate,
    effectiveDate: null,
    issuingAgency: null,
    replacedBy: str(data, 'rx'),
    replaces: str(data, 'rz'),
    detailUrl,
    source,
    attributes,
    relations: detailRelations(data, attributes),
    // No raw HTML exists for TCVN records; the raw section carries only the
    // record key and detail URL, never the upstream JSON.
    raw: emptyRaw(detailUrl, key, name)
  };
}

// --- query routing -----------------------------------------------------------

/** Organisation codes the QT search accepts, in fan-out priority order. */
export const QT_ORG_PRIORITY = [
  'ISO', 'IEC', 'ASTM', 'BS', 'DIN', 'EN', 'JIS', 'ANSI', 'AS', 'UL', 'TCTQ/GB'
] as const;

/** Leading query token (upper-cased, part before '/') -> QT orgCode. */
const QT_ORG_BY_TOKEN: Record<string, string> = {
  ISO: 'ISO',
  IEC: 'IEC',
  ASTM: 'ASTM',
  BS: 'BS',
  DIN: 'DIN',
  EN: 'EN',
  JIS: 'JIS',
  UL: 'UL',
  ANSI: 'ANSI',
  AS: 'AS',
  GB: 'TCTQ/GB',
  TCTQ: 'TCTQ/GB'
};

/**
 * Organisation for a QT code query, from its leading token
 * ("ISO 9001" -> ISO, "EN ISO 9001" -> EN, "GB/T 19001" -> TCTQ/GB).
 * Returns null for title queries or unknown prefixes. Never returns 'ALL':
 * the backend treats orgCode=ALL as "no organisation" and returns nothing.
 */
export function detectQtOrg(query: string): string | null {
  const firstToken = query.trim().split(/\s+/)[0] ?? '';
  if (!firstToken || !/\d/.test(query)) return null;
  const token = firstToken.split('/')[0]?.toUpperCase();
  return token ? (QT_ORG_BY_TOKEN[token] ?? null) : null;
}

/** True when a VN query is a code lookup (TCVN/QCVN code, or has a :year). */
export function isTcvnCodeQuery(query: string): boolean {
  const trimmed = query.trim();
  return /^(TCVN|QCVN)\b/i.test(trimmed) || /:\d{4}\s*$/.test(trimmed);
}

/**
 * Enabled organisations from GET /is-standard/is-organization/all,
 * ordered by fan-out priority. Disabled entries (e.g. JISimport) are
 * dropped; the list is only ever used to pick real orgCodes.
 */
export function parseTcvnOrgList(payload: unknown): string[] {
  if (!Array.isArray(payload)) return [];
  const enabled: string[] = [];
  for (const entry of payload) {
    const item = asRecord(entry);
    if (!item) continue;
    const code = str(item, 'code');
    if (code && item['enabled'] === true && code !== 'JISimport' && !enabled.includes(code)) {
      enabled.push(code);
    }
  }
  const priority = [...QT_ORG_PRIORITY];
  return [...enabled].sort((a, b) => {
    const ai = priority.indexOf(a as (typeof QT_ORG_PRIORITY)[number]);
    const bi = priority.indexOf(b as (typeof QT_ORG_PRIORITY)[number]);
    return (ai === -1 ? priority.length : ai) - (bi === -1 ? priority.length : bi);
  });
}
