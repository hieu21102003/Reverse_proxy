import { describe, expect, it, vi } from 'vitest';
import '../public/playground.js';

interface TextItemLike {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
  width?: number;
  height?: number;
  type?: string;
}

interface ItemSpan {
  rawStart: number;
  rawEnd: number;
  itemIndex: number;
  itemStart: number;
}

interface ExtractedPage {
  rawText: string;
  itemSpans: ItemSpan[];
  optionalHyphenOffsets: number[];
  nonSpaceCount: number;
  twoColumnDetected: boolean;
}

interface SearchMatch {
  id: string;
  pageNum: number;
  pageMatchIndex: number;
  rawStart: number;
  rawEnd: number;
  itemRanges: Array<{ itemIndex: number; start: number; end: number }>;
  snippet: { prefix: string; match: string; suffix: string; text: string };
}

interface SearchSnapshot {
  status: 'idle' | 'indexing' | 'ready' | 'no_text_layer' | 'cancelled';
  indexedPages: number;
  totalPages: number;
  pagesWithText: number;
  emptyTextPages: number;
  partialNoTextLayer: boolean;
  provisionalNoText: boolean;
  hasTextLayer: boolean | null;
  query: string;
  normQuery: string;
  queryTooShort: boolean;
  options: { caseSensitive: boolean; ignoreDiacritics: boolean };
  matches: SearchMatch[];
  totalMatches: number;
  truncated: boolean;
}

interface PdfSearchEngine {
  startIndexing: () => Promise<SearchSnapshot>;
  setQuery: (query: string, opts?: { caseSensitive?: boolean; ignoreDiacritics?: boolean }) => SearchSnapshot;
  clearQuery: () => SearchSnapshot;
  cancel: () => void;
  getSnapshot: () => SearchSnapshot;
  getPageCache: (pageNum: number) => unknown;
  estimateMemoryBytes: () => number;
}

interface SearchHelpers {
  PDF_SEARCH_MIN_QUERY_LENGTH: number;
  PDF_SEARCH_MAX_RESULTS: number;
  PDF_SEARCH_SNIPPET_MAX_LENGTH: number;
  PDF_SEARCH_BATCH_SIZE: number;
  PDF_SEARCH_NO_TEXT_PROBE_PAGES: number;
  extractPageText: (textContent: { items?: TextItemLike[] } | null) => ExtractedPage;
  normalizeSearchTextWithMap: (rawText: string, options?: { caseSensitive?: boolean; ignoreDiacritics?: boolean }) => {
    text: string;
    rawStarts: Uint32Array;
    rawEnds: Uint32Array;
  };
  normalizeSearchQuery: (query: string, options?: { caseSensitive?: boolean; ignoreDiacritics?: boolean }) => string;
  mapRawRangeToItemRanges: (itemSpans: ItemSpan[], rawStart: number, rawEnd: number) => Array<{ itemIndex: number; start: number; end: number }>;
  buildMatchSnippet: (rawText: string, rawStart: number, rawEnd: number, maxLength?: number) => { prefix: string; match: string; suffix: string; text: string };
  searchPageText: (pageEntry: { pageNum: number; rawText: string; itemSpans: ItemSpan[]; normCache?: unknown }, normQuery: string, options?: Record<string, unknown>) => { matches: SearchMatch[]; truncated: boolean };
  createPdfSearchEngine: (config: {
    pdf: { numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: TextItemLike[] }> }> } | null;
    batchSize?: number;
    noTextProbePages?: number;
    maxResults?: number;
    snippetMaxLength?: number;
    yieldToMain?: () => Promise<void>;
    onUpdate?: (snapshot: SearchSnapshot) => void;
  }) => PdfSearchEngine;
}

const helpers = (globalThis as unknown as { __smartrailFileHelpers: SearchHelpers }).__smartrailFileHelpers;

function makeBoxItem(str: string, x: number, y: number, width: number, fontSize = 10): TextItemLike {
  return {
    str,
    transform: [fontSize, 0, 0, fontSize, x, y],
    width,
    height: fontSize
  };
}

function makeMockPdf(pagesItems: Array<TextItemLike[] | (() => Promise<{ items: TextItemLike[] }>)>, overrides?: { onGetPage?: (pageNum: number) => void }) {
  return {
    numPages: pagesItems.length,
    getPage: vi.fn(async (pageNum: number) => {
      overrides?.onGetPage?.(pageNum);
      if (pageNum < 1 || pageNum > pagesItems.length) {
        throw new Error(`Unexpected getPage(${pageNum})`);
      }
      const entry = pagesItems[pageNum - 1];
      return {
        getTextContent: vi.fn(async () => {
          if (typeof entry === 'function') return entry();
          return { items: entry };
        })
      };
    })
  };
}

describe('PDF in-document search core (S1)', () => {
  describe('normalizeSearchTextWithMap & normalizeSearchQuery', () => {
    it('handles NFC vs NFD Vietnamese text and preserves full cluster raw bounds including combining marks', () => {
      const decomposed = 'Tieu chuan Vie\u0302\u0323t Nam ve duong sat';
      const mapped = helpers.normalizeSearchTextWithMap(decomposed, { caseSensitive: false, ignoreDiacritics: false });
      const query = helpers.normalizeSearchQuery('Việt Nam', { caseSensitive: false, ignoreDiacritics: false });
      const idx = mapped.text.indexOf(query);
      expect(idx).toBeGreaterThan(-1);
      const rawStart = mapped.rawStarts[idx];
      const rawEnd = mapped.rawEnds[idx + query.length - 1];
      expect(decomposed.slice(rawStart, rawEnd)).toBe('Vie\u0302\u0323t Nam');
    });

    it('supports all four combinations of caseSensitive and ignoreDiacritics including đ/Đ and Vietnamese vowels', () => {
      const source = 'Tiêu chuẩn Đường sắt ĐÔ THỊ ơ ư ă â ê ô';
      const entry = { pageNum: 1, rawText: source, itemSpans: [] };

      const q1 = helpers.normalizeSearchQuery('duong sat do thi', { caseSensitive: false, ignoreDiacritics: true });
      expect(helpers.searchPageText(entry, q1, { caseSensitive: false, ignoreDiacritics: true }).matches).toHaveLength(1);

      const q2 = helpers.normalizeSearchQuery('Đường sắt ĐÔ THỊ', { caseSensitive: false, ignoreDiacritics: false });
      expect(helpers.searchPageText(entry, q2, { caseSensitive: false, ignoreDiacritics: false }).matches).toHaveLength(1);
      const q2Miss = helpers.normalizeSearchQuery('duong sat do thi', { caseSensitive: false, ignoreDiacritics: false });
      expect(helpers.searchPageText(entry, q2Miss, { caseSensitive: false, ignoreDiacritics: false }).matches).toHaveLength(0);

      const q3 = helpers.normalizeSearchQuery('Duong sat DO THI', { caseSensitive: true, ignoreDiacritics: true });
      expect(helpers.searchPageText(entry, q3, { caseSensitive: true, ignoreDiacritics: true }).matches).toHaveLength(1);
      const q3Miss = helpers.normalizeSearchQuery('duong sat do thi', { caseSensitive: true, ignoreDiacritics: true });
      expect(helpers.searchPageText(entry, q3Miss, { caseSensitive: true, ignoreDiacritics: true }).matches).toHaveLength(0);

      const q4 = helpers.normalizeSearchQuery('Đường sắt ĐÔ THỊ', { caseSensitive: true, ignoreDiacritics: false });
      expect(helpers.searchPageText(entry, q4, { caseSensitive: true, ignoreDiacritics: false }).matches).toHaveLength(1);
      const q4Miss = helpers.normalizeSearchQuery('đường sắt đô thị', { caseSensitive: true, ignoreDiacritics: false });
      expect(helpers.searchPageText(entry, q4Miss, { caseSensitive: true, ignoreDiacritics: false }).matches).toHaveLength(0);
    });

    it('collapses mixed whitespace and skips invisible soft hyphens/BOM without drifting raw offsets', () => {
      const raw = '\uFEFFHệ\t\u00AD  thống\n\u00A0đường   sắt TCVN';
      const mapped = helpers.normalizeSearchTextWithMap(raw, { caseSensitive: false, ignoreDiacritics: true });
      expect(mapped.text).toBe('he thong duong sat tcvn');
      const target = 'duong sat';
      const idx = mapped.text.indexOf(target);
      expect(idx).toBeGreaterThan(-1);
      expect(raw.slice(mapped.rawStarts[idx], mapped.rawEnds[idx + target.length - 1])).toBe('đường   sắt');
    });
  });

  describe('extractPageText, line joining, hyphenation, two-column layout & itemSpans', () => {
    it('inserts word space across horizontal gap while keeping tightly kerned glyphs adjacent', () => {
      const extracted = helpers.extractPageText({
        items: [
          makeBoxItem('TC', 50, 700, 14),
          makeBoxItem('VN', 64.2, 700, 14), // gap 0.2 <= threshold -> joined without space
          makeBoxItem('50126', 84, 700, 30) // gap 5.8 > threshold -> space inserted
        ]
      });
      expect(extracted.rawText).toBe('TCVN 50126');
      const idx = extracted.rawText.indexOf('TCVN');
      const spans = helpers.mapRawRangeToItemRanges(extracted.itemSpans, idx, idx + 4);
      expect(spans).toEqual([
        { itemIndex: 0, start: 0, end: 2 },
        { itemIndex: 1, start: 0, end: 2 }
      ]);
    });

    it('handles multi-line wrapping, bidirectional optional EOL hyphenation, Unicode hyphens, standard codes, and space-dash punctuation', () => {
      const extracted = helpers.extractPageText({
        items: [
          makeBoxItem('Hệ thống', 50, 740, 45),
          makeBoxItem('đường sắt inter-', 50, 720, 80),
          makeBoxItem('national và self-', 50, 700, 80),
          makeBoxItem('contained system', 50, 680, 80),
          makeBoxItem('tiêu\u00AD', 50, 660, 25),
          makeBoxItem('chuẩn TCVN-', 50, 640, 65),
          makeBoxItem('50126 và BS EN 50126\u20111:2017', 50, 620, 140),
          makeBoxItem('Đường sắt -', 50, 600, 60),
          makeBoxItem('TOD đô thị và mid-line', 50, 580, 120)
        ]
      });

      expect(extracted.rawText).toContain('Hệ thống\nđường sắt inter-national và self-contained system');
      expect(extracted.rawText).toContain('TCVN-50126');
      expect(extracted.rawText).toContain('Đường sắt -\nTOD đô thị');
      expect(extracted.optionalHyphenOffsets.length).toBe(3);

      const pageEntry = { pageNum: 1, ...extracted };

      // Chiều 1: "international" khớp "inter-" + "national" (bỏ qua gạch nối cuối dòng)
      const resInter = helpers.searchPageText(pageEntry, helpers.normalizeSearchQuery('international'));
      expect(resInter.matches).toHaveLength(1);
      expect(resInter.matches[0].itemRanges).toEqual([
        { itemIndex: 1, start: 10, end: 16 }, // "inter-"
        { itemIndex: 2, start: 0, end: 8 }    // "national"
      ]);
      // Chiều ngược lại cho cùng từ: "inter-national" cũng khớp
      expect(helpers.searchPageText(pageEntry, helpers.normalizeSearchQuery('inter-national')).matches).toHaveLength(1);

      // Chiều 2: "self-contained" khớp "self-" + "contained" (giữ gạch nối cuối dòng)
      const resSelfHyphen = helpers.searchPageText(pageEntry, helpers.normalizeSearchQuery('self-contained'));
      expect(resSelfHyphen.matches).toHaveLength(1);
      expect(resSelfHyphen.matches[0].itemRanges).toEqual([
        { itemIndex: 2, start: 12, end: 17 }, // "self-"
        { itemIndex: 3, start: 0, end: 9 }    // "contained"
      ]);
      // "selfcontained" cũng khớp
      expect(helpers.searchPageText(pageEntry, helpers.normalizeSearchQuery('selfcontained')).matches).toHaveLength(1);

      // Truy vấn kết hợp cả hai trong cùng 1 cụm: "international và self-contained"
      expect(helpers.searchPageText(pageEntry, helpers.normalizeSearchQuery('international va self-contained')).matches).toHaveLength(1);

      // Gạch nối giữa dòng (không phải EOL) vẫn bắt buộc có dấu '-'
      expect(helpers.searchPageText(pageEntry, helpers.normalizeSearchQuery('mid-line')).matches).toHaveLength(1);
      expect(helpers.searchPageText(pageEntry, helpers.normalizeSearchQuery('midline')).matches).toHaveLength(0);

      // Gạch nối mềm \u00AD ở cuối dòng khớp cả hai chiều và ẩn \u00AD trong snippet
      const resSoft = helpers.searchPageText(pageEntry, helpers.normalizeSearchQuery('tieuchuan'));
      expect(resSoft.matches).toHaveLength(1);
      expect(resSoft.matches[0].snippet.match).not.toContain('\u00AD');
      expect(helpers.searchPageText(pageEntry, helpers.normalizeSearchQuery('tieu-chuan')).matches).toHaveLength(1);

      // Mã chuẩn có gạch nối cuối dòng & non-breaking hyphen \u2011
      const resCode = helpers.searchPageText(pageEntry, helpers.normalizeSearchQuery('tcvn-50126'));
      expect(resCode.matches).toHaveLength(1);
      expect(resCode.matches[0].itemRanges).toEqual([
        { itemIndex: 5, start: 6, end: 11 }, // "TCVN-"
        { itemIndex: 6, start: 0, end: 5 }   // "50126"
      ]);
      expect(helpers.searchPageText(pageEntry, helpers.normalizeSearchQuery('50126-1')).matches).toHaveLength(1);

      const resCrossLine = helpers.searchPageText(pageEntry, helpers.normalizeSearchQuery('he thong duong sat'));
      expect(resCrossLine.matches).toHaveLength(1);
    });

    it('separates two-column reading order across full-width header/footer and prevents cross-column false matches', () => {
      const items: TextItemLike[] = [
        // Full-width header crossing midpoint splitX (~250)
        makeBoxItem('CHƯƠNG 1: QUY ĐỊNH CHUNG VỀ ĐƯỜNG SẮT ĐÔ THỊ', 60, 760, 400),
        // Interleaved row-by-row PDF items (left column 50..210, right column 290..460, spanX=410)
        makeBoxItem('Cột trái dòng một nói về', 50, 720, 150),
        makeBoxItem('Cột phải mở đầu nội', 290, 720, 150),
        makeBoxItem('hệ thống tín hiệu an', 50, 705, 145),
        makeBoxItem('dung kiểm định đầu máy', 290, 705, 160),
        makeBoxItem('toàn chạy tàu metro', 50, 690, 140),
        makeBoxItem('và toa xe khách', 290, 690, 140),
        // Full-width footer
        makeBoxItem('Kết thúc trang hai cột tiêu chuẩn Việt Nam', 60, 100, 380)
      ];

      const extracted = helpers.extractPageText({ items });
      expect(extracted.twoColumnDetected).toBe(true);
      const entry = { pageNum: 1, ...extracted };

      // Matches phrase wrapping within left column across rows
      expect(helpers.searchPageText(entry, helpers.normalizeSearchQuery('tín hiệu an toàn chạy tàu')).matches).toHaveLength(1);
      // Matches phrase wrapping within right column across rows
      expect(helpers.searchPageText(entry, helpers.normalizeSearchQuery('nội dung kiểm định đầu máy')).matches).toHaveLength(1);
      // Does NOT match adjacent items across left and right columns
      expect(helpers.searchPageText(entry, helpers.normalizeSearchQuery('nói về Cột phải')).matches).toHaveLength(0);
    });

    it('detects staggered-baseline two-column layout while avoiding false positives on single-column and TOC pages', () => {
      const staggeredItems: TextItemLike[] = [
        makeBoxItem('Bên trái đoạn thứ nhất', 50, 720, 145),
        makeBoxItem('Bên phải lệch dòng một', 290, 712, 145),
        makeBoxItem('tiếp nối phần bên trái', 50, 700, 140),
        makeBoxItem('tiếp nối phần bên phải', 290, 691, 145),
        makeBoxItem('kết thúc cột bên trái', 50, 680, 135),
        makeBoxItem('kết thúc cột bên phải', 290, 671, 140)
      ];
      const staggered = helpers.extractPageText({ items: staggeredItems });
      expect(staggered.twoColumnDetected).toBe(true);
      expect(helpers.searchPageText({ pageNum: 1, ...staggered }, helpers.normalizeSearchQuery('đoạn thứ nhất tiếp nối phần bên trái')).matches).toHaveLength(1);
      expect(helpers.searchPageText({ pageNum: 1, ...staggered }, helpers.normalizeSearchQuery('thứ nhất Bên phải')).matches).toHaveLength(0);

      // Single-column TOC page: wide titles on left, narrow page numbers on right (< 0.18 * spanX)
      const tocItems: TextItemLike[] = [
        makeBoxItem('1. Phạm vi áp dụng tiêu chuẩn', 50, 720, 260),
        makeBoxItem('4', 440, 720, 8),
        makeBoxItem('2. Tài liệu viện dẫn kỹ thuật', 50, 700, 250),
        makeBoxItem('12', 436, 700, 12),
        makeBoxItem('3. Thuật ngữ và định nghĩa', 50, 680, 240),
        makeBoxItem('18', 436, 680, 12)
      ];
      const tocPage = helpers.extractPageText({ items: tocItems });
      expect(tocPage.twoColumnDetected).toBe(false);
    });

    it('falls back to stream order with hasEOL and preserves exact pdf.js TextLayer itemIndex alignment', () => {
      const extracted = helpers.extractPageText({
        items: [
          { type: 'beginMarkedContent' },        // skipped -> no itemIndex increment
          { str: 'Mục', hasEOL: false },         // itemIndex 0
          { str: '' },                           // itemIndex 1 (TextLayer still creates a div/entry!)
          { str: ' tiêu chuẩn', hasEOL: true },  // itemIndex 2
          { type: 'endMarkedContent' },          // skipped -> no itemIndex increment
          { str: '', hasEOL: true },             // itemIndex 3
          { str: 'Đường sắt', hasEOL: false }    // itemIndex 4
        ]
      });

      expect(extracted.twoColumnDetected).toBe(false);
      expect(extracted.rawText).toBe('Mục tiêu chuẩn\nĐường sắt');

      const entry = { pageNum: 1, ...extracted };
      const railwayMatch = helpers.searchPageText(entry, helpers.normalizeSearchQuery('đường sắt'));
      expect(railwayMatch.matches).toHaveLength(1);
      expect(railwayMatch.matches[0].itemRanges).toEqual([
        { itemIndex: 4, start: 0, end: 9 }
      ]);
    });
  });

  describe('buildMatchSnippet & XSS safety', () => {
    it('bounds snippet length to 120 chars and truncates overlong matches cleanly', () => {
      const prefixLong = 'Đây là một đoạn văn bản khá dài nằm phía trước từ khóa cần tìm kiếm trong tài liệu kỹ thuật tiêu chuẩn quốc gia. ';
      const suffixLong = ' Và đây là đoạn văn bản rất dài phía sau để kiểm tra cắt đoạn trích không vượt quá giới hạn tối đa cho phép.';
      const raw = `${prefixLong}TCVN 50126${suffixLong}`;
      const start = prefixLong.length;
      const snippet = helpers.buildMatchSnippet(raw, start, start + 'TCVN 50126'.length, 120);

      expect(snippet.text.length).toBeLessThanOrEqual(120);
      expect(snippet.match).toBe('TCVN 50126');
      expect(snippet.prefix.startsWith('…')).toBe(true);
      expect(snippet.suffix.endsWith('…')).toBe(true);

      const hugeMatch = 'A'.repeat(160);
      const hugeSnippet = helpers.buildMatchSnippet(hugeMatch, 0, hugeMatch.length, 120);
      expect(hugeSnippet.text.length).toBeLessThanOrEqual(120);
      expect(hugeSnippet.match.endsWith('…')).toBe(true);
    });

    it('keeps HTML-like PDF text untouched as literal strings without escaping or execution markers', () => {
      const payload = 'Dữ liệu thử <img src=x onerror=alert(1)> và <script>alert(1)</script> kết thúc';
      const extracted = helpers.extractPageText({
        items: [makeBoxItem(payload, 50, 700, 300)]
      });
      const entry = { pageNum: 1, ...extracted };
      const q = helpers.normalizeSearchQuery('<img src=x onerror=alert(1)>');
      const res = helpers.searchPageText(entry, q);

      expect(res.matches).toHaveLength(1);
      expect(res.matches[0].snippet.match).toBe('<img src=x onerror=alert(1)>');
      expect(res.matches[0].snippet.suffix).toContain('<script>alert(1)</script>');
    });
  });

  describe('createPdfSearchEngine lifecycle, caching, limits, no_text_layer, and cancellation', () => {
    it('indexes in small background batches, yields between batches, streams progressive results, and reuses cache', async () => {
      const pdf = makeMockPdf([
        [makeBoxItem('Trang một về tiêu chuẩn đường sắt', 50, 700, 200)],
        [makeBoxItem('Trang hai không có từ khóa', 50, 700, 200)],
        [makeBoxItem('Trang ba nhắc lại đường sắt đô thị', 50, 700, 220)],
        [makeBoxItem('Trang bốn phụ lục kỹ thuật', 50, 700, 180)],
        [makeBoxItem('Trang năm vận hành đường sắt', 50, 700, 190)],
        [makeBoxItem('Trang sáu hết tài liệu', 50, 700, 160)]
      ]);

      const snapshots: SearchSnapshot[] = [];
      let yieldCalls = 0;
      const engine = helpers.createPdfSearchEngine({
        pdf,
        batchSize: 2,
        yieldToMain: async () => {
          yieldCalls += 1;
          await Promise.resolve();
        },
        onUpdate: snap => snapshots.push(snap)
      });

      engine.setQuery('đường sắt');
      await engine.startIndexing();

      expect(yieldCalls).toBe(2); // 6 pages / batchSize 2 -> yields after batch 1 and batch 2
      const progressSnapshots = snapshots.filter(s => s.indexedPages > 0);
      expect(progressSnapshots.map(s => [s.indexedPages, s.totalMatches, s.status])).toEqual([
        [2, 1, 'indexing'],
        [4, 2, 'indexing'],
        [6, 3, 'ready']
      ]);
      expect(pdf.getPage).toHaveBeenCalledTimes(6);

      // Re-querying reuses cached extracted pages without calling pdf.getPage again
      const next = engine.setQuery('tiêu chuẩn');
      expect(next.totalMatches).toBe(1);
      expect(next.matches[0].pageNum).toBe(1);
      expect(pdf.getPage).toHaveBeenCalledTimes(6);
      expect(engine.estimateMemoryBytes()).toBeGreaterThan(0);

      // Clearing query clears matches while keeping indexed cache ready
      const cleared = engine.clearQuery();
      expect(cleared.status).toBe('ready');
      expect(cleared.totalMatches).toBe(0);
      expect(engine.getPageCache(1)).toBeTruthy();
    });

    it('enforces minimum query length of 2 chars (including combining marks) and caps results at 2000', async () => {
      const repeated = Array.from({ length: 1250 }, () => 'tcvn').join(' ');
      const pdf = makeMockPdf([
        [makeBoxItem(repeated, 50, 700, 400)],
        [makeBoxItem(repeated, 50, 700, 400)]
      ]);
      const engine = helpers.createPdfSearchEngine({
        pdf,
        batchSize: 2,
        yieldToMain: async () => Promise.resolve()
      });

      await engine.startIndexing();

      expect(engine.setQuery('').matches).toHaveLength(0);
      expect(engine.setQuery('').queryTooShort).toBe(false);
      expect(engine.setQuery('   ').matches).toHaveLength(0);

      const shortSingle = engine.setQuery(' e\u0302 ');
      expect(shortSingle.queryTooShort).toBe(true);
      expect(shortSingle.matches).toHaveLength(0);

      const capped = engine.setQuery('tcvn');
      expect(capped.matches).toHaveLength(2000);
      expect(capped.truncated).toBe(true);
    });

    it('warns on partial empty pages (e.g. 10 leading image pages) without blocking search, and blocks only when all pages have no text', async () => {
      // PDF có 10 trang đầu là ảnh nhưng trang 11..14 có chữ -> KHÔNG chặn, chỉ bật cảnh báo partialNoTextLayer
      const mixedPages: TextItemLike[][] = [
        ...Array.from({ length: 10 }, () => [{ str: '   ' }]),
        [makeBoxItem('Chương 1: Hệ thống tín hiệu đường sắt', 50, 700, 220)],
        [makeBoxItem('Chương 2: Quy định an toàn', 50, 700, 180)],
        [],
        [makeBoxItem('Phụ lục đường sắt đô thị', 50, 700, 190)]
      ];
      const mixedPdf = makeMockPdf(mixedPages);
      const mixedSnapshots: SearchSnapshot[] = [];
      const mixedEngine = helpers.createPdfSearchEngine({
        pdf: mixedPdf,
        batchSize: 4,
        yieldToMain: async () => Promise.resolve(),
        onUpdate: snap => mixedSnapshots.push(snap)
      });

      mixedEngine.setQuery('đường sắt');
      const mixedFinal = await mixedEngine.startIndexing();
      expect(mixedFinal.status).toBe('ready');
      expect(mixedFinal.hasTextLayer).toBe(true);
      expect(mixedFinal.pagesWithText).toBe(3);
      expect(mixedFinal.emptyTextPages).toBe(11);
      expect(mixedFinal.partialNoTextLayer).toBe(true);
      expect(mixedFinal.matches.map(m => m.pageNum)).toEqual([11, 14]);
      // Trong lúc đang quét lô đầu chưa có chữ -> chỉ đánh dấu provisionalNoText, không dừng sớm
      expect(mixedSnapshots.some(s => s.status === 'indexing' && s.provisionalNoText)).toBe(true);

      // PDF toàn bộ trang đều là ảnh (không có chữ ở bất kỳ trang nào) -> no_text_layer và chặn tìm kiếm
      const requestedPages: number[] = [];
      const twelveEmptyPages = Array.from({ length: 12 }, () => [{ str: '   ' }]);
      const emptyPdf = makeMockPdf(twelveEmptyPages, {
        onGetPage: p => requestedPages.push(p)
      });

      const emptyEngine = helpers.createPdfSearchEngine({
        pdf: emptyPdf,
        batchSize: 4,
        yieldToMain: async () => Promise.resolve()
      });

      const finalSnap = await emptyEngine.startIndexing();
      expect(finalSnap.status).toBe('no_text_layer');
      expect(finalSnap.hasTextLayer).toBe(false);
      expect(finalSnap.partialNoTextLayer).toBe(false);
      expect(requestedPages).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

      const afterQuery = emptyEngine.setQuery('đường sắt');
      expect(afterQuery.status).toBe('no_text_layer');
      expect(afterQuery.matches).toEqual([]);
      expect(emptyPdf.getPage).toHaveBeenCalledTimes(12);

      // Preview ngắn 3 trang rỗng -> không bao giờ gọi getPage(4)
      const shortRequested: number[] = [];
      const shortEmptyPdf = makeMockPdf([[], [], []], {
        onGetPage: p => shortRequested.push(p)
      });
      const shortEngine = helpers.createPdfSearchEngine({
        pdf: shortEmptyPdf,
        batchSize: 4,
        yieldToMain: async () => Promise.resolve()
      });
      const shortSnap = await shortEngine.startIndexing();
      expect(shortSnap.status).toBe('no_text_layer');
      expect(shortRequested).toEqual([1, 2, 3]);
    });

    it('cancels background indexing mid-flight cleanly without invoking further getPage or onUpdate', async () => {
      let resolveDelayedPage!: (val: { items: TextItemLike[] }) => void;
      const delayedPromise = new Promise<{ items: TextItemLike[] }>((resolve) => {
        resolveDelayedPage = resolve;
      });
      const requested: number[] = [];
      const pdf = makeMockPdf(
        [
          [makeBoxItem('Trang 1 hợp lệ', 50, 700, 120)],
          () => delayedPromise,
          [makeBoxItem('Trang 3 không được phép đọc', 50, 700, 180)],
          [makeBoxItem('Trang 4 không được phép đọc', 50, 700, 180)]
        ],
        { onGetPage: p => requested.push(p) }
      );

      const updates: SearchSnapshot[] = [];
      const engine = helpers.createPdfSearchEngine({
        pdf,
        batchSize: 1,
        yieldToMain: async () => Promise.resolve(),
        onUpdate: snap => updates.push(snap)
      });

      const runPromise = engine.startIndexing();
      await vi.waitFor(() => {
        expect(requested).toEqual([1, 2]);
      });

      const countBeforeCancel = updates.length;
      engine.cancel();
      expect(engine.getSnapshot().status).toBe('cancelled');

      resolveDelayedPage({ items: [makeBoxItem('Trang 2 về muộn', 50, 700, 120)] });
      await runPromise;

      expect(requested).toEqual([1, 2]);
      expect(updates).toHaveLength(countBeforeCancel);
      expect(engine.setQuery('Trang 1').matches).toEqual([]);
    });
  });
});
