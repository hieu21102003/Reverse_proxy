import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { StandardProvider } from '../src/types.js';
import '../public/playground.js';

/**
 * Phase B — document preview UI helpers (pure, no DOM) + lazy-load checks.
 * Field names follow elib's ACTUAL list response (snake_case):
 * doc.can_view_full, doc.file.{page_count, preview_pages, preview_status}.
 */

interface PreviewAffordance {
  showPreview: boolean;
  showPreparing: boolean;
  showViewFull: boolean;
  isImage: boolean;
  previewPages: number | null;
  pageCount: number | null;
  previewStatus: string | null;
}

const helpers = (globalThis as unknown as {
  __smartrailFileHelpers: {
    previewAffordance: (doc: unknown) => PreviewAffordance;
    previewErrorKey: (status: number, code: string | null) => string;
    endOfPreviewKind: (user: unknown) => string;
    elibPreviewPath: (doc: unknown) => string | null;
    elibViewPath: (doc: unknown) => string | null;
  };
}).__smartrailFileHelpers;

function docWith(overrides: Record<string, unknown> = {}, fileOverrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    title: 'Tài liệu mẫu',
    visibility: 'public',
    status: 'published',
    can_view_full: false,
    file: {
      id: 'file-1',
      original_filename: 'mau.pdf',
      mime_type: 'application/pdf',
      page_count: 10,
      preview_pages: 2,
      preview_status: 'ready',
      ...fileOverrides
    },
    ...overrides
  };
}

describe('previewAffordance — trạng thái nút theo preview_status × can_view_full', () => {
  it('ready + không có quyền toàn bộ: chỉ nút Xem trước', () => {
    const aff = helpers.previewAffordance(docWith());
    expect(aff.showPreview).toBe(true);
    expect(aff.showPreparing).toBe(false);
    expect(aff.showViewFull).toBe(false);
    expect(aff.previewPages).toBe(2);
    expect(aff.pageCount).toBe(10);
  });

  it('ready + can_view_full (chủ/admin): cả Xem trước và Xem toàn bộ', () => {
    const aff = helpers.previewAffordance(docWith({ can_view_full: true }));
    expect(aff.showPreview).toBe(true);
    expect(aff.showViewFull).toBe(true);
  });

  it('pending/processing: trạng thái Đang chuẩn bị, không nút Xem trước', () => {
    for (const status of ['pending', 'processing']) {
      const aff = helpers.previewAffordance(docWith({}, { preview_status: status }));
      expect(aff.showPreview, status).toBe(false);
      expect(aff.showPreparing, status).toBe(true);
    }
  });

  it('failed/unsupported: không nút Xem trước; can_view_full vẫn có Xem toàn bộ', () => {
    for (const status of ['failed', 'unsupported']) {
      const aff = helpers.previewAffordance(docWith({}, { preview_status: status }));
      expect(aff.showPreview, status).toBe(false);
      expect(aff.showPreparing, status).toBe(false);
      const full = helpers.previewAffordance(docWith({ can_view_full: true }, { preview_status: status }));
      expect(full.showViewFull, status).toBe(true);
    }
  });

  it('ảnh: isImage=true (viewer ảnh cho chủ/admin, người khác chỉ thông tin)', () => {
    const aff = helpers.previewAffordance(docWith({}, {
      original_filename: 'anh.png', mime_type: 'image/png', preview_status: 'unsupported'
    }));
    expect(aff.isImage).toBe(true);
    expect(aff.showPreview).toBe(false);
  });

  it('thiếu file / thiếu trường: an toàn, không nút nào', () => {
    const aff = helpers.previewAffordance({ id: 'x', file: null });
    expect(aff.showPreview).toBe(false);
    expect(aff.showViewFull).toBe(false);
    expect(aff.previewPages).toBeNull();
  });

  it('đường dẫn preview/view đúng dạng proxy', () => {
    expect(helpers.elibPreviewPath(docWith())).toBe('/api/elib/documents/doc-1/preview');
    expect(helpers.elibViewPath(docWith())).toBe('/api/elib/documents/doc-1/view');
    expect(helpers.elibPreviewPath({})).toBeNull();
  });
});

describe('previewErrorKey — xử lý theo mã ổn định, không parse message', () => {
  it('map đủ các mã lỗi', () => {
    expect(helpers.previewErrorKey(404, 'PREVIEW_NOT_READY')).toBe('previewNotReady');
    expect(helpers.previewErrorKey(415, 'PREVIEW_UNSUPPORTED')).toBe('previewUnsupported');
    expect(helpers.previewErrorKey(415, null)).toBe('previewUnsupported');
    expect(helpers.previewErrorKey(403, 'PREVIEW_NOT_AVAILABLE')).toBe('previewNotAvailable');
    expect(helpers.previewErrorKey(403, null)).toBe('previewNotAvailable');
    expect(helpers.previewErrorKey(429, null)).toBe('previewRateLimited');
    expect(helpers.previewErrorKey(404, null)).toBe('previewNotFound');
    expect(helpers.previewErrorKey(500, null)).toBe('previewLoadError');
    expect(helpers.previewErrorKey(0, null)).toBe('previewLoadError');
  });
});

describe('endOfPreviewKind — thông báo hết preview theo trạng thái đăng nhập', () => {
  it('chưa đăng nhập -> login; đã đăng nhập -> contact', () => {
    expect(helpers.endOfPreviewKind(null)).toBe('login');
    expect(helpers.endOfPreviewKind(undefined)).toBe('login');
    expect(helpers.endOfPreviewKind({ email: 'a@b.c', role: 'viewer' })).toBe('contact');
    expect(helpers.endOfPreviewKind({ email: 'a@b.c', role: 'editor' })).toBe('contact');
  });
});

describe('thẻ file: mỗi nút hành động xuất hiện tối đa một lần (không nhân đôi)', () => {
  const playgroundJs = readFileSync(new URL('../public/playground.js', import.meta.url), 'utf8');

  const countCalls = (source: string, fn: string) =>
    (source.match(new RegExp(`${fn}\\(actions, doc\\)`, 'g')) ?? []).length;

  const sliceBetween = (start: string, end: string) => {
    const from = playgroundJs.indexOf(start);
    const to = playgroundJs.indexOf(end, from);
    expect(from, start).toBeGreaterThanOrEqual(0);
    expect(to, end).toBeGreaterThan(from);
    return playgroundJs.slice(from, to);
  };

  it('mục "Tài liệu mới cập nhật" gắn nút xem trước/toàn bộ đúng một lần', () => {
    const homeRecent = sliceBetween('async function loadHomeRecent()', '// ---- Categories ----');
    expect(countCalls(homeRecent, 'appendPreviewAffordances')).toBe(1);
    expect(countCalls(homeRecent, 'appendDownloadAffordance')).toBe(1);
  });

  it('thẻ file ở tab tìm kiếm cũng gắn đủ nút xem trước/toàn bộ + tải, mỗi loại một lần', () => {
    const fileCard = sliceBetween('function renderFileCard(doc)', 'async function searchFiles');
    expect(countCalls(fileCard, 'appendPreviewAffordances')).toBe(1);
    expect(countCalls(fileCard, 'appendDownloadAffordance')).toBe(1);
  });

  it('không còn hai lời gọi giống hệt nhau liên tiếp (nguyên nhân nút bị nhân đôi)', () => {
    expect(playgroundJs).not.toMatch(
      /appendPreviewAffordances\(actions, doc\);\s*appendPreviewAffordances\(actions, doc\);/
    );
    // Tổng cộng đúng 2 điểm gọi (trang chủ + thẻ tìm kiếm), ngoài định nghĩa hàm.
    expect(countCalls(playgroundJs, 'appendPreviewAffordances')).toBe(2);
  });

  it('appendPreviewAffordances tự chống gọi trùng bằng cờ trên container', () => {
    expect(playgroundJs).toContain("container.dataset.previewAffordances === '1'");
    expect(playgroundJs).toContain("container.dataset.previewAffordances = '1'");
  });
});

describe('lazy-load pdf.js + viewer markup', () => {
  const playgroundJs = readFileSync(new URL('../public/playground.js', import.meta.url), 'utf8');
  const indexHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

  it('pdf.js chỉ nạp bằng dynamic import khi mở viewer, không nằm trong bundle ban đầu', () => {
    expect(playgroundJs).toContain("'/vendor/pdfjs/' + 'pdf.min.mjs'");
    expect(playgroundJs).toContain('import(/* @vite-ignore */ pdfjsUrl)');
    expect(playgroundJs).toContain("workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs'");
    expect(playgroundJs).toContain('isEvalSupported: false');
    // Trang ban đầu không tham chiếu pdf.js ở bất kỳ đâu
    expect(indexHtml).not.toContain('pdfjs');
    expect(indexHtml).not.toContain('pdf.min.mjs');
    // Không có import tĩnh của pdfjs trong playground.js
    expect(playgroundJs).not.toMatch(/^\s*import\s+.*pdfjs/m);
  });

  it('viewer có đủ phần tử: toolbar, trạng thái, panel hết preview, nút đăng nhập', () => {
    for (const id of [
      'doc-viewer', 'doc-viewer-title', 'doc-viewer-pageinfo', 'doc-viewer-status',
      'doc-viewer-pages', 'doc-viewer-img', 'doc-viewer-end', 'doc-viewer-end-login',
      'doc-viewer-close', 'doc-viewer-prev', 'doc-viewer-next', 'doc-viewer-download', 'doc-viewer-print'
    ]) {
      expect(indexHtml, id).toContain(`id="${id}"`);
    }
    // Tải/in theo quyền can_download/can_view_full (xem trước luôn ẩn); đóng bằng Esc; giải phóng tài nguyên
    expect(playgroundJs).toContain('viewerToolbar(doc, mode)');
    expect(playgroundJs).toContain("$('#doc-viewer-download').hidden = !toolbar.showDownload");
    expect(playgroundJs).toContain("$('#doc-viewer-print').hidden = !toolbar.showPrint");
    expect(playgroundJs).toContain("event.key === 'Escape'");
    expect(playgroundJs).toContain('loadingTask.destroy()');
    // Hiển thị X/Y trang
    expect(playgroundJs).toContain("t('previewOfPages'");
  });

  it('vendor pdf.js được phục vụ cùng origin; file lạ bị 404', async () => {
    const provider: StandardProvider = {
      search: async () => ({ data: [], pagination: { currentPage: 1 }, source: 'MULTI' }),
      getDetail: async () => null
    };
    const app = await createApp(provider);
    try {
      const lib = await app.inject({ method: 'GET', url: '/vendor/pdfjs/pdf.min.mjs' });
      expect(lib.statusCode).toBe(200);
      expect(lib.headers['content-type']).toContain('text/javascript');
      const worker = await app.inject({ method: 'GET', url: '/vendor/pdfjs/pdf.worker.min.mjs' });
      expect(worker.statusCode).toBe(200);
      const font = await app.inject({ method: 'GET', url: '/vendor/pdfjs/standard_fonts/FoxitFixed.pfb' });
      expect(font.statusCode).toBe(200);
      // pdf.js maps Helvetica to LiberationSans .ttf — these must serve too.
      const ttf = await app.inject({ method: 'GET', url: '/vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf' });
      expect(ttf.statusCode).toBe(200);
      const badFont = await app.inject({ method: 'GET', url: '/vendor/pdfjs/standard_fonts/evil.mjs' });
      expect(badFont.statusCode).toBe(404);
      const bad = await app.inject({ method: 'GET', url: '/vendor/pdfjs/evil.mjs' });
      expect(bad.statusCode).toBe(404);
      const traversal = await app.inject({ method: 'GET', url: '/vendor/pdfjs/standard_fonts/..%2Fpdf.min.mjs' });
      expect(traversal.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
