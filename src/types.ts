/** Where a standard record came from. VSQI is the original HTML-scraped
 *  source; TCVN_VN / TCVN_QT are the tracuu.tcvn.vn JSON API (Vietnamese /
 *  international standards). */
export type StandardSource = 'VSQI' | 'TCVN_VN' | 'TCVN_QT';

export interface Standard {
  code: string;
  name: string;
  englishName?: string;
  year?: number;
  status?: string;
  detailUrl?: string;
  source: StandardSource;
}

export type AttributeSourceStrategy =
  | 'vsqi-columns'
  | 'table-header'
  | 'definition-list'
  | 'label-element'
  | 'colon-text'
  | 'fallback';

export type LinkKind =
  | 'detail'
  | 'search'
  | 'ics'
  | 'specialized-field'
  | 'purchase'
  | 'contact'
  | 'download'
  | 'external'
  | 'other';

export interface DetailLink {
  text: string;
  rawHref: string;
  /** Absolute HTTP(S) URL, or null for executable/non-navigable URLs. */
  href: string | null;
  kind: LinkKind;
  external: boolean;
  downloadable: boolean;
  title: string | null;
  target: string | null;
  rel: string | null;
  data: Record<string, string>;
}

export interface DetailHistory {
  code: string | null;
  status: string | null;
  note: string | null;
  active: boolean;
}

export interface DetailListItem {
  text: string;
  html: string;
  links: DetailLink[];
  history: DetailHistory | null;
}

export interface DetailList {
  tag: 'ul' | 'ol';
  className: string | null;
  items: DetailListItem[];
}

export interface DetailAttributeSource {
  strategy: AttributeSourceStrategy;
  table: number | null;
  row: number | null;
  cell: number | null;
  labelColumn: string | null;
  valueColumns: string[];
  selector: string | null;
}

export interface DetailAttribute {
  order: number;

  /** Original Vietnamese label, trailing colon removed. */
  label: string;
  /** Original label block text, whitespace-normalized; a trailing colon is retained. */
  labelRaw: string;
  /** Original English label from p.t-anh, if present. */
  labelEn: string | null;

  /** Decoded text; <br> becomes \n. null when the label has no value. */
  value: string | null;
  /** Sanitized HTML fragment for the value. null when there is no value. */
  valueHtml: string | null;

  links: DetailLink[];
  lists: DetailList[];

  source: DetailAttributeSource;
}

export type RelationType =
  | 'replaces'
  | 'replacedBy'
  | 'history'
  | 'normativeReference'
  | 'equivalent'
  | 'ics'
  | 'specializedField'
  | 'committee'
  | 'purchase'
  | 'contact'
  | 'other';

export interface DetailRelation {
  type: RelationType;
  label: string;
  labelEn: string | null;
  text: string;
  /** Parsed only when a standard/document code is confidently present. */
  code: string | null;
  url: string | null;
  status: string | null;
  active: boolean | null;
  /** Index into StandardDetail.attributes; -1 for page-level relations. */
  sourceAttributeIndex: number;
  links: DetailLink[];
  listItems: DetailListItem[];
}

export interface RawPage {
  title: string | null;
  metaDescription: string | null;
  heading: string | null;
  breadcrumb: string[];
  pageType: 'standard' | 'regulation' | 'unknown';
  internalId: string | null;
  barcode: string | null;
  purchaseUrl: string | null;
  detailUrl: string;
}

export interface RawTableCell {
  tag: 'td' | 'th';
  text: string;
  html: string;
  links: DetailLink[];
  colspan: number | null;
  rowspan: number | null;
}

export interface RawTableRow {
  index: number;
  cells: RawTableCell[];
}

export interface RawTable {
  index: number;
  kind: 'detail' | 'content';
  className: string | null;
  caption: string | null;
  headers: string[][];
  rows: RawTableRow[];
  html: string;
}

export interface RawSection {
  heading: string | null;
  level: number | null;
  text: string;
  html: string;
  links: DetailLink[];
  lists: DetailList[];
  tables: RawTable[];
}

export interface DocumentLink {
  text: string;
  href: string | null;
  rawHref: string;
  kind: 'purchase' | 'contact' | 'attachment' | 'fullText' | 'other';
  downloadable: boolean;
}

export interface RawImage {
  src: string | null;
  alt: string | null;
  title: string | null;
  width: string | null;
  height: string | null;
}

export interface RawEmbed {
  tag: 'iframe' | 'embed' | 'object';
  src: string | null;
  type: string | null;
}

export interface RawForm {
  action: string | null;
  method: string | null;
  fields: Array<{
    name: string | null;
    type: string | null;
    /** Hidden CSRF/password/session values are always redacted. */
    value: string | null;
  }>;
}

export interface DataAttribute {
  tag: string;
  name: string;
  value: string;
}

export interface RawDetail {
  page: RawPage;
  tables: RawTable[];
  sections: RawSection[];
  lists: DetailList[];
  links: DetailLink[];
  documents: DocumentLink[];
  images: RawImage[];
  embeds: RawEmbed[];
  forms: RawForm[];
  dataAttributes: DataAttribute[];
  embeddedData: unknown[];
}

export interface StandardDetail {
  // Existing fields — unchanged in name, type, and meaning.
  code: string;
  name: string | null;
  englishName: string | null;
  year: number | null;
  status: string | null;
  issuedDate: string | null;
  effectiveDate: string | null;
  issuingAgency: string | null;
  replacedBy: string | null;
  replaces: string | null;
  detailUrl: string;
  source: StandardSource;

  // Original label/value pairs, in DOM order, duplicates preserved.
  attributes: DetailAttribute[];

  // Structured relations derived from attributes, links, and lists.
  relations: DetailRelation[];

  // Raw extraction kept separate from normalized metadata.
  raw: RawDetail;
}

export interface SearchSourceSummary {
  /** The upstream source this summary describes. */
  source: StandardSource;
  /** False when this source failed (or was disabled); its records are absent. */
  ok: boolean;
  /** Total matching records reported by this source, if known. */
  totalResults?: number;
  /** Total pages at this source's page size, if known. */
  totalPages?: number;
  /** Machine-readable error code when ok is false; no internal details. */
  error?: string;
}

export interface SearchResult {
  data: Standard[];
  pagination: {
    currentPage: number;
    /** Omitted for merged results: paging is per source, see `sources`. */
    totalPages?: number;
    /** Sum of the per-source totals of the sources that succeeded. */
    totalResults?: number;
  };
  /** A single source's id for a single-source result, 'MULTI' for a
   *  merged 3-source result. */
  source: StandardSource | 'MULTI';
  /** Per-source outcome, in merge order (VSQI, TCVN_VN, TCVN_QT). Present on
   *  merged results; use it for per-source totals and partial failures. */
  sources?: SearchSourceSummary[];
  /** Sources that failed or were disabled during this search, if any. Their
   *  records are absent from `data`; the other sources still returned. */
  partialFailures?: StandardSource[];
}

export interface SearchInput {
  query: string;
  page: number;
}

export interface StandardProvider {
  search(input: SearchInput): Promise<SearchResult>;
  /**
   * Look up one standard by code. When `source` is given, only that source
   * is consulted; otherwise providers are tried in merge order (VSQI, then
   * TCVN_VN, then TCVN_QT) and the first hit wins. Single-source providers
   * may ignore `source`.
   */
  getDetail(code: string, source?: StandardSource): Promise<StandardDetail | null>;
}
