import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import '../public/playground.js';

interface FakeNode {
  nodeType: number;
  tagName?: string;
  className?: string;
  type?: string;
  hidden?: boolean;
  disabled?: boolean;
  value?: string;
  title?: string;
  textContent: string;
  attributes?: Record<string, string>;
  style?: Record<string, string>;
  parent?: FakeNode | null;
  classList?: {
    set: Set<string>;
    toggle: (cls: string, force?: boolean) => boolean;
    add: (...cls: string[]) => void;
    remove: (...cls: string[]) => void;
    contains: (cls: string) => boolean;
  };
  children?: FakeNode[];
  listeners?: Record<string, Array<(ev?: unknown) => void>>;
  setAttribute?: (k: string, v: string) => void;
  getAttribute?: (k: string) => string | null;
  append?: (...items: Array<FakeNode | string>) => void;
  replaceChildren?: (...items: Array<FakeNode | string>) => void;
  addEventListener?: (ev: string, fn: (e?: unknown) => void) => void;
  contains?: (other: unknown) => boolean;
  focus?: (opts?: unknown) => void;
  select?: () => void;
  click?: () => void;
}

interface SearchSession {
  attachPdf: (args: {
    doc: Record<string, unknown>;
    mode: string;
    pdf: { numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: Array<{ str: string; transform?: number[]; width?: number; height?: number }> }> }> };
    totalPages?: number;
  }) => unknown;
  close: () => void;
  openSearch: (focusInput?: boolean) => boolean;
  closeSearch: (returnFocus?: boolean) => void;
  runQuery: (immediate?: boolean) => void;
  goToMatch: (idx: number) => void;
  toggleCase: () => void;
  toggleDiacritics: () => void;
  showMore: () => void;
  refreshUi: () => void;
  handleDocumentKeydown: (event: Record<string, unknown>, activeElement: unknown, isImageMode?: boolean) => string;
  handleInputKeydown: (event: Record<string, unknown>) => string;
  getPageMatches: (pageNum: number) => unknown[];
  hasPane: () => boolean;
  isOpen: () => boolean;
  getActiveIndex: () => number;
  getSnapshot: () => {
    status: string;
    indexedPages: number;
    totalPages: number;
    matches: Array<{ pageNum: number; id: string }>;
    totalMatches: number;
  } | null;
}

interface SearchUiHelpers {
  VIEWER_TEXT_SELECTABLE: boolean;
  resolveViewerTextLayerBehavior: (selectable?: boolean) => {
    selectable: boolean;
    className: string;
    userSelect: string;
    pointerEvents: string;
  };
  applyTextLayerSelectability: (container: FakeNode, selectable?: boolean) => {
    selectable: boolean;
    className: string;
    userSelect: string;
    pointerEvents: string;
  };
  isViewerPreviewOnly: (doc: unknown, mode: string) => boolean;
  shouldInterceptViewerFindShortcut: (
    event: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; key?: string },
    viewerEl: { hidden?: boolean; contains?: (el: unknown) => boolean } | null,
    activeElement: unknown,
    isImageMode?: boolean
  ) => boolean;
  formatSearchCounter: (activeIndex: number, totalMatches: number, truncated?: boolean) => string;
  computeTextLayerScale: (cssWidth: number, rawPageWidth: number, fallbackScale?: number) => number;
  createSearchResultsDom: (docFactory: unknown, matches: unknown[], opts?: Record<string, unknown>) => FakeNode[];
  applyHighlightsToTextDivs: (
    docFactory: unknown,
    textDivs: FakeNode[],
    originalStrings: string[],
    pageMatches: unknown[],
    activeGlobalIndex: number,
    dirtySet?: Set<number>
  ) => { activeMark: FakeNode | null; dirty: Set<number> };
  createPdfSearchEngine: (config: Record<string, unknown>) => {
    startIndexing: () => Promise<{ status: string; indexedPages: number; totalPages: number }>;
    setQuery: (q: string) => { matches: unknown[]; totalMatches: number };
    estimateMemoryBytes: () => number;
  };
  createPdfViewerSearchSession: (deps: Record<string, unknown>) => SearchSession;
}

const helpers = (globalThis as unknown as { __smartrailFileHelpers: SearchUiHelpers }).__smartrailFileHelpers;

function createStrictFakeDom() {
  const createdTags: string[] = [];
  const docFactory: {
    activeElement: FakeNode | null;
    createElement: (tag: string) => FakeNode;
    createTextNode: (text: string) => FakeNode;
  } = {
    activeElement: null,
    createElement: (tag: string) => makeEl(tag),
    createTextNode: (text: string): FakeNode => ({ nodeType: 3, textContent: String(text), parent: null })
  };

  const makeEl = (tagName: string): FakeNode => {
    createdTags.push(tagName.toLowerCase());
    const classes = new Set<string>();
    const el: FakeNode = {
      nodeType: 1,
      tagName: tagName.toLowerCase(),
      className: '',
      type: '',
      hidden: false,
      disabled: false,
      value: '',
      title: '',
      textContent: '',
      attributes: {},
      style: {},
      parent: null,
      classList: {
        set: classes,
        toggle(cls: string, force?: boolean) {
          const next = force === undefined ? !classes.has(cls) : Boolean(force);
          if (next) classes.add(cls);
          else classes.delete(cls);
          return next;
        },
        add(...cls: string[]) {
          for (const c of cls) classes.add(c);
        },
        remove(...cls: string[]) {
          for (const c of cls) classes.delete(c);
        },
        contains(cls: string) {
          return classes.has(cls);
        }
      },
      children: [],
      listeners: {},
      setAttribute(name: string, value: string) {
        this.attributes![name] = String(value);
      },
      getAttribute(name: string) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes![name] : null;
      },
      append(...items: Array<FakeNode | string>) {
        for (const item of items) {
          if (typeof item === 'string') {
            this.children!.push({ nodeType: 3, textContent: item, parent: this });
          } else if (item) {
            item.parent = this;
            this.children!.push(item);
          }
        }
      },
      replaceChildren(...items: Array<FakeNode | string>) {
        this.children!.length = 0;
        this.textContent = '';
        this.append!(...items);
      },
      addEventListener(event: string, fn: (e?: unknown) => void) {
        if (!this.listeners![event]) this.listeners![event] = [];
        this.listeners![event].push(fn);
      },
      contains(other: unknown) {
        let cur = other as FakeNode | null | undefined;
        while (cur) {
          if (cur === this) return true;
          cur = cur.parent;
        }
        return false;
      },
      focus() {
        docFactory.activeElement = this;
      },
      select() {},
      click() {
        for (const fn of this.listeners!.click || []) fn({});
      }
    };
    Object.defineProperty(el, 'innerHTML', {
      set() {
        throw new Error('innerHTML is forbidden in PDF search UI');
      },
      get() {
        return '';
      }
    });
    return el;
  };
  return { createdTags, docFactory, makeEl };
}

function collectText(node: FakeNode): string {
  if (node.nodeType === 3) return node.textContent;
  if (node.children && node.children.length > 0) {
    return node.children.map(collectText).join('');
  }
  return node.textContent;
}

describe('PDF in-document search UI & TextLayer controls (S2)', () => {
  it('switches text layer user-select and pointer-events via the single VIEWER_TEXT_SELECTABLE config flag', () => {
    expect(helpers.VIEWER_TEXT_SELECTABLE).toBe(true);

    const enabled = helpers.resolveViewerTextLayerBehavior(true);
    expect(enabled).toEqual({
      selectable: true,
      className: 'is-selectable',
      userSelect: 'text',
      pointerEvents: 'auto'
    });

    const disabled = helpers.resolveViewerTextLayerBehavior(false);
    expect(disabled).toEqual({
      selectable: false,
      className: 'is-non-selectable',
      userSelect: 'none',
      pointerEvents: 'none'
    });

    const { makeEl } = createStrictFakeDom();
    const layer = makeEl('div');

    helpers.applyTextLayerSelectability(layer, true);
    expect(layer.style?.userSelect).toBe('text');
    expect(layer.style?.pointerEvents).toBe('auto');
    expect(layer.classList?.contains('is-selectable')).toBe(true);
    expect(layer.classList?.contains('is-non-selectable')).toBe(false);
    expect(layer.getAttribute?.('data-selectable')).toBe('true');

    helpers.applyTextLayerSelectability(layer, false);
    expect(layer.style?.userSelect).toBe('none');
    expect(layer.style?.pointerEvents).toBe('none');
    expect(layer.classList?.contains('is-selectable')).toBe(false);
    expect(layer.classList?.contains('is-non-selectable')).toBe(true);
    expect(layer.getAttribute?.('data-selectable')).toBe('false');

    // Xác nhận cờ chỉ được khai báo tập trung tại 1 vị trí, không rải điều kiện ở nhiều nơi
    const playgroundJs = readFileSync('public/playground.js', 'utf8');
    expect(playgroundJs).toContain('const VIEWER_TEXT_SELECTABLE = true;');
    const occurrences = playgroundJs.match(/\bVIEWER_TEXT_SELECTABLE\b/g) || [];
    // 1 khai báo const + 2 tham số mặc định trong resolveViewerTextLayerBehavior / applyTextLayerSelectability + 1 export trong fileHelpers
    expect(occurrences.length).toBeLessThanOrEqual(4);
  });

  it('intercepts Ctrl+F / Cmd+F ONLY when focus is inside the open PDF viewer', () => {
    const insideChild = { id: 'child' };
    const outsideEl = { id: 'outside' };
    const viewerEl = {
      hidden: false,
      contains: (el: unknown) => el === viewerEl || el === insideChild
    };

    expect(helpers.shouldInterceptViewerFindShortcut({ ctrlKey: true, key: 'f' }, viewerEl, insideChild, false)).toBe(true);
    expect(helpers.shouldInterceptViewerFindShortcut({ metaKey: true, key: 'F' }, viewerEl, viewerEl, false)).toBe(true);
    // Ngoài viewer -> giữ hành vi trình duyệt
    expect(helpers.shouldInterceptViewerFindShortcut({ ctrlKey: true, key: 'f' }, viewerEl, outsideEl, false)).toBe(false);
    expect(helpers.shouldInterceptViewerFindShortcut({ ctrlKey: true, key: 'f' }, viewerEl, null, false)).toBe(false);
    // Viewer đóng hoặc đang xem ảnh -> không chặn
    expect(helpers.shouldInterceptViewerFindShortcut({ ctrlKey: true, key: 'f' }, { ...viewerEl, hidden: true }, insideChild, false)).toBe(false);
    expect(helpers.shouldInterceptViewerFindShortcut({ ctrlKey: true, key: 'f' }, viewerEl, insideChild, true)).toBe(false);
    // Phím khác hoặc có Alt -> không chặn
    expect(helpers.shouldInterceptViewerFindShortcut({ ctrlKey: true, altKey: true, key: 'f' }, viewerEl, insideChild, false)).toBe(false);
    expect(helpers.shouldInterceptViewerFindShortcut({ ctrlKey: true, key: 'g' }, viewerEl, insideChild, false)).toBe(false);
  });

  it('detects preview-only state, formats counters, and computes responsive TextLayer scales', () => {
    expect(helpers.isViewerPreviewOnly({ can_view_full: true }, 'preview')).toBe(true);
    expect(helpers.isViewerPreviewOnly({ can_view_full: false }, 'full')).toBe(true);
    expect(helpers.isViewerPreviewOnly({ preview_only: true }, 'full')).toBe(true);
    expect(helpers.isViewerPreviewOnly({ can_view_full: true }, 'full')).toBe(false);

    expect(helpers.formatSearchCounter(-1, 0, false)).toBe('0/0');
    expect(helpers.formatSearchCounter(0, 12, false)).toBe('1/12');
    expect(helpers.formatSearchCounter(4, 2000, true)).toBe('5/2000+');

    // Scale căn khít canvas ở mọi chiều rộng (desktop 892.5px -> 1.5, mobile 357px -> 0.6)
    expect(helpers.computeTextLayerScale(892.5, 595, 1.5)).toBeCloseTo(1.5, 5);
    expect(helpers.computeTextLayerScale(357, 595, 1.5)).toBeCloseTo(0.6, 5);
    expect(helpers.computeTextLayerScale(0, 595, 1.5)).toBe(1.5);
  });

  it('renders search results list safely with DOM API (no HTML injection on XSS payloads)', () => {
    const { docFactory, createdTags } = createStrictFakeDom();
    const onSelect = vi.fn();
    const matches = [
      {
        id: '2-0',
        pageNum: 2,
        snippet: {
          prefix: 'Trước ',
          match: '<img src=x onerror=alert(1)>',
          suffix: ' <script>alert(2)</script>'
        }
      },
      {
        id: '5-0',
        pageNum: 5,
        snippet: { prefix: 'Đoạn ', match: 'đường sắt', suffix: ' đô thị' }
      }
    ];

    const listItems = helpers.createSearchResultsDom(docFactory, matches, {
      activeIndex: 0,
      pageLabel: (p: number) => `Trang ${p}`,
      onSelect
    });

    expect(listItems).toHaveLength(2);
    expect(createdTags).not.toContain('img');
    expect(createdTags).not.toContain('script');
    expect(createdTags).toContain('mark');

    const firstBtn = listItems[0].children![0];
    expect(firstBtn.className).toContain('is-active');
    expect(collectText(firstBtn)).toContain('Trang 2');
    expect(collectText(firstBtn)).toContain('<img src=x onerror=alert(1)>');
    expect(collectText(firstBtn)).toContain('<script>alert(2)</script>');

    listItems[1].children![0].click?.();
    expect(onSelect).toHaveBeenCalledWith(1, matches[1]);
  });

  it('highlights matches in TextLayer spans with distinct current mark and cleanly restores previous highlights', () => {
    const { docFactory, makeEl, createdTags } = createStrictFakeDom();
    const originalStrings = ['Tiêu chuẩn <img onerror=1> đường sắt', 'Việt Nam'];
    const textDivs = originalStrings.map((s) => {
      const sp = makeEl('span');
      sp.textContent = s;
      return sp;
    });

    const dirty = new Set<number>();
    const res1 = helpers.applyHighlightsToTextDivs(
      docFactory,
      textDivs,
      originalStrings,
      [
        {
          globalIndex: 0,
          match: {
            itemRanges: [{ itemIndex: 0, start: 11, end: 26 }] // "<img onerror=1>"
          }
        },
        {
          globalIndex: 1,
          match: {
            itemRanges: [{ itemIndex: 1, start: 0, end: 8 }] // "Việt Nam"
          }
        }
      ],
      0,
      dirty
    );

    expect(createdTags).not.toContain('img');
    expect(res1.activeMark).not.toBeNull();
    expect(res1.activeMark?.className).toBe('viewer-search-mark is-current');
    expect(res1.activeMark?.textContent).toBe('<img onerror=1>');
    expect(collectText(textDivs[0])).toBe(originalStrings[0]);
    expect(textDivs[1].children?.[0].className).toBe('viewer-search-mark');
    expect(textDivs[1].children?.[0].textContent).toBe('Việt Nam');

    // Xóa kết quả -> khôi phục nguyên văn textContent trên các span bẩn
    const res2 = helpers.applyHighlightsToTextDivs(docFactory, textDivs, originalStrings, [], -1, dirty);
    expect(res2.activeMark).toBeNull();
    expect(textDivs[0].textContent).toBe(originalStrings[0]);
    expect(textDivs[1].textContent).toBe(originalStrings[1]);
    expect(dirty.size).toBe(0);
  });

  it('wires all required S2 markup, responsive CSS, cache-buster ?v=17, and VI/EN i18n keys', () => {
    const indexHtml = readFileSync('public/index.html', 'utf8');
    const playgroundCss = readFileSync('public/playground.css', 'utf8');
    const playgroundJs = readFileSync('public/playground.js', 'utf8');

    for (const id of [
      'doc-viewer-search-toggle',
      'doc-viewer-search-bar',
      'doc-viewer-search-input',
      'doc-viewer-search-counter',
      'doc-viewer-search-prev',
      'doc-viewer-search-next',
      'doc-viewer-search-case',
      'doc-viewer-search-diacritics',
      'doc-viewer-search-close',
      'doc-viewer-search-meta',
      'doc-viewer-sidebar-tabs',
      'doc-viewer-tab-toc',
      'doc-viewer-tab-results',
      'doc-viewer-results-pane',
      'doc-viewer-results-status',
      'doc-viewer-results-list'
    ]) {
      expect(indexHtml, id).toContain(`id="${id}"`);
    }
    expect(indexHtml).toContain('playground.css?v=17');
    expect(indexHtml).toContain('playground.js?v=17');

    expect(playgroundCss).toContain('.viewer-text-layer');
    expect(playgroundCss).toContain('.viewer-text-layer.is-selectable');
    expect(playgroundCss).toContain('.viewer-text-layer.is-non-selectable');
    expect(playgroundCss).toContain('.viewer-search-mark.is-current');
    expect(playgroundCss).toContain('.doc-viewer-search-bar');

    for (const phrase of [
      "pdfSearchIndexing: 'Đang lập chỉ mục {x}/{total} trang'",
      "pdfSearchIndexing: 'Indexing {x}/{total} pages'",
      "pdfSearchPreviewOnly: 'Chỉ tìm trong phần xem trước ({n} trang)'",
      "pdfSearchPreviewOnly: 'Searching preview only ({n} pages)'",
      "pdfSearchPartialNoText: 'Một số trang không có lớp chữ'",
      "pdfSearchPartialNoText: 'Some pages have no text layer'",
      "pdfSearchNoTextLayer: 'Tài liệu này không có lớp chữ để tìm kiếm.'",
      "pdfSearchNoTextLayer: 'This PDF has no searchable text layer.'"
    ]) {
      expect(playgroundJs, phrase).toContain(phrase);
    }
    // Xác nhận mở viewer có focus vào #doc-viewer (tabindex="-1") để Ctrl/Cmd+F ăn ngay
    expect(indexHtml).toContain('id="doc-viewer" hidden tabindex="-1"');
    expect(playgroundJs).toContain('overlay.focus?.({ preventScroll: true });');
  });
});

function createSearchUiHarness(overrides: Record<string, unknown> = {}) {
  const { docFactory, makeEl } = createStrictFakeDom();
  const overlay = makeEl('div');
  const searchBar = makeEl('div');
  searchBar.hidden = true;
  const searchToggle = makeEl('button');
  searchToggle.hidden = true;
  const searchInput = makeEl('input');
  const counterEl = makeEl('span');
  const prevBtn = makeEl('button');
  const nextBtn = makeEl('button');
  const caseBtn = makeEl('button');
  const diaBtn = makeEl('button');
  const closeBtn = makeEl('button');
  const metaEl = makeEl('div');
  metaEl.hidden = true;
  const tabCountEl = makeEl('span');
  tabCountEl.hidden = true;
  const resultsStatusEl = makeEl('p');
  resultsStatusEl.hidden = true;
  const resultsListEl = makeEl('ul');
  const moreWrapEl = makeEl('div');
  moreWrapEl.hidden = true;
  const outsideEl = makeEl('input');

  overlay.append(searchToggle, searchBar, resultsListEl);
  searchBar.append(searchInput, counterEl, prevBtn, nextBtn, caseBtn, diaBtn, closeBtn, metaEl);

  const dict: Record<string, string> = {
    pdfSearchMatchCase: 'Phân biệt hoa/thường',
    pdfSearchIgnoreDiacritics: 'Bỏ dấu tiếng Việt',
    pdfSearchPrev: 'Kết quả trước',
    pdfSearchNext: 'Kết quả tiếp',
    pdfSearchClose: 'Đóng tìm kiếm',
    pdfSearchIndexing: 'Đang lập chỉ mục {x}/{total} trang',
    pdfSearchPreviewOnly: 'Chỉ tìm trong phần xem trước ({n} trang)',
    pdfSearchPartialNoText: 'Một số trang không có lớp chữ',
    pdfSearchNoTextLayer: 'Tài liệu này không có lớp chữ để tìm kiếm.',
    pdfSearchTooShort: 'Nhập ít nhất 2 ký tự để tìm.',
    pdfSearchNoResults: 'Không tìm thấy kết quả phù hợp.',
    pdfSearchTruncated: 'Hiển thị tối đa {max} kết quả đầu tiên.',
    pdfSearchPageLabel: 'Trang {n}'
  };
  const translate = (key: string, vars: Record<string, unknown> = {}) => {
    let text = dict[key] || key;
    for (const [k, v] of Object.entries(vars)) text = text.replace(`{${k}}`, String(v));
    return text;
  };

  const jumpedPages: number[] = [];
  const onCloseViewer = vi.fn();
  const onPreviewBlocked = vi.fn();
  const onHighlightActivePage = vi.fn();
  const session = helpers.createPdfViewerSearchSession({
    docFactory,
    elements: {
      overlay, searchBar, searchToggle, searchInput, counterEl, prevBtn, nextBtn,
      caseBtn, diaBtn, closeBtn, metaEl, tabCountEl, resultsStatusEl, resultsListEl, moreWrapEl
    },
    translate,
    batchSize: 1,
    yieldToMain: async () => Promise.resolve(),
    onJumpToPage: (p: number) => jumpedPages.push(p),
    onEnsurePageRendered: async () => Promise.resolve(),
    onHighlightActivePage,
    onPreviewBlocked,
    onCloseViewer,
    ...overrides
  });

  return {
    docFactory,
    overlay,
    searchBar,
    searchToggle,
    searchInput,
    counterEl,
    metaEl,
    resultsStatusEl,
    resultsListEl,
    outsideEl,
    jumpedPages,
    onCloseViewer,
    onPreviewBlocked,
    session
  };
}

function makeSimplePdf(pageTexts: Array<string | (() => Promise<string>)>) {
  const requestedPages: number[] = [];
  return {
    requestedPages,
    pdf: {
      numPages: pageTexts.length,
      getPage: vi.fn(async (pageNum: number) => {
        requestedPages.push(pageNum);
        if (pageNum < 1 || pageNum > pageTexts.length) {
          throw new Error(`Out-of-bounds getPage(${pageNum})`);
        }
        const raw = pageTexts[pageNum - 1];
        return {
          getTextContent: vi.fn(async () => {
            const text = typeof raw === 'function' ? await raw() : raw;
            return {
              items: text ? [{ str: text, transform: [10, 0, 0, 10, 50, 700], width: text.length * 5, height: 10 }] : []
            };
          })
        };
      })
    }
  };
}

describe('PDF search DOM flows, UI cancellation, preview boundary & performance (S3)', () => {
  it('auto-focuses #doc-viewer on open so Ctrl/Cmd+F works immediately, and ignores Ctrl+F when focus is outside viewer', async () => {
    const h = createSearchUiHarness();
    const { pdf } = makeSimplePdf(['Trang một đường sắt', 'Trang hai đường sắt']);
    h.docFactory.activeElement = h.outsideEl;

    h.session.attachPdf({ doc: { id: 'd1', can_view_full: true }, mode: 'full', pdf, totalPages: 2 });
    // Tự động focus vào #doc-viewer ngay khi mở
    expect(h.docFactory.activeElement).toBe(h.overlay);

    // Ctrl+F ngay lập tức -> chặn mặc định trình duyệt, mở thanh tìm, focus ô nhập
    const prevent1 = vi.fn();
    expect(h.session.handleDocumentKeydown({ ctrlKey: true, key: 'f', preventDefault: prevent1 }, h.docFactory.activeElement, false)).toBe('opened_search');
    expect(prevent1).toHaveBeenCalledTimes(1);
    expect(h.searchBar.hidden).toBe(false);
    expect(h.docFactory.activeElement).toBe(h.searchInput);

    // Đóng thanh tìm -> trả focus về #doc-viewer; sau đó chuyển focus ra ngoài viewer
    h.session.closeSearch(true);
    expect(h.searchBar.hidden).toBe(true);
    expect(h.docFactory.activeElement).toBe(h.overlay);

    h.docFactory.activeElement = h.outsideEl;
    const preventOutside = vi.fn();
    expect(h.session.handleDocumentKeydown({ ctrlKey: true, key: 'f', preventDefault: preventOutside }, h.docFactory.activeElement, false)).toBe('ignored');
    expect(preventOutside).not.toHaveBeenCalled();
    expect(h.searchBar.hidden).toBe(true);
  });

  it('navigates matches with Enter / Shift+Enter and closes search bar before closing viewer on Escape', async () => {
    const h = createSearchUiHarness();
    const { pdf } = makeSimplePdf([
      'Hệ thống đường sắt đô thị',
      'Tiêu chuẩn đường sắt cao tốc',
      'An toàn đường sắt quốc gia'
    ]);
    h.session.attachPdf({ doc: { id: 'd1', can_view_full: true }, mode: 'full', pdf, totalPages: 3 });
    h.session.openSearch(true);
    await vi.waitFor(() => {
      expect(h.session.getSnapshot()?.status).toBe('ready');
    });

    h.searchInput.value = 'đường sắt';
    const preventEnter = vi.fn();
    expect(h.session.handleInputKeydown({ key: 'Enter', preventDefault: preventEnter })).toBe('flushed');
    expect(h.counterEl.textContent).toBe('1/3');
    expect(h.jumpedPages[h.jumpedPages.length - 1]).toBe(1);

    expect(h.session.handleInputKeydown({ key: 'Enter', preventDefault: preventEnter })).toBe('next');
    expect(h.counterEl.textContent).toBe('2/3');
    expect(h.jumpedPages[h.jumpedPages.length - 1]).toBe(2);

    expect(h.session.handleInputKeydown({ key: 'Enter', preventDefault: preventEnter })).toBe('next');
    expect(h.counterEl.textContent).toBe('3/3');
    expect(h.jumpedPages[h.jumpedPages.length - 1]).toBe(3);

    expect(h.session.handleInputKeydown({ key: 'Enter', shiftKey: true, preventDefault: preventEnter })).toBe('prev');
    expect(h.counterEl.textContent).toBe('2/3');
    expect(h.jumpedPages[h.jumpedPages.length - 1]).toBe(2);

    // Esc lần 1: đóng thanh tìm, trả focus về #doc-viewer, CHƯA đóng viewer
    const preventEsc1 = vi.fn();
    const stopEsc1 = vi.fn();
    expect(h.session.handleInputKeydown({ key: 'Escape', preventDefault: preventEsc1, stopPropagation: stopEsc1 })).toBe('closed_search');
    expect(h.searchBar.hidden).toBe(true);
    expect(h.docFactory.activeElement).toBe(h.overlay);
    expect(h.onCloseViewer).not.toHaveBeenCalled();

    // Esc lần 2: thanh tìm đã đóng -> đóng viewer
    expect(h.session.handleDocumentKeydown({ key: 'Escape', preventDefault: vi.fn() }, h.docFactory.activeElement, false)).toBe('closed_viewer');
    expect(h.onCloseViewer).toHaveBeenCalledTimes(1);
  });

  it('cancels background indexing at UI level on closing viewer and on switching documents without leaking stale results', async () => {
    // Trường hợp 1: Đóng viewer giữa lúc đang lập chỉ mục
    let resolvePage2A!: (text: string) => void;
    const delayedPage2A = new Promise<string>((resolve) => { resolvePage2A = resolve; });
    const docA = makeSimplePdf([
      'Trang 1 đường sắt',
      () => delayedPage2A,
      'Trang 3 không được phép đọc',
      'Trang 4 không được phép đọc'
    ]);
    const h = createSearchUiHarness();
    h.session.attachPdf({ doc: { id: 'doc-a', can_view_full: true }, mode: 'full', pdf: docA.pdf, totalPages: 4 });
    h.session.openSearch(true);
    h.searchInput.value = 'đường sắt';
    h.session.runQuery(true);

    await vi.waitFor(() => {
      expect(docA.requestedPages).toEqual([1, 2]);
    });

    h.session.close();
    expect(h.searchBar.hidden).toBe(true);
    expect(h.resultsListEl.children).toHaveLength(0);

    resolvePage2A('Trang 2 đường sắt về muộn');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(docA.requestedPages).toEqual([1, 2]);
    expect(h.resultsListEl.children).toHaveLength(0);
    expect(h.metaEl.hidden).toBe(true);

    // Trường hợp 2: Đổi sang tài liệu khác (doc-b) khi doc-a đang lập chỉ mục dở
    let resolvePage2B!: (text: string) => void;
    const delayedPage2B = new Promise<string>((resolve) => { resolvePage2B = resolve; });
    const oldDoc = makeSimplePdf([
      'Tài liệu cũ đường sắt',
      () => delayedPage2B,
      'Trang 3 tài liệu cũ'
    ]);
    const newDoc = makeSimplePdf([
      'Tài liệu mới tiêu chuẩn TCVN',
      'Phụ lục tiêu chuẩn đường bộ'
    ]);

    h.session.attachPdf({ doc: { id: 'doc-old', can_view_full: true }, mode: 'full', pdf: oldDoc.pdf, totalPages: 3 });
    h.session.openSearch(true);
    h.searchInput.value = 'đường sắt';
    h.session.runQuery(true);
    await vi.waitFor(() => {
      expect(oldDoc.requestedPages).toEqual([1, 2]);
    });

    // Chuyển ngay sang tài liệu mới
    h.session.attachPdf({ doc: { id: 'doc-new', can_view_full: true }, mode: 'full', pdf: newDoc.pdf, totalPages: 2 });
    resolvePage2B('Trang 2 cũ đường sắt về muộn');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(oldDoc.requestedPages).toEqual([1, 2]);

    h.session.openSearch(true);
    await vi.waitFor(() => {
      expect(h.session.getSnapshot()?.status).toBe('ready');
    });
    h.searchInput.value = 'tiêu chuẩn';
    h.session.runQuery(true);
    expect(h.counterEl.textContent).toBe('1/2');
    expect(h.resultsListEl.children).toHaveLength(2);
    expect(collectText(h.resultsListEl)).not.toContain('Tài liệu cũ');
  });

  it('shows preview limit notice and NEVER calls getPage outside preview PDF page count', async () => {
    const previewDoc = {
      id: 'preview-doc',
      can_view_full: false,
      file: { page_count: 40, preview_pages: 3 }
    };
    const { pdf, requestedPages } = makeSimplePdf([
      'Trang xem trước 1 về đường sắt',
      'Trang xem trước 2 về tín hiệu',
      'Trang xem trước 3 về đường sắt đô thị'
    ]);
    const h = createSearchUiHarness();
    h.session.attachPdf({ doc: previewDoc, mode: 'preview', pdf, totalPages: 3 });
    h.session.openSearch(true);
    await vi.waitFor(() => {
      expect(h.session.getSnapshot()?.status).toBe('ready');
    });

    expect(h.metaEl.textContent).toContain('Chỉ tìm trong phần xem trước (3 trang)');
    expect(h.resultsStatusEl.textContent).toContain('Chỉ tìm trong phần xem trước (3 trang)');

    h.searchInput.value = 'đường sắt';
    h.session.runQuery(true);
    expect(h.counterEl.textContent).toBe('1/2');
    h.session.goToMatch(1);
    expect(h.counterEl.textContent).toBe('2/2');

    // Mọi lệnh gọi getPage tuyệt đối nằm trong [1..3], không bao giờ chạm trang 4..40
    expect(requestedPages.every(p => p >= 1 && p <= 3)).toBe(true);
    expect(requestedPages).toEqual([1, 2, 3]);
    expect(h.jumpedPages.every(p => p >= 1 && p <= 3)).toBe(true);
  });

  it('indexes a 120-page document in non-blocking batches with bounded memory and fast search', async () => {
    const pageBody = 'Tiêu chuẩn kỹ thuật quốc gia về hệ thống đường sắt đô thị và an toàn chạy tàu RAMS. '.repeat(28);
    const pages = Array.from({ length: 120 }, (_, i) => `Trang ${i + 1}: ${pageBody}`);
    const { pdf } = makeSimplePdf(pages);
    let yieldCount = 0;

    const t0 = performance.now();
    const engine = helpers.createPdfSearchEngine({
      pdf,
      batchSize: 4,
      yieldToMain: async () => {
        yieldCount += 1;
        await Promise.resolve();
      }
    });
    const snap = await engine.startIndexing();
    const indexMs = performance.now() - t0;

    expect(snap.status).toBe('ready');
    expect(snap.indexedPages).toBe(120);
    expect(yieldCount).toBe(29); // 120 / 4 - 1 lần nhường luồng giữa các lô

    const q0 = performance.now();
    const res = engine.setQuery('đường sắt đô thị');
    const searchMs = performance.now() - q0;

    expect(res.totalMatches).toBe(2000); // bị chặn sạch ở ngưỡng 2000 kết quả
    expect(indexMs).toBeLessThan(2000);
    expect(searchMs).toBeLessThan(1000);
    // Ước lượng bộ nhớ hợp lý cho 120 trang (~280KB text) < 15MB
    expect(engine.estimateMemoryBytes()).toBeGreaterThan(0);
    expect(engine.estimateMemoryBytes()).toBeLessThan(15 * 1024 * 1024);
  });
});
