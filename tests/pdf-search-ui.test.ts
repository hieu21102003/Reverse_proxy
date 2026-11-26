import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import '../public/playground.js';

interface FakeNode {
  nodeType: number;
  tagName?: string;
  className?: string;
  type?: string;
  textContent: string;
  attributes?: Record<string, string>;
  style?: Record<string, string>;
  classList?: {
    set: Set<string>;
    toggle: (cls: string, force?: boolean) => boolean;
    contains: (cls: string) => boolean;
  };
  children?: FakeNode[];
  listeners?: Record<string, Array<(ev?: unknown) => void>>;
  setAttribute?: (k: string, v: string) => void;
  getAttribute?: (k: string) => string | null;
  append?: (...items: Array<FakeNode | string>) => void;
  replaceChildren?: (...items: Array<FakeNode | string>) => void;
  addEventListener?: (ev: string, fn: (e?: unknown) => void) => void;
  click?: () => void;
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
}

const helpers = (globalThis as unknown as { __smartrailFileHelpers: SearchUiHelpers }).__smartrailFileHelpers;

function createStrictFakeDom() {
  const createdTags: string[] = [];
  const makeEl = (tagName: string): FakeNode => {
    createdTags.push(tagName.toLowerCase());
    const classes = new Set<string>();
    const el: FakeNode = {
      nodeType: 1,
      tagName: tagName.toLowerCase(),
      className: '',
      type: '',
      textContent: '',
      attributes: {},
      style: {},
      classList: {
        set: classes,
        toggle(cls: string, force?: boolean) {
          const next = force === undefined ? !classes.has(cls) : Boolean(force);
          if (next) classes.add(cls);
          else classes.delete(cls);
          return next;
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
            this.children!.push({ nodeType: 3, textContent: item });
          } else if (item) {
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
  return {
    createdTags,
    docFactory: {
      createElement: (tag: string) => makeEl(tag),
      createTextNode: (text: string): FakeNode => ({ nodeType: 3, textContent: String(text) })
    },
    makeEl
  };
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
  });
});
