import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import '../public/playground.js';

/**
 * Siết nút tải xuống theo quyền chủ tài liệu/admin: thẻ file chỉ hiện
 * "Tải xuống" khi can_download=true (elib gửi theo người dùng hiện
 * tại, ẩn danh=false); đã đăng nhập mà không có quyền -> gợi ý liên
 * hệ xin quyền (kênh ELIB_CONTACT từ ui-config); ẩn danh -> "Đăng
 * nhập để tải" như trước. Viewer toàn bộ: tải cần can_download,
 * in/mở bản gốc cần can_view_full. Lỗi 403 DOWNLOAD_FORBIDDEN map
 * theo mã ổn định sang thông báo rõ.
 */

interface ViewerToolbar {
  showDownload: boolean;
  showPrint: boolean;
}

const helpers = (globalThis as unknown as {
  __smartrailFileHelpers: {
    downloadAffordance: (doc: unknown, user: unknown) => string;
    viewerToolbar: (doc: unknown, mode: unknown) => ViewerToolbar;
    downloadErrorKey: (status: number, code: string | null) => string;
    filenameFromDisposition: (header: unknown) => string | null;
  };
}).__smartrailFileHelpers;

const owner = { id: 'user-owner', email: 'owner@congty.vn', role: 'editor' };
const admin = { id: 'u-admin', email: 'admin@congty.vn', role: 'admin' };
const viewer = { id: 'u-viewer', email: 'viewer@congty.vn', role: 'viewer' };

function docWith(overrides: Record<string, unknown> = {}, fileOverrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    title: 'Tài liệu mẫu',
    visibility: 'public',
    status: 'published',
    created_by: 'user-owner',
    can_view_full: false,
    can_download: false,
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

describe('downloadAffordance — nút tải trên thẻ theo can_download × đăng nhập', () => {
  it('can_download=true (chủ/admin): nút Tải xuống', () => {
    expect(helpers.downloadAffordance(docWith({ can_download: true }), owner)).toBe('download');
    expect(helpers.downloadAffordance(docWith({ can_download: true }), admin)).toBe('download');
  });

  it('đã đăng nhập, can_download=false: gợi ý liên hệ xin quyền (không có nút tải)', () => {
    expect(helpers.downloadAffordance(docWith(), viewer)).toBe('contact');
    expect(helpers.downloadAffordance(docWith(), owner)).toBe('contact');
    expect(helpers.downloadAffordance(docWith(), admin)).toBe('contact');
  });

  it('ẩn danh (can_download=false): Đăng nhập để tải như trước', () => {
    expect(helpers.downloadAffordance(docWith(), null)).toBe('login');
    expect(helpers.downloadAffordance(docWith(), undefined)).toBe('login');
  });

  it('thiếu can_download (elib cũ chưa gửi): fail-closed, không hiện nút tải', () => {
    const legacy = docWith();
    delete (legacy as Record<string, unknown>).can_download;
    expect(helpers.downloadAffordance(legacy, viewer)).toBe('contact');
    expect(helpers.downloadAffordance(legacy, null)).toBe('login');
  });

  it('can_download không phải boolean true: không tải', () => {
    for (const value of ['true', 1, 'yes']) {
      expect(helpers.downloadAffordance(docWith({ can_download: value }), owner), String(value)).toBe('contact');
    }
  });

  it('không có file: không hiện gì, kể cả khi can_download=true', () => {
    expect(helpers.downloadAffordance(docWith({ can_download: true }, { id: undefined }), owner)).toBe('none');
    expect(helpers.downloadAffordance({ id: 'x', file: null, can_download: true }, owner)).toBe('none');
    expect(helpers.downloadAffordance(null, owner)).toBe('none');
  });
});

describe('viewerToolbar — nút tải/in ở chế độ toàn bộ theo can_download/can_view_full', () => {
  it('chế độ xem trước: luôn ẩn cả tải và in', () => {
    const toolbar = helpers.viewerToolbar(docWith({ can_download: true, can_view_full: true }), 'preview');
    expect(toolbar.showDownload).toBe(false);
    expect(toolbar.showPrint).toBe(false);
  });

  it('toàn bộ + đủ hai quyền (chủ/admin): hiện cả tải và in', () => {
    for (const mode of ['full', 'image']) {
      const toolbar = helpers.viewerToolbar(docWith({ can_download: true, can_view_full: true }), mode);
      expect(toolbar.showDownload, mode).toBe(true);
      expect(toolbar.showPrint, mode).toBe(true);
    }
  });

  it('toàn bộ nhưng thiếu quyền tương ứng: ẩn nút đó', () => {
    const downloadOnly = helpers.viewerToolbar(docWith({ can_download: true, can_view_full: false }), 'full');
    expect(downloadOnly.showDownload).toBe(true);
    expect(downloadOnly.showPrint).toBe(false);
    const printOnly = helpers.viewerToolbar(docWith({ can_download: false, can_view_full: true }), 'full');
    expect(printOnly.showDownload).toBe(false);
    expect(printOnly.showPrint).toBe(true);
    const none = helpers.viewerToolbar(docWith(), 'full');
    expect(none.showDownload).toBe(false);
    expect(none.showPrint).toBe(false);
  });

  it('thiếu trường quyền / thiếu file: ẩn, không lỗi', () => {
    expect(helpers.viewerToolbar({ id: 'x', file: null }, 'full')).toEqual({ showDownload: false, showPrint: false });
    expect(helpers.viewerToolbar(null, 'full')).toEqual({ showDownload: false, showPrint: false });
    expect(helpers.viewerToolbar(docWith({ can_download: true }), 'full').showDownload).toBe(true);
    expect(helpers.viewerToolbar(docWith({ can_download: true }, { id: undefined }), 'full').showDownload).toBe(false);
  });
});

describe('downloadErrorKey — xử lý 403 DOWNLOAD_FORBIDDEN theo mã ổn định', () => {
  it('map đủ các trường hợp, không parse message', () => {
    expect(helpers.downloadErrorKey(403, 'DOWNLOAD_FORBIDDEN')).toBe('downloadForbidden');
    expect(helpers.downloadErrorKey(403, null)).toBe('downloadForbidden');
    expect(helpers.downloadErrorKey(404, null)).toBe('downloadNotFound');
    expect(helpers.downloadErrorKey(429, null)).toBe('downloadRateLimited');
    expect(helpers.downloadErrorKey(500, null)).toBe('downloadFailed');
    expect(helpers.downloadErrorKey(0, null)).toBe('downloadFailed');
  });
});

describe('filenameFromDisposition — tên file khi tải qua fetch', () => {
  it('đọc filename thường, có ngoặc kép và filename* UTF-8', () => {
    expect(helpers.filenameFromDisposition('attachment; filename="bao-cao.pdf"')).toBe('bao-cao.pdf');
    expect(helpers.filenameFromDisposition('attachment; filename=bao-cao.pdf')).toBe('bao-cao.pdf');
    expect(helpers.filenameFromDisposition("attachment; filename*=UTF-8''b%C3%A1o-c%C3%A1o.pdf")).toBe('báo-cáo.pdf');
    expect(helpers.filenameFromDisposition('attachment')).toBeNull();
    expect(helpers.filenameFromDisposition(null)).toBeNull();
    expect(helpers.filenameFromDisposition(undefined)).toBeNull();
  });
});

describe('gắn DOM: thẻ file, gợi ý liên hệ, tải qua fetch, toolbar viewer', () => {
  const playgroundJs = readFileSync(new URL('../public/playground.js', import.meta.url), 'utf8');
  const playgroundCss = readFileSync(new URL('../public/playground.css', import.meta.url), 'utf8');

  const sliceBetween = (start: string, end: string) => {
    const from = playgroundJs.indexOf(start);
    const to = playgroundJs.indexOf(end, from);
    expect(from, start).toBeGreaterThanOrEqual(0);
    expect(to, end).toBeGreaterThan(from);
    return playgroundJs.slice(from, to);
  };

  it('appendDownloadAffordance rẽ nhánh theo downloadAffordance, tự chống gọi trùng', () => {
    const fn = sliceBetween('function appendDownloadAffordance(container, doc)', '// ---- Danh mục tài liệu');
    expect(fn).toContain('downloadAffordance(doc, elibUser)');
    expect(fn).toContain("container.dataset.downloadAffordance === '1'");
    expect(fn).toContain("t('loginToDownload')");
    expect(fn).toContain("t('downloadContactHint')");
    expect(fn).toContain('normalizeContact(uiConfig)');
    expect(fn).toContain("t('elibDownload')");
    expect(fn).toContain('downloadFile(doc)');
  });

  it('downloadFile bắt lỗi theo mã ổn định và hiện thông báo rõ (không lỗi trống)', () => {
    const fn = sliceBetween('async function downloadFile(doc)', 'function appendDownloadAffordance(container, doc)');
    expect(fn).toContain("fetch(path, { credentials: 'same-origin' })");
    expect(fn).toContain('downloadErrorKey(res.status, code)');
    expect(fn).toContain('showToast(t(downloadErrorKey(res.status, code)))');
    expect(fn).toContain("filenameFromDisposition(res.headers.get('content-disposition'))");
    // Chuỗi thông báo đúng wording đã chốt (VI + EN)
    expect(playgroundJs).toContain('Bạn không có quyền tải xuống tài liệu này. Chỉ chủ tài liệu hoặc quản trị viên mới tải xuống được.');
    expect(playgroundJs).toContain('You do not have permission to download this document. Only the document owner or an administrator can download it.');
    expect(playgroundJs).toContain('Liên hệ để được cấp quyền tải xuống.');
    expect(playgroundJs).toContain('Contact us to request download access.');
  });

  it('viewer: toolbar theo viewerToolbar, nút tải đi qua downloadFile', () => {
    const viewer = sliceBetween('async function openDocViewer(doc, mode, options = {})', 'async function loadHomeRecent()');
    expect(viewer).toContain('viewerToolbar(doc, mode)');
    expect(viewer).toContain("$('#doc-viewer-download').hidden = !toolbar.showDownload");
    expect(viewer).toContain("$('#doc-viewer-print').hidden = !toolbar.showPrint");
    expect(playgroundJs).toContain("$('#doc-viewer-download').addEventListener('click'");
    expect(playgroundJs).toContain('downloadFile(viewerDoc)');
  });

  it('cả hai loại thẻ vẫn gắn nút tải đúng một lần (không nhân đôi)', () => {
    const countCalls = (source: string) =>
      (source.match(/appendDownloadAffordance\(actions, doc\)/g) ?? []).length;
    const homeRecent = sliceBetween('async function loadHomeRecent()', '// ---- Categories ----');
    expect(countCalls(homeRecent)).toBe(1);
    const fileCard = sliceBetween('function renderFileCard(doc)', 'function reloadFileResultsIfLoaded()');
    expect(countCalls(fileCard)).toBe(1);
    expect(countCalls(playgroundJs)).toBe(2);
  });

  it('đăng nhập/đăng xuất xong tải lại danh sách file để khớp quyền mới', () => {
    expect(playgroundJs).toContain('function reloadFileResultsIfLoaded()');
    expect(playgroundJs).toContain('fileSearchState.loaded > 0 && !fileSearchState.loading');
  });

  it('có style cho gợi ý liên hệ trên thẻ', () => {
    expect(playgroundCss).toContain('.download-contact-hint');
    expect(playgroundCss).toContain('.download-contact-link');
  });
});
