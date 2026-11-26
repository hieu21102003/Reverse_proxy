import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import '../public/playground.js';

interface TocTreeNode {
  id: string;
  title: string;
  level: number;
  page_pdf: number;
  sort: number;
  source: string | null;
  confidence: number | null;
  locked: boolean;
  virtual: boolean;
  matched?: boolean;
  autoExpand?: boolean;
  children: TocTreeNode[];
}

interface TocViewState {
  kind: 'hidden' | 'processing' | 'ready';
  nodes?: unknown[];
  previewOnly?: boolean;
  effectiveSource?: 'auto' | 'manual' | null;
  flags?: string[];
  showLevel1Note?: boolean;
  showManualBadge?: boolean;
}

interface FileHelpers {
  TOC_POLL_INTERVAL_MS: number;
  TOC_POLL_MAX_RETRIES: number;
  elibTocPath: (doc: unknown, fileId?: unknown) => string | null;
  resolveTocViewState: (result: unknown) => TocViewState;
  shouldPollToc: (tocState: unknown, retryCount: number) => boolean;
  tocFooterKeys: (tocState: unknown) => string[];
  buildTocTree: (flatNodes: unknown, options?: Record<string, unknown>) => TocTreeNode[];
  normalizeTocSearchText: (value: unknown) => string;
  filterTocTree: (tree: TocTreeNode[], query: unknown) => TocTreeNode[];
  findActiveTocNodeId: (tree: TocTreeNode[], currentPage: number) => string | null;
  tocNodeClickAction: (node: unknown, totalLoadedPages?: number | null) => { action: string; page?: number };
  createTocListDom: (docFactory: unknown, nodes: TocTreeNode[], opts?: Record<string, unknown>) => FakeElement[];
}

interface FakeElement {
  tagName: string;
  namespaceURI: string | null;
  className: string;
  type: string;
  hidden: boolean;
  textContent: string;
  attributes: Record<string, string>;
  children: FakeElement[];
  listeners: Record<string, Array<(ev?: { stopPropagation?: () => void }) => void>>;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  append: (...items: Array<FakeElement | string>) => void;
  addEventListener: (event: string, fn: (ev?: { stopPropagation?: () => void }) => void) => void;
  click: () => void;
}

function createStrictFakeDom() {
  const createdTags: string[] = [];
  const makeEl = (tagName: string, namespaceURI: string | null = null): FakeElement => {
    createdTags.push(tagName.toLowerCase());
    const el: FakeElement = {
      tagName: tagName.toLowerCase(),
      namespaceURI,
      className: '',
      type: '',
      hidden: false,
      textContent: '',
      attributes: {},
      children: [],
      listeners: {},
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      },
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
      },
      append(...items) {
        for (const item of items) {
          if (typeof item === 'string') {
            this.textContent += item;
          } else if (item) {
            this.children.push(item);
          }
        }
      },
      addEventListener(event, fn) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(fn);
      },
      click() {
        for (const fn of this.listeners.click || []) {
          fn({ stopPropagation() {} });
        }
      }
    };
    Object.defineProperty(el, 'innerHTML', {
      configurable: true,
      get() {
        return '';
      },
      set() {
        throw new Error('TOC rendering must not set innerHTML');
      }
    });
    return el;
  };
  return {
    createdTags,
    factory: {
      createElement: (tag: string) => makeEl(tag, null),
      createElementNS: (ns: string, tag: string) => makeEl(tag, ns)
    }
  };
}

function findAll(roots: FakeElement[], predicate: (el: FakeElement) => boolean): FakeElement[] {
  const out: FakeElement[] = [];
  const walk = (nodes: FakeElement[]) => {
    for (const node of nodes) {
      if (predicate(node)) out.push(node);
      if (node.children.length > 0) walk(node.children);
    }
  };
  walk(roots);
  return out;
}

const helpers = (globalThis as unknown as { __smartrailFileHelpers: FileHelpers }).__smartrailFileHelpers;

describe('elibTocPath — đúng endpoint theo phiên bản hiện hành hoặc fileId', () => {
  it('mặc định gọi /api/elib/documents/:id/toc', () => {
    expect(helpers.elibTocPath({ id: 'doc-1' })).toBe('/api/elib/documents/doc-1/toc');
    expect(
      helpers.elibTocPath({ id: 'doc-1', current_file_id: 'f1', file: { id: 'f1' } })
    ).toBe('/api/elib/documents/doc-1/toc');
  });

  it('có fileId tường minh hoặc đang xem phiên bản khác current_file_id -> /files/:fileId/toc', () => {
    expect(helpers.elibTocPath({ id: 'doc-1' }, 'f-old')).toBe('/api/elib/documents/doc-1/files/f-old/toc');
    expect(
      helpers.elibTocPath({ id: 'doc-1', current_file_id: 'f2', file: { id: 'f1' } })
    ).toBe('/api/elib/documents/doc-1/files/f1/toc');
  });

  it('thiếu id tài liệu -> null', () => {
    expect(helpers.elibTocPath(null)).toBeNull();
    expect(helpers.elibTocPath({})).toBeNull();
    expect(helpers.elibTocPath({ id: '   ' })).toBeNull();
  });
});

describe('buildTocTree — dựng cây từ mảng phẳng + node ảo "Trang đầu"', () => {
  it('mảng rỗng hoặc không hợp lệ -> mảng rỗng (không thêm Trang đầu)', () => {
    expect(helpers.buildTocTree([])).toEqual([]);
    expect(helpers.buildTocTree(null)).toEqual([]);
    expect(helpers.buildTocTree(undefined)).toEqual([]);
    expect(helpers.buildTocTree([null, 'x'])).toEqual([]);
  });

  it('dựng cây lồng cấp chuẩn và thêm node ảo "Trang đầu" -> trang 1', () => {
    const flat = [
      { title: 'Chương 1', level: 1, page_pdf: 3, sort: 1, source: 'outline', confidence: 1, locked: false },
      { title: '1.1 Phạm vi', level: 2, page_pdf: 3, sort: 2, source: 'outline', confidence: 1, locked: false },
      { title: '1.1.1 Chi tiết', level: 3, page_pdf: 4, sort: 3, source: 'outline', confidence: 1, locked: false },
      { title: '1.2 Tài liệu viện dẫn', level: 2, page_pdf: 5, sort: 4, source: 'outline', confidence: 1, locked: false },
      { title: 'Chương 2', level: 1, page_pdf: 8, sort: 5, source: 'outline', confidence: 1, locked: false }
    ];
    const tree = helpers.buildTocTree(flat, { previewOnly: false });
    expect(tree).toHaveLength(3);
    expect(tree[0]).toMatchObject({
      title: 'Trang đầu',
      level: 1,
      page_pdf: 1,
      virtual: true,
      locked: false,
      children: []
    });
    expect(tree[1].title).toBe('Chương 1');
    expect(tree[1].children).toHaveLength(2);
    expect(tree[1].children[0].title).toBe('1.1 Phạm vi');
    expect(tree[1].children[0].children).toHaveLength(1);
    expect(tree[1].children[0].children[0].title).toBe('1.1.1 Chi tiết');
    expect(tree[1].children[1].title).toBe('1.2 Tài liệu viện dẫn');
    expect(tree[2].title).toBe('Chương 2');
    expect(tree[2].children).toEqual([]);
  });

  it('xử lý nhảy cấp (1 -> 3 -> 2) và đầu mảng bắt đầu từ level > 1 (3 -> 4 -> 2) không sinh node ảo trung gian', () => {
    const jumped = [
      { title: 'Phần A', level: 1, page_pdf: 2, sort: 1, locked: false },
      { title: 'Mục nhảy cấp', level: 3, page_pdf: 3, sort: 2, locked: false },
      { title: 'Mục cấp 2', level: 2, page_pdf: 4, sort: 3, locked: false }
    ];
    const tree1 = helpers.buildTocTree(jumped, { includeFirstPage: false, previewOnly: false });
    expect(tree1).toHaveLength(1);
    expect(tree1[0].title).toBe('Phần A');
    expect(tree1[0].children.map(c => c.title)).toEqual(['Mục nhảy cấp', 'Mục cấp 2']);
    expect(tree1[0].children.every(c => !c.virtual)).toBe(true);

    const leadingHighLevel = [
      { title: 'Mục lẻ cấp 3', level: 3, page_pdf: 2, sort: 1, locked: false },
      { title: 'Mục con cấp 4', level: 4, page_pdf: 3, sort: 2, locked: false },
      { title: 'Mục cấp 2', level: 2, page_pdf: 4, sort: 3, locked: false }
    ];
    const tree2 = helpers.buildTocTree(leadingHighLevel, { includeFirstPage: false, previewOnly: false });
    expect(tree2).toHaveLength(2);
    expect(tree2[0].title).toBe('Mục lẻ cấp 3');
    expect(tree2[0].children.map(c => c.title)).toEqual(['Mục con cấp 4']);
    expect(tree2[1].title).toBe('Mục cấp 2');
  });

  it('sắp xếp theo sort nếu đầu vào chưa theo thứ tự; preview_only=false luôn bỏ khóa', () => {
    const unordered = [
      { title: 'Mục sau', level: 1, page_pdf: 9, sort: 20, locked: true },
      { title: 'Mục đầu', level: 1, page_pdf: 2, sort: 5, locked: true }
    ];
    const fullTree = helpers.buildTocTree(unordered, { previewOnly: false });
    expect(fullTree.map(n => n.title)).toEqual(['Trang đầu', 'Mục đầu', 'Mục sau']);
    expect(fullTree.every(n => n.locked === false)).toBe(true);

    // Khi previewOnly=true: chỉ đọc cờ locked có sẵn từ server, không tự đoán theo preview_pages
    const previewTree = helpers.buildTocTree(
      [
        { title: 'Trang xa nhưng server mở', level: 1, page_pdf: 99, sort: 1, locked: false },
        { title: 'Trang gần nhưng server khóa', level: 1, page_pdf: 2, sort: 2, locked: true }
      ],
      { previewOnly: true, includeFirstPage: false }
    );
    expect(previewTree[0].locked).toBe(false);
    expect(previewTree[1].locked).toBe(true);
  });
});

describe('resolveTocViewState / shouldPollToc / tocFooterKeys — xử lý đủ mọi trạng thái API', () => {
  it('displayable=true + có nodes -> ready; nhãn chân chỉ hiện contents_level1_only và manual', () => {
    const state = helpers.resolveTocViewState({
      status: 200,
      payload: {
        state: 'ready',
        displayable: true,
        effective_source: 'manual',
        algorithm_version: null,
        status: null,
        strategy: null,
        flags: ['contents_level1_only', 'printed_toc_fallback', 'low_confidence'],
        offset: null,
        needs_ocr_pages: [],
        preview_only: true,
        nodes: [{ title: 'Chương 1', level: 1, page_pdf: 1, sort: 1, locked: false }]
      }
    });
    expect(state.kind).toBe('ready');
    expect(state.previewOnly).toBe(true);
    expect(helpers.tocFooterKeys(state)).toEqual(['tocSummaryLevel1', 'tocManualVerified']);
  });

  it('displayable=true + nodes: [] (kể cả manual) -> hidden', () => {
    const state = helpers.resolveTocViewState({
      status: 200,
      payload: {
        state: 'ready',
        displayable: true,
        effective_source: 'manual',
        flags: [],
        preview_only: false,
        nodes: []
      }
    });
    expect(state.kind).toBe('hidden');
  });

  it('effective_source=null và flags rỗng -> vẫn ready bình thường, không nhãn phụ', () => {
    const state = helpers.resolveTocViewState({
      status: 200,
      payload: {
        state: 'ready',
        displayable: true,
        effective_source: null,
        status: null,
        strategy: null,
        algorithm_version: null,
        flags: ['internal_debug_flag'],
        offset: { primaryOffset: 2 },
        needs_ocr_pages: [1, 2],
        preview_only: false,
        nodes: [{ title: '1. Mở đầu', level: 1, page_pdf: 1, sort: 1, locked: false }]
      }
    });
    expect(state.kind).toBe('ready');
    expect(helpers.tocFooterKeys(state)).toEqual([]);
  });

  it('state=processing -> processing và poll tối đa 2 lần', () => {
    const state = helpers.resolveTocViewState({
      status: 200,
      payload: {
        state: 'processing',
        displayable: false,
        effective_source: null,
        status: null,
        strategy: null,
        algorithm_version: null,
        flags: [],
        nodes: []
      }
    });
    expect(state.kind).toBe('processing');
    expect(helpers.TOC_POLL_INTERVAL_MS).toBe(4000);
    expect(helpers.TOC_POLL_MAX_RETRIES).toBe(2);
    expect(helpers.shouldPollToc(state, 0)).toBe(true);
    expect(helpers.shouldPollToc(state, 1)).toBe(true);
    expect(helpers.shouldPollToc(state, 2)).toBe(false);
    expect(helpers.shouldPollToc(state, 3)).toBe(false);
  });

  it('displayable=false (failed, unsupported, not_enabled, partial, needs_ocr) -> hidden lặng lẽ', () => {
    for (const [stateName, statusName] of [
      ['failed', 'failed'],
      ['unsupported', 'unsupported'],
      ['not_enabled', null],
      ['ready', 'partial'],
      ['ready', 'needs_ocr']
    ] as const) {
      const resolved = helpers.resolveTocViewState({
        status: 200,
        payload: {
          state: stateName,
          displayable: false,
          effective_source: null,
          status: statusName,
          strategy: null,
          needs_ocr_pages: [1, 2, 3],
          nodes: [{ title: 'Không được hiện', level: 1, page_pdf: 1, sort: 1, locked: false }]
        }
      });
      expect(resolved.kind, `${stateName}/${statusName}`).toBe('hidden');
    }
  });

  it('404 / 403 / ROUTE_NOT_FOUND / elib tắt / lỗi mạng -> hidden lặng lẽ', () => {
    for (const result of [
      { status: 404, errorCode: 'NOT_FOUND', payload: { error: { code: 'NOT_FOUND' } } },
      { status: 404, errorCode: 'ROUTE_NOT_FOUND', payload: { error: { code: 'ROUTE_NOT_FOUND' } } },
      { status: 404, errorCode: 'ELIB_ROUTE_NOT_FOUND', payload: { error: { code: 'ELIB_ROUTE_NOT_FOUND' } } },
      { status: 403, errorCode: 'FORBIDDEN', payload: undefined },
      { status: 503, errorCode: 'ELIB_DISABLED', payload: undefined },
      { status: 502, errorCode: 'ELIB_UNAVAILABLE', payload: undefined },
      { status: null, errorCode: '', payload: undefined },
      null
    ]) {
      expect(helpers.resolveTocViewState(result).kind, JSON.stringify(result)).toBe('hidden');
    }
  });
});

describe('filterTocTree — tìm kiếm tiếng Việt không phân biệt dấu/hoa thường', () => {
  const tree = helpers.buildTocTree([
    { title: '1. Phạm vi áp dụng', level: 1, page_pdf: 2, sort: 1, locked: false },
    { title: '2. Đường sắt đô thị', level: 1, page_pdf: 4, sort: 2, locked: false },
    { title: '2.1 Điều 4 — Tín hiệu đường sắt', level: 2, page_pdf: 5, sort: 3, locked: false },
    { title: '3. An toàn khai thác', level: 1, page_pdf: 9, sort: 4, locked: true }
  ], { previewOnly: true });

  it('khớp tiếng Việt có dấu / không dấu / chữ Đđ / hoa thường', () => {
    expect(helpers.normalizeTocSearchText('Đường sắt ĐÔ THỊ')).toBe('duong sat do thi');

    const match1 = helpers.filterTocTree(tree, 'duong sat');
    expect(match1).toHaveLength(1);
    expect(match1[0].title).toBe('2. Đường sắt đô thị');
    expect(match1[0].children.map(c => c.title)).toEqual(['2.1 Điều 4 — Tín hiệu đường sắt']);

    const match2 = helpers.filterTocTree(tree, 'DIEU 4');
    expect(match2).toHaveLength(1);
    expect(match2[0].autoExpand).toBe(true);
    expect(match2[0].matched).toBe(false);
    expect(match2[0].children).toHaveLength(1);
    expect(match2[0].children[0].matched).toBe(true);

    const match3 = helpers.filterTocTree(tree, 'PHẠM VI');
    expect(match3.map(n => n.title)).toEqual(['1. Phạm vi áp dụng']);

    expect(helpers.filterTocTree(tree, '   ')).toHaveLength(tree.length);
    expect(helpers.filterTocTree(tree, 'khong-ton-tai')).toEqual([]);
  });
});

describe('findActiveTocNodeId — highlight mục đang đọc theo trang hiện tại', () => {
  const tree = helpers.buildTocTree([
    { title: 'Chương 1', level: 1, page_pdf: 2, sort: 1, locked: false },
    { title: '1.1 Chi tiết', level: 2, page_pdf: 4, sort: 2, locked: false },
    { title: 'Chương 2 (khóa)', level: 1, page_pdf: 8, sort: 3, locked: true }
  ], { previewOnly: true });

  it('trang 1 chọn "Trang đầu" nếu chương đầu bắt đầu từ trang >= 2; chọn chương nếu bắt đầu ở trang 1', () => {
    expect(helpers.findActiveTocNodeId(tree, 1)).toBe('toc-virtual-first');
    expect(helpers.findActiveTocNodeId(tree, 2)).toBe('toc-node-0');
    expect(helpers.findActiveTocNodeId(tree, 3)).toBe('toc-node-0');
    expect(helpers.findActiveTocNodeId(tree, 6)).toBe('toc-node-1');
    // Node locked không được chọn làm mục đang đọc
    expect(helpers.findActiveTocNodeId(tree, 10)).toBe('toc-node-1');

    const startsOnPage1 = helpers.buildTocTree([
      { title: 'Lời nói đầu', level: 1, page_pdf: 1, sort: 1, locked: false },
      { title: 'Chương 1', level: 1, page_pdf: 3, sort: 2, locked: false }
    ], { previewOnly: false });
    expect(helpers.findActiveTocNodeId(startsOnPage1, 1)).toBe('toc-node-0');
  });
});

describe('createTocListDom & tương tác — XSS, locked, thu gọn/mở rộng, nhảy trang', () => {
  it('render tiêu đề chứa <img onerror>/<script> qua textContent, tuyệt đối không dùng innerHTML', () => {
    const { factory, createdTags } = createStrictFakeDom();
    const xssTitle1 = '<img src=x onerror=alert(1)>';
    const xssTitle2 = '<script>alert("xss")</script>';
    const tree = helpers.buildTocTree([
      { title: xssTitle1, level: 1, page_pdf: 1, sort: 1, locked: false },
      { title: xssTitle2, level: 2, page_pdf: 2, sort: 2, locked: false }
    ], { previewOnly: false });

    const lis = helpers.createTocListDom(factory, tree);
    expect(createdTags).not.toContain('img');
    expect(createdTags).not.toContain('script');
    const titles = findAll(lis, el => el.className === 'toc-node-title').map(el => el.textContent);
    expect(titles).toEqual(['Trang đầu', xssTitle1, xssTitle2]);
  });

  it('bấm mục locked=true chỉ báo cần quyền, không nhảy trang, không tải trang; có icon khóa', () => {
    const { factory } = createStrictFakeDom();
    const onJump = vi.fn();
    const onLocked = vi.fn();
    const tree = helpers.buildTocTree([
      { title: 'Mục mở', level: 1, page_pdf: 2, sort: 1, locked: false },
      { title: 'Mục khóa', level: 1, page_pdf: 10, sort: 2, locked: true }
    ], { previewOnly: true });

    const lis = helpers.createTocListDom(factory, tree, {
      activeId: 'toc-node-0',
      totalLoadedPages: 3,
      onJump,
      onLocked
    });
    const buttons = findAll(lis, el => el.className.split(' ').includes('toc-node-btn'));
    const unlockedBtn = buttons.find(b => b.getAttribute('data-toc-id') === 'toc-node-0')!;
    const lockedBtn = buttons.find(b => b.getAttribute('data-toc-id') === 'toc-node-1')!;

    expect(unlockedBtn.className).toContain('is-active');
    expect(unlockedBtn.getAttribute('aria-current')).toBe('location');
    expect(lockedBtn.className).toContain('is-locked');
    expect(lockedBtn.getAttribute('data-locked')).toBe('true');
    expect(findAll([lockedBtn], el => el.className === 'toc-node-lock')).toHaveLength(1);

    lockedBtn.click();
    expect(onLocked).toHaveBeenCalledTimes(1);
    expect(onJump).not.toHaveBeenCalled();

    unlockedBtn.click();
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump.mock.calls[0][0]).toBe(2);

    // Bảo vệ thêm: kể cả locked=false nhưng page vượt tổng số trang đang tải -> không nhảy
    expect(helpers.tocNodeClickAction({ page_pdf: 5, locked: false }, 3)).toEqual({ action: 'locked' });
  });

  it('nút thu gọn/mở rộng ẩn/hiện cây con và không kích hoạt nhảy trang', () => {
    const { factory } = createStrictFakeDom();
    const onJump = vi.fn();
    const onToggleCollapse = vi.fn();
    const tree = helpers.buildTocTree([
      { title: 'Chương 1', level: 1, page_pdf: 2, sort: 1, locked: false },
      { title: '1.1 Mục con', level: 2, page_pdf: 3, sort: 2, locked: false }
    ], { previewOnly: false, includeFirstPage: false });

    const expanded = helpers.createTocListDom(factory, tree, {
      collapsedIds: new Set<string>(),
      onJump,
      onToggleCollapse
    });
    const caret = findAll(expanded, el => el.className === 'toc-caret')[0];
    const subListExpanded = findAll(expanded, el => el.className === 'toc-children')[0];
    expect(caret.getAttribute('aria-expanded')).toBe('true');
    expect(subListExpanded.hidden).toBe(false);

    caret.click();
    expect(onToggleCollapse).toHaveBeenCalledWith('toc-node-0');
    expect(onJump).not.toHaveBeenCalled();

    const collapsed = helpers.createTocListDom(factory, tree, {
      collapsedIds: new Set<string>(['toc-node-0'])
    });
    const caretCollapsed = findAll(collapsed, el => el.className === 'toc-caret')[0];
    const subListCollapsed = findAll(collapsed, el => el.className === 'toc-children')[0];
    expect(caretCollapsed.getAttribute('aria-expanded')).toBe('false');
    expect(subListCollapsed.hidden).toBe(true);
  });
});

describe('gắn DOM & hợp đồng tĩnh P2', () => {
  const indexHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const playgroundCss = readFileSync(new URL('../public/playground.css', import.meta.url), 'utf8');
  const playgroundJs = readFileSync(new URL('../public/playground.js', import.meta.url), 'utf8');

  it('index.html có đủ phần tử sidebar TOC (nằm dưới toolbar) và bump ?v=17', () => {
    for (const id of [
      'doc-viewer-toc-toggle',
      'doc-viewer-toc',
      'doc-viewer-toc-close',
      'doc-viewer-toc-search-wrap',
      'doc-viewer-toc-search',
      'doc-viewer-toc-status',
      'doc-viewer-toc-nav',
      'doc-viewer-toc-list',
      'doc-viewer-toc-foot',
      'doc-viewer-toc-backdrop',
      'doc-viewer-stage'
    ]) {
      expect(indexHtml, id).toContain(`id="${id}"`);
    }
    expect(indexHtml).toContain('playground.css?v=17');
    expect(indexHtml).toContain('playground.js?v=17');
  });

  it('playground.css có drawer mobile dưới toolbar và style mục khóa/đang đọc', () => {
    expect(playgroundCss).toContain('.doc-viewer-toc');
    expect(playgroundCss).toContain('.toc-node-btn.is-active');
    expect(playgroundCss).toContain('.toc-node-btn.is-locked');
    expect(playgroundCss).toContain('@media (max-width: 768px)');
    expect(playgroundCss).toContain('.doc-viewer-toc.is-drawer-open');
  });

  it('playground.js nối poll 2 lần × 4s, khóa tái dùng showPreviewAccessNotice, không dùng innerHTML cho TOC, đủ i18n VI/EN', () => {
    expect(playgroundJs).toContain('const TOC_POLL_INTERVAL_MS = 4000;');
    expect(playgroundJs).toContain('const TOC_POLL_MAX_RETRIES = 2;');
    expect(playgroundJs).toContain('resetViewerToc();');
    expect(playgroundJs).toContain('showPreviewAccessNotice(true)');
    expect(playgroundJs).toContain('void loadViewerToc(doc, options, tocSeq, 0);');
    for (const phrase of [
      "tocFirstPage: 'Trang đầu'",
      "tocFirstPage: 'First page'",
      "tocProcessing: 'Đang tạo mục lục…'",
      "tocProcessing: 'Generating table of contents…'",
      "tocSummaryLevel1: 'Mục lục tóm tắt cấp chương/phần'",
      "tocManualVerified: 'Mục lục đã kiểm duyệt'"
    ]) {
      expect(playgroundJs, phrase).toContain(phrase);
    }
    const tocStart = playgroundJs.indexOf('function createTocListDom');
    const tocEnd = playgroundJs.indexOf('const fileHelpers =', tocStart);
    expect(playgroundJs.slice(tocStart, tocEnd)).not.toContain('innerHTML');
  });
});
