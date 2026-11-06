# VSQI Detail Page Extraction — Investigation and Proposed Architecture

Status: **investigation only**. No `src/` or production code has been changed.
Date: 2026-11-06

## 1. Scope and method

I inspected live, publicly accessible VSQI detail pages with the same HTTPS/TLS
setup the service already uses (the bundled GlobalSign intermediate certificate
was added only for the local investigation requests; the production TLS code is
unchanged).

Pages inspected:

- 26 valid detail pages: 23 TCVN pages and 3 QCVN pages.
- The two requested examples: `TCVN 14661:2026` and `TCVN 9143:2022`.
- Additional TCVN pages spanning 1985–2026 and several subject areas.
- QCVN pages, because they expose a different label set and a different detail
  path.
- Search pages and error pages only to understand navigation and failure
  behaviour; they are not extraction targets.

Representative fixtures are saved under:

```text
tests/fixtures/detail-pages/
```

Each fixture is the full public detail page with only the CSRF token values
redacted.

## 2. Pages used as representative fixtures

| Fixture | Why it matters |
|---|---|
| `tcvn-14661-2026.html` | Target example. No page count, price is “Liên hệ/Contact”, one ICS code, scope, 7 normative references, decision, compilation agency, barcode. |
| `tcvn-9143-2022.html` | History timeline, numeric paper/PDF prices, references, decision, compilation agency. |
| `tcvn-4054-2005.html` | Older page with “Thay thế cho”, history timeline, references, numeric prices. |
| `tcvn-5574-2018.html` | “Tiêu chuẩn tương đương”, history, references, compilation agency. |
| `tcvn-9362-2012.html` | Withdrawn status, “Thay thế bằng”, “Quyết định Huỷ bỏ”, specialised field, history pointing to a newer standard. |
| `tcvn-14215-2024.html` | Page count and both paper/PDF prices. |
| `tcvn-1-1-2008.html` | Three-item history timeline, technical committee, replaced-by, references. |
| `tcvn-6-1985.html` | Old standard with equivalence and history. |
| `qcvn-16-2023-bxd.html` | Regulation page with different labels: “Năm công bố, ban hành”, “Cơ quan ban hành”, “Văn bản công bố, ban hành”, “Đối tượng áp dụng”, “Tài liệu viện dẫn”. No English title, ICS, or price. |
| `qcvn-02-16-2012-bnnptnt.html` | Regulation page whose “Thay thế cho” value is prose rather than a standard code. No normative-reference row. |

Across the 26 valid pages there were **320 label/value occurrences** and
**25 distinct Vietnamese labels**. The extractor must not depend on this exact
list; unknown labels must still be preserved.

## 3. Page architecture

The detail page is server-rendered Yii2 HTML. No detail metadata is loaded by
XHR.

The relevant DOM shape is:

```text
div.tieuchuan-view
  h1                                  “Tiêu chuẩn quốc gia” / “Quy chuẩn quốc gia”
  div.tab-content
    div.tab-pane#tab_tieuchuan_thongtinchung_<internal-id>
      div.ean13_font                 barcode text, TCVN only
      table.table.table-striped.table-bordered.detail-view
        tbody
          tr
            td
              div.col-md-2             label block
                strong | b             Vietnamese label
                p.t-anh                optional English label
              div.col-md-10 ...         value block
              div.col-md-4 ...          value block (short values/prices)
              div.col-md-2 ...          another label or empty column
      div.text-right
        a[href="/tieuchuan/add-gio?id=..."]   purchase link
```

Important structural facts:

- Each `tr` normally has one `td`, and that `td` contains a **flat sequence of
  `div[class*="col-md-"]` blocks**. It is not a conventional label/value table.
- A row can contain more than one label/value pair. Example:
  “Số hiệu”, code, “Năm ban hành”, year, “Tình trạng”, status are all in row 1.
- A label block can contain its value inline:
  - `<strong>Năm ban hành</strong> 2026`
  - `<strong>Tình trạng</strong> A - Còn hiệu lực (Active)`
- A label block can leave the value to the next column:
  - `<div class="col-md-2"><strong>Số hiệu</strong>...</div>`
  - `<div class="col-md-2"><strong>TCVN 14661:2026</strong></div>`
- `Giá` is a special label: the colon is outside the `<strong>`, and the value
  may be a link:
  - `<strong>Giá</strong>: <p class="t-anh">Price</p>`
  - `<div class="col-md-4"><a href="javascript:;" data-toggle="modal" ...>Liên hệ/Contact</a></div>`
- Values may contain `<br>` line breaks, links, and nested lists.
- Some rows contain an empty trailing `div.col-md-2`; it must be ignored.
- QCVN pages use the same general layout but different labels and no barcode.

### Source selectors

| Data | Selector |
|---|---|
| Detail container | `div.tieuchuan-view` |
| Detail table | `div.tieuchuan-view table.detail-view` |
| Label block | `table.detail-view tr > td > div[class*="col-md-"]` containing `strong`/`b` and/or `p.t-anh` |
| Vietnamese label | label block `strong:first, b:first` |
| English label | label block `p.t-anh` |
| Value block | next sibling `div[class*="col-md-"]`, or inline text after the label element |
| History list | `ul.timeline` inside the “Lịch sử soát xét” value |
| History item code | `.history_status` |
| History item status | `.history_identity` |
| History item note/active | `.history_review`, `.history_box.active` |
| Barcode | `div.ean13_font` |
| Purchase link | `a[href*="/tieuchuan/add-gio"]` |
| Contact action | `a[href^="javascript:"]` with `data-target="#contactModal"` |
| Page title/SEO | `title`, `meta[name="description"]` |
| Breadcrumb | `ul.breadcrumb` |

These selectors are guidance, not a whitelist. The parser should use structural
classification and fall back to generic label/value detection.

## 4. Field inventory

Counts are over the 26 valid pages. They are evidence of variability, not a
fixed schema.

### 4.1 Common fields

| Label | English label | Count | Example | Notes |
|---|---|---:|---|---|
| Số hiệu | Standard Number | 26/26 | `TCVN 14661:2026` | Required for identity; value usually in next column. |
| Tên tiếng Việt | Title in Vietnamese | 26/26 | `Thi công trên đường bộ đang khai thác – Tổ chức giao thông và bố trí phòng hộ` | Sometimes wrapped in `<b>`. |
| Tình trạng | Status | 26/26 | `A - Còn hiệu lực (Active)` | Inline value; QCVN uses `A - Còn hiệu lực` / `W - Hết hiệu lực`. |
| Năm ban hành | Publication date | 23/26 | `2026` | Inline value. QCVN uses the different label below. |
| Năm công bố, ban hành | Publication date | 3/26 | `2023` | QCVN equivalent of year. |
| Tên tiếng Anh | Title in English | 23/26 | `Works on Roadways – Traffic Control and Traffic Control Devices` | All TCVN pages observed; absent on QCVN pages. |
| Chỉ số phân loại Quốc tế (ICS) | By field | 23/26 | `93.080.10 - Xây dựng đường` | Can contain multiple codes and multiple links. |
| Giá | Price | 23/26 | `Bản Giấy (Paper): 248,000 VNĐ` + `Bản File (PDF):744,000 VNĐ` | Or `Liên hệ/Contact` with a `javascript:` link. |
| Phạm vi áp dụng | Scope of standard | 23/26 | `1.1 Tiêu chuẩn này quy định...` | Multi-paragraph; `<br>` must become newlines. |
| Số trang | Page | 19/26 | `18` | Absent on some recent pages. |
| Quyết định công bố | Decision number | 19/26 | `3511/QĐ-BKHCN , Ngày 31-12-2024` | Value can contain number and date. |
| Tiêu chuẩn viện dẫn | Nomative references | 17/26 | `TCVN 4054, Đường ô tô – Yêu cầu thiết kế` | English label is upstream typo “Nomative”. Values contain many links and `<br>`. |
| Lịch sử soát xét | History of version | 13/26 | `TCVN 9143:2012(W - Hết hiệu lực)` etc. | Structured `<ul class="timeline">`, not plain text. |
| Thay thế cho | Replace / Replaced by | 13/26 | `TCVN 9143:2012` | English label is inconsistent upstream. |
| Cơ quan biên soạn | Compilation agency | 11/26 | `Trường đại học Thuỷ lợi - Bộ Nông nghiệp và Phát triển nông thôn` | Not the same as “Cơ quan ban hành”. |
| Tiêu chuẩn tương đương | Equivalent to | 7/26 | `ISO/IEC 15444-1:2019` + `IDT - Tương đương hoàn toàn` | Often prose plus a relationship code. |
| Thay thế bằng | Replaced by | 5/26 | `TCVN 9362:2026` | Missing from the current parser's alias list. |

### 4.2 Optional/variable fields

| Label | English label | Count | Example |
|---|---|---:|---|
| Ban kỹ thuật | Technical Committee | 3/26 | `TCVN/TC 01 - Vấn đề chung về tiêu chuẩn hóa` |
| Cơ quan ban hành | Agency issued | 3/26 | `Bộ Xây dựng` |
| Đối tượng áp dụng | Subject of application | 3/26 | `Các tổ chức, cá nhân sản xuất, nhập khẩu...` |
| Ngày ban hành | Publication date | 3/26 | `30-06-2023` |
| Văn bản công bố, ban hành | Documents published and issued | 3/26 | `Thông tư 04/2023/TT-BXD` |
| Lĩnh vực chuyên ngành | Specialized field | 2/26 | `3.2.2.8 - Thiết kế địa kỹ thuật` |
| Tài liệu viện dẫn | Nomative references | 2/26 | QCVN equivalent of “Tiêu chuẩn viện dẫn”; may be plain text with no links. |
| Quyết định Huỷ bỏ | Cancellation number | 1/26 | `4261/QĐ-BKHCN 28-10-2026` |

### 4.3 Label and value quirks that the parser must tolerate

- Labels can use `<strong>` or `<b>`.
- Labels can have trailing spaces and a colon outside the label element.
- A value can be in the same block as the label, or in the next one, or in the
  next non-empty column.
- A value can be wrapped in `<strong>` or `<b>` (the code value often is).
- Values can contain `<br>`, links, nested `ul/ol`, and mixed prose/codes.
- Some English labels are inaccurate or inconsistent upstream:
  - “Thay thế cho” is sometimes labelled “Replaced by” even though it means
    “replaces”.
  - “Tiêu chuẩn viện dẫn” is labelled “Nomative references” (typo).
  - “Năm công bố, ban hành” is a year, not a full date.
- Some labels contain punctuation and parentheses: `Chỉ số phân loại Quốc tế (ICS)`.
- QCVN uses “Cơ quan ban hành”, while TCVN uses “Cơ quan biên soạn”.
- QCVN uses “Đối tượng áp dụng” where TCVN uses “Phạm vi áp dụng”.
- A “Thay thế cho” value is not always a standard code; it can be prose about
  another legal document.

## 5. Lists and relations

The only list observed inside the detail table is the history timeline:

```html
<ul class="timeline">
  <li>
    <a href="/tieuchuan/view?sohieu=TCVN 9143:2012">
      <div class="text-blue">
        <div class="history_box">
          <span class="history_status">TCVN 9143:2012</span>
          <span class="history_identity">(W - Hết hiệu lực)</span>
        </div>
      </div>
    </a>
  </li>
  <li>
    <div class="text-blue">
      <div class="history_box active">
        <span class="history_status">TCVN 9143:2022</span>
        <span class="history_identity">(A - Còn Hiệu lực)</span>
      </div>
    </div>
  </li>
</ul>
```

History items can be:

- linked to another standard detail page, or not linked;
- active or inactive (`.history_box.active`);
- a normal code plus status, or a note such as
  `Đang có kế hoạch soát xét` with no code.

Relations can be derived from:

| Relation | Source labels | Link pattern |
|---|---|---|
| replaces | Thay thế cho | `/tieuchuan/view?sohieu=...` |
| replacedBy | Thay thế bằng, Được thay thế bởi, Bị thay thế bởi | `/tieuchuan/view?sohieu=...` |
| history | Lịch sử soát xét | detail links or plain items |
| normativeReference | Tiêu chuẩn viện dẫn, Tài liệu viện dẫn | detail links or `/tim-kiem?si=...` |
| equivalent | Tiêu chuẩn tương đương | often plain text |
| ics | Chỉ số phân loại Quốc tế (ICS) | `/tim-kiem?ic%5B%5D=...` |
| specializedField | Lĩnh vực chuyên ngành | `/tim-kiem?linhvucxaydung%5B%5D=...` |
| committee | Ban kỹ thuật | usually plain text |
| purchase | Giá, purchase button | `/tieuchuan/add-gio?id=...` |
| contact | Giá | `javascript:;` + `data-target="#contactModal"` |

Some normative-reference values (especially QCVN) have **no links at all**.
Relation extraction therefore cannot depend on links being present. The raw
label/value pair must always be kept even when no relation can be structured.

## 6. Links, attachments, images, previews, forms, data, JSON, and endpoints

### Links

Observed link families in detail content:

- `/tieuchuan/view?sohieu=...` — related TCVN detail page.
- `/quychuan/view?sohieu=...` — related QCVN detail page.
- `/tim-kiem?si=...` — search for a referenced standard.
- `/tim-kiem?ic%5B%5D=...` — ICS category search.
- `/tim-kiem?linhvucxaydung%5B%5D=...` — specialised-field search.
- `/tieuchuan/add-gio?id=...` — add standard to purchase cart.
- `javascript:;` with `data-target="#contactModal"` — contact/purchase modal.

### Attachments and full-text documents

No PDF, DOC, DOCX, ZIP, RAR, XLS, or other downloadable document link was found
inside the detail content of the inspected pages.

### Images and embedded previews

No `<img>`, `<iframe>`, `<embed>`, or `<object>` was found inside the detail
content. The TCVN barcode is plain text in `div.ean13_font`; it is not an image.

### Forms

No `<form>` was found inside `.tieuchuan-view`. The newsletter form exists in
the global page chrome and is not standard metadata.

### Data attributes

The only `data-*` attributes in detail content are Bootstrap UI attributes such
as `data-toggle`, `data-target`, `data-keyboard`, and `data-backdrop`. They are
navigation/UI controls, not metadata.

### Embedded JSON and public APIs

- No JSON-LD, `application/json` script, `window.__DATA__`, or similar embedded
  state was found.
- No XHR/fetch detail endpoint was found. Detail metadata is server-rendered.
- Search is a GET form:
  - TCVN: `/tim-kiem?k=...&page=...`
  - QCVN: `/tra-cuu-quy-chuan?k=...` with additional filters such as `si`,
    `st`, `tt`, `df`, `dt`, `linhvuclienquan[]`, `cq`.
- Detail pages:
  - TCVN: `/tieuchuan/view?sohieu=...`
  - QCVN: `/quychuan/view?sohieu=...`
- Purchase: `/tieuchuan/add-gio?id=...`.

**Finding / existing limitation:** `VsqiProvider.getDetail()` currently always
uses `VSQI_DETAIL_PATH` (`/tieuchuan/view`). QCVN detail pages live under
`/quychuan/view`. This is a pre-existing limitation unrelated to the new
extractor. Any QCVN support should be a separate, explicitly reviewed provider
change.

### Security note

The full HTML contains a CSRF token in a hidden newsletter form and a
`csrf-token` meta tag. These are outside the extracted detail container, but the
new extractor must still redact hidden CSRF/password form values if it ever
captures forms.

## 7. Is full document content publicly accessible?

**No.** The public detail page exposes metadata, scope, references, history,
price, and a purchase link, but not the full standard text or a public preview.

Evidence:

- The page ends with a purchase button: `Đặt mua tiêu chuẩn`, linking to
  `/tieuchuan/add-gio?id=...`.
- The price row may show paper/PDF prices or `Liên hệ/Contact` with a contact
  modal.
- The site footer has a “Xem file toàn văn” (view full-text file) path that
  leads to the internal login site `xaydungtieuchuan.vsqi.gov.vn`.
- No public PDF, preview iframe, embedded object, or full-text link was found in
  the detail content.

Therefore the extractor should stop at publicly visible metadata. It must not
log in, add items to a cart, call purchase endpoints, or attempt to retrieve
protected full text. If a future detail page contains a public attachment link,
the extractor may record the link and its metadata, but should not fetch or
bypass any access control.

## 8. Proposed schema

The recommendation is additive: keep every existing `StandardDetail` field and
add three new top-level fields.

```ts
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
  source: 'VSQI';

  // New: original label/value pairs, in DOM order, duplicates preserved.
  attributes: DetailAttribute[];

  // New: structured relations derived from attributes, links, and lists.
  relations: DetailRelation[];

  // New: lossless-ish raw extraction, separate from normalized metadata.
  raw: RawDetail;
}
```

### 8.1 Dynamic attribute

```ts
export type AttributeSourceStrategy =
  | 'vsqi-columns'
  | 'table-header'
  | 'definition-list'
  | 'label-element'
  | 'colon-text'
  | 'fallback';

export interface DetailAttribute {
  order: number;

  // Original Vietnamese label words, with trailing colon removed for display.
  label: string;
  // Original label block text, whitespace-normalized, colon retained if present.
  labelRaw: string;
  // Original English label from p.t-anh, if present.
  labelEn: string | null;

  // Decoded text; <br> becomes \n. null when the label has no value.
  value: string | null;
  // Sanitized HTML fragment for the value. null when there is no value.
  valueHtml: string | null;

  links: DetailLink[];
  lists: DetailList[];

  source: {
    strategy: AttributeSourceStrategy;
    table: number | null;
    row: number | null;
    cell: number | null;
    labelColumn: string | null;
    valueColumns: string[];
    selector: string | null;
  };
}
```

`attributes` is deliberately an array, not a map:

- duplicate labels are preserved;
- unknown labels are preserved;
- order is DOM order;
- empty values are represented as `null`, never invented.

For legacy normalization, the first non-empty occurrence in DOM order wins.
All occurrences remain in `attributes`.

### 8.2 Links

```ts
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
  href: string | null;      // absolute; null for javascript: actions
  kind: LinkKind;
  external: boolean;
  downloadable: boolean;
  title: string | null;
  target: string | null;
  rel: string | null;
  data: Record<string, string>;
}
```

`javascript:;` contact links keep `rawHref: "javascript:;"` but `href: null`
and `kind: "contact"`. Executable URLs are never emitted as usable `href`
values.

### 8.3 Lists

```ts
export interface DetailList {
  tag: 'ul' | 'ol';
  className: string | null;
  items: DetailListItem[];
}

export interface DetailListItem {
  text: string;
  html: string;
  links: DetailLink[];
  history: {
    code: string | null;
    status: string | null;
    note: string | null;
    active: boolean;
  } | null;
}
```

The `history` field is populated only when the item matches the observed
`.history_status` / `.history_identity` / `.history_review` structure. For other
lists it is `null`; the item text/HTML is still preserved.

### 8.4 Relations

```ts
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
  code: string | null;       // parsed only when confidently present
  url: string | null;
  status: string | null;     // history item status, if any
  active: boolean | null;    // history item active flag, if any
  sourceAttributeIndex: number;
  links: DetailLink[];
  listItems: DetailListItem[];
}
```

Relations are derived, but never replace the source attribute. If relation
parsing is uncertain, the raw attribute remains the authoritative record.
For QCVN reference values with no links, a relation can still be emitted with
`url: null` and the original text.

### 8.5 Raw extraction

```ts
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

export interface RawTable {
  index: number;
  kind: 'detail' | 'content';
  className: string | null;
  caption: string | null;
  headers: string[][];
  rows: RawTableRow[];
  html: string;
}

export interface RawTableRow {
  index: number;
  cells: RawTableCell[];
}

export interface RawTableCell {
  tag: 'td' | 'th';
  text: string;
  html: string;
  links: DetailLink[];
  colspan: number | null;
  rowspan: number | null;
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
    value: string | null; // hidden CSRF/password values must be redacted
  }>;
}

export interface DataAttribute {
  tag: string;
  name: string;
  value: string;
}
```

`raw.sections` is the safety net for content outside the detail table: headings,
paragraphs, lists, nested tables, and label/value structures the primary
extractor did not classify. This is how unexpected page structures are preserved
instead of discarded.

### 8.6 Example (abbreviated, TCVN 14661:2026)

```json
{
  "code": "TCVN 14661:2026",
  "name": "Thi công trên đường bộ đang khai thác – Tổ chức giao thông và bố trí phòng hộ",
  "englishName": "Works on Roadways – Traffic Control and Traffic Control Devices",
  "year": 2026,
  "status": "Active",
  "issuedDate": null,
  "effectiveDate": null,
  "issuingAgency": null,
  "replacedBy": null,
  "replaces": null,
  "detailUrl": "https://tieuchuan.vsqi.gov.vn/tieuchuan/view?sohieu=TCVN+14661%3A2026",
  "source": "VSQI",
  "attributes": [
    {
      "order": 0,
      "label": "Số hiệu",
      "labelRaw": "Số hiệu",
      "labelEn": "Standard Number",
      "value": "TCVN 14661:2026",
      "valueHtml": "<strong>TCVN 14661:2026</strong>",
      "links": [],
      "lists": [],
      "source": {
        "strategy": "vsqi-columns",
        "table": 0,
        "row": 0,
        "cell": 0,
        "labelColumn": "col-md-2",
        "valueColumns": ["col-md-2"],
        "selector": "table.detail-view tr:nth-child(1) td:nth-child(1) div:nth-child(2)"
      }
    },
    {
      "order": 1,
      "label": "Năm ban hành",
      "labelRaw": "Năm ban hành",
      "labelEn": "Publication date",
      "value": "2026",
      "valueHtml": "2026",
      "links": [],
      "lists": [],
      "source": {
        "strategy": "vsqi-columns",
        "table": 0,
        "row": 0,
        "cell": 0,
        "labelColumn": "col-md-2",
        "valueColumns": ["col-md-2"],
        "selector": "table.detail-view tr:nth-child(1) td:nth-child(1) div:nth-child(3)"
      }
    }
  ],
  "relations": [],
  "raw": {
    "page": {
      "title": "Tiêu chuẩn: TCVN 14661:2026 - Thi công trên đường bộ đang khai thác – Tổ chức giao thông và bố trí phòng hộ",
      "metaDescription": "Tiêu chuẩn: TCVN 14661:2026 - Thi công trên đường bộ đang khai thác – Tổ chức giao thông và bố trí phòng hộ",
      "heading": "Tiêu chuẩn quốc gia",
      "breadcrumb": ["Trang chủ", "Tra cứu", "Tiêu chuẩn: TCVN 14661:2026"],
      "pageType": "standard",
      "internalId": "46598",
      "barcode": "_8*L9G3L4G0G0L0**R2R1R4R5R6R8*",
      "purchaseUrl": "/tieuchuan/add-gio?id=46598",
      "detailUrl": "https://tieuchuan.vsqi.gov.vn/tieuchuan/view?sohieu=TCVN+14661%3A2026"
    },
    "tables": [],
    "sections": [],
    "lists": [],
    "links": [],
    "documents": [],
    "images": [],
    "embeds": [],
    "forms": [],
    "dataAttributes": [],
    "embeddedData": []
  }
}
```

The example omits most attributes and raw table data for brevity. The real
response would include all 11 attributes observed on that page and the full raw
table/list/link collections.

## 9. Proposed extraction architecture

Keep `parseDetailHtml(html, requestedCode, detailUrl)` as the public entrypoint.
Internally:

```text
parseDetailHtml
  -> load Cheerio once
  -> locate detail container and primary table
  -> extract raw page metadata
  -> extract attributes (VSQI column state machine)
  -> extract generic fallback structures (th/td, dl/dt/dd, labels, colon text)
  -> extract raw tables, sections, lists, links, documents, media, forms, data, JSON
  -> derive relations from attributes/links/lists
  -> normalize legacy fields with alias map
  -> return StandardDetail with attributes, relations, raw
```

### 9.1 VSQI column state machine

For each table row:

1. Get direct child columns (`div[class*="col-"]`) of the row cell.
2. Walk columns in DOM order with a `pendingValue` state.
3. A column is a **high-confidence label** if it contains `p.t-anh`.
4. A column is a **fallback label** if it contains `strong`/`b`, and removing
   the first label element leaves only punctuation/whitespace.
5. Extract the Vietnamese label from the first `strong`/`b` (or the first text
   node for generic structures), the English label from `p.t-anh`, and the
   inline value by removing the label element and English label from a clone.
6. Normalize inline value: if it is only punctuation/whitespace (`:`, `-`, etc.),
   treat it as empty.
7. If there is an inline value, emit the attribute immediately.
8. If there is no inline value, consume the next non-label column as the value.
   This handles code values wrapped in `<strong>`, `Giá` values in the next
   column, and empty trailing columns.
9. For the value, preserve:
   - decoded text with `<br>` → `\n`;
   - sanitized HTML;
   - links;
   - nested lists;
   - source indices.
10. Continue with the rest of the columns, allowing multiple pairs per row.

This avoids hardcoding field names. The only strong assumption is the observed
column pattern; if that pattern changes, the generic fallback takes over.

### 9.2 Generic fallback

If the primary table has no VSQI-style columns, use these strategies in order:

1. Conventional table: `th` as label, following `td` as value.
2. Definition list: `dt` as label, `dd` as value.
3. Label-like elements: `.label`, `.field-label`, `.control-label`,
   `label`, or `strong`/`b` followed by a value.
4. Text ending with `:` or `：`: label before the colon, value after it or in
   the next sibling.
5. Heading + content: capture as `raw.sections` rather than forcing a
   label/value pair.

Every extracted attribute records its `source.strategy`, so consumers can tell
high-confidence VSQI columns from heuristic fallback matches.

### 9.3 Normalization map for legacy fields

| Legacy field | Primary labels | Aliases / rule |
|---|---|---|
| `code` | Số hiệu | Standard Number. Required; missing → invalid upstream structure. |
| `name` | Tên tiếng Việt | Title in Vietnamese. |
| `englishName` | Tên tiếng Anh | Title in English. |
| `year` | Năm ban hành | Năm công bố, ban hành, Publication date. Take the first 4-digit year from the explicit value; if absent, stay `null`. Do not derive from the code. |
| `status` | Tình trạng | Trạng thái, Status. `A` / `Active` / `còn hiệu lực` → `Active`; `W` / `Withdraw` / `Withdrawn` / `hết hiệu lực` / `bị thay thế` → `Withdrawn`; unknown values preserved as-is. |
| `issuedDate` | Ngày ban hành | Ngày công bố. Do not use “Năm …” or “Quyết định công bố” date. |
| `effectiveDate` | Ngày có hiệu lực | Ngày hiệu lực, Ngày bắt đầu có hiệu lực. |
| `issuingAgency` | Cơ quan ban hành | Cơ quan công bố, Agency issued. Do **not** map “Cơ quan biên soạn” here; that is a separate compilation agency. |
| `replacedBy` | Thay thế bằng | Được thay thế bởi, Bị thay thế bởi, Replaced by (when the Vietnamese label is a replacement-by label). |
| `replaces` | Thay thế cho | Replace. Use the Vietnamese label, not the inconsistent English label, to decide direction. |

Rules:

- Missing legacy fields become `null`, exactly as today.
- Do not invent values from unrelated fields.
- If duplicate labels exist, the first non-empty value in DOM order wins for the
  legacy field; every occurrence remains in `attributes`.
- Preserve the original `status` text in `attributes` even after normalizing the
  legacy `status` field.

## 10. Backward compatibility

- The existing `code`, `name`, `englishName`, `year`, `status`, `issuedDate`,
  `effectiveDate`, `issuingAgency`, `replacedBy`, `replaces`, `detailUrl`, and
  `source` fields keep their names, types, and meanings.
- New fields are additive. Clients that ignore them are unaffected.
- `parseDetailHtml` keeps its signature and its current failure semantics:
  - code mismatch → `null`;
  - missing expected detail structure → `INVALID_UPSTREAM_HTML` `VsqiError`.
- The Search response contract is untouched. The Search parser is not part of
  this change.
- `StandardProvider` and the API routes are untouched.
- The cache validator `isStandardDetail` ignores unknown fields, so the new
  fields pass through without a cache change. The cache should be monitored for
  response-size growth if raw content is enabled.
- The TLS workaround and HTTP client remain unchanged.
- Existing tests that use exact object equality will need to be updated to
  `toMatchObject` or to include the new fields. That is test maintenance, not an
  API contract break.

### Optional, separate provider change (not part of this extractor)

If QCVN support is desired later, `VsqiProvider.getDetail()` should select the
detail path by code prefix or configuration:

- TCVN → `/tieuchuan/view`
- QCVN → `/quychuan/view`

It may also need a QCVN search path (`/tra-cuu-quy-chuan`). This is a separate
provider/API change and should be reviewed independently. The extractor itself
should support both page structures regardless.

## 11. Error handling and edge cases

- **Missing optional field:** legacy field `null`; no attribute is created
  unless a real label block exists.
- **Label present but empty value:** attribute with `value: null`,
  `valueHtml: null`; do not substitute an empty string or a derived value.
- **Unknown label:** preserve it in `attributes`; do not drop it.
- **Multiple detail tables:** parse the primary `table.detail-view`; include all
  tables in `raw.tables`. If there is no `.detail-view`, choose the largest
  table containing label/value-like columns, then use the generic fallback.
- **No `.tieuchuan-view` container:** try `.quychuan-view`, then `#main`,
  `main`, or the body minus global nav/footer; record the strategy used.
- **Code mismatch:** return `null` before building a full result, preserving the
  existing lookup behaviour.
- **No recognizable structure:** throw
  `VsqiError('VSQI detail page has an unexpected structure', 'INVALID_UPSTREAM_HTML', 502)`.
- **Error page / HTTP 500:** handled by the existing `HttpClient` as an upstream
  HTTP error; the parser is not reached.
- **Malformed embedded JSON:** skip that script block; do not fail the page.
- **Nested malformed HTML:** Cheerio tolerates it; never let one bad field abort
  extraction of the rest.
- **Forms:** if captured, redact hidden CSRF/password values. Prefer not to
  capture global page forms at all.
- **Raw HTML:** strip `<script>`, `<style>`, event-handler attributes, and
  executable URLs. Do not execute or fetch anything.

## 12. Test plan

### Fixtures

Use the saved fixtures plus one synthetic fixture for structures not present in
the live pages:

- `tcvn-14661-2026.html`
- `tcvn-9143-2022.html`
- `tcvn-4054-2005.html`
- `tcvn-5574-2018.html`
- `tcvn-9362-2012.html`
- `tcvn-14215-2024.html`
- `tcvn-1-1-2008.html`
- `tcvn-6-1985.html`
- `qcvn-16-2023-bxd.html`
- `qcvn-02-16-2012-bnnptnt.html`
- `synthetic-generic-detail.html` (to be added during implementation) covering
  `<th>/<td>`, `<dl>/<dt>/<dd>`, nested tables, lists, public attachment links,
  images, iframes, forms, data attributes, and JSON-LD.

### Tests

1. Legacy fields remain correct for the existing fixture.
2. Target TCVN 14661:2026 extracts all 11 observed attributes in order.
3. TCVN 9143:2022 extracts history list, numeric prices, references, and
   compilation agency.
4. TCVN 9362:2012 maps “Thay thế bằng” to `replacedBy`, normalizes `W` status to
   `Withdrawn`, and preserves “Quyết định Huỷ bỏ” in attributes.
5. QCVN 16:2023/BXD maps “Năm công bố, ban hành” to `year`, “Cơ quan ban hành”
   to `issuingAgency`, and preserves the regulation-specific labels.
6. QCVN 02-16:2012/BNNPTNT preserves a prose “Thay thế cho” value without
   inventing a standard code.
7. Unknown label/value pairs are preserved.
8. Duplicate labels are preserved as separate attributes; legacy normalization
   uses the first non-empty occurrence.
9. Empty values become `null`, not `""`.
10. `<br>` values produce newlines; links are absolute; `javascript:` links have
    `href: null` and `kind: "contact"`.
11. History timeline items expose code, status, active flag, and note.
12. Normative references with and without links are both preserved.
13. Raw tables, sections, lists, links, images, embeds, forms, data attributes,
    and embedded JSON are captured where present.
14. Sanitization removes scripts/event handlers and redacts CSRF tokens.
15. No structure → `INVALID_UPSTREAM_HTML`; code mismatch → `null`.
16. Search and detail API legacy response fields remain unchanged; new fields
    are additive.
17. Cached detail responses still validate and round-trip new fields.

Tests should use fixtures only; no live network calls.

## 13. Open questions for review

1. Should QCVN path/search support be included in the same change, or kept as a
   separate provider change? Recommendation: separate.
2. Do we want typed convenience fields for common optional data (`ics`,
   `pages`, `price`, `scope`, `technicalCommittee`, `compilationAgency`) in
   addition to `attributes`? Recommendation: start with `attributes` + `raw`;
   add a nested normalized object later only if consumers need it.
3. Should `raw` expose sanitized HTML fragments, or only structured text/links?
   Recommendation: sanitized fragments for field values and tables, not the
   entire page HTML. This keeps responses smaller and avoids storing page chrome.
4. Should a label with an empty value be emitted as an attribute with
   `value: null`, or omitted? Recommendation: emit it, because the label's
   presence is real page data; `null` avoids inventing a value.
5. Should public attachment links be fetched? Recommendation: no. Record link
   metadata only. This avoids crossing into access-controlled content.
6. Should `raw.links` include page navigation/footer links? Recommendation: no;
   restrict to the detail container and page-level metadata. Include page
   title/meta/breadcrumb separately in `raw.page`.
7. For duplicate labels, first non-empty vs last non-empty for legacy
   normalization? Recommendation: first non-empty, with all occurrences kept.

## 14. Summary

- VSQI detail pages are server-rendered tables with a flat column layout, not a
  conventional key/value table.
- The label set is not stable: TCVN and QCVN use different names for year,
  agency, scope, and references; optional fields vary widely.
- The safest design is a dynamic `attributes` array plus a separate `raw`
  collection, with only a small alias map for the legacy fields.
- The only structured relation list observed is the history timeline; other
  relations come from links and label context.
- No public full text, attachments, previews, images, forms, or detail JSON API
  were found. Full text is paid/internal and must not be accessed or bypassed.
- The existing TLS workaround, HTTP client, Search contract, and legacy Detail
  fields can remain intact.

Once this investigation and schema are reviewed, implementation can proceed
against the saved fixtures without touching the existing Search contract.
