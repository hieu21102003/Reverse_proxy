import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import '../public/playground.js';

/**
 * Phase B (standard-pdf) — mục "File tiêu chuẩn" trên trang chi tiết:
 * helper thuần test không cần DOM; phần gắn DOM kiểm bằng đọc source
 * (cùng mẫu với tests/document-catalog-ui.test.ts).
 */

interface FileHelpers {
  canUploadStandardFile: (user: unknown) => boolean;
  standardFilesPath: (code: unknown) => string;
  standardFileState: (result: unknown) => string;
  buildStandardFileDoc: (payload: unknown) => Record<string, unknown> | null;
  codeCheckWarningKey: (file: unknown) => string | null;
  standardUploadErrorKey: (status: number, code: string | null) => string;
}

const helpers = (globalThis as unknown as { __smartrailFileHelpers: FileHelpers }).__smartrailFileHelpers;

const admin = { id: 'u-admin', role: 'admin', userType: 'internal', status: 'active' };
const internalViewer = { id: 'u-int-viewer', role: 'viewer', userType: 'internal', status: 'active' };
const internalEditor = { id: 'u-int-editor', role: 'editor', userType: 'internal', status: 'active' };
const externalEditor = { id: 'u-ext-editor', role: 'editor', userType: 'external', status: 'active' };
const externalViewer = { id: 'u-ext-viewer', role: 'viewer', userType: 'external', status: 'active' };
const disabledInternal = { id: 'u-disabled', role: 'viewer', userType: 'internal', status: 'disabled' };
const pendingInternal = { id: 'u-pending', role: 'viewer', userType: 'internal', status: 'pending' };

function filesPayload(overrides: Record<string, unknown> = {}, docOverrides: Record<string, unknown> = {}, fileOverrides: Record<string, unknown> = {}) {
  return {
    standard: { id: 'std-1', normalized_code: 'TCVN14552-1:2025', code_display: 'TCVN 14552-1:2025' },
    document: {
      id: 'doc-std-1',
      title: 'TCVN 14552-1:2025',
      visibility: 'internal',
      status: 'published',
      price: null,
      standard_id: 'std-1',
      current_file_id: 'file-v2',
      created_by: 'u-owner',
      can_view_full: true,
      can_download: false,
      ...docOverrides
    },
    current_file: {
      id: 'file-v2',
      document_id: 'doc-std-1',
      version: 2,
      version_label: 'Sửa đổi 1:2025',
      uploaded_by: 'u-owner',
      uploaded_at: '2026-11-26T00:00:00.000Z',
      original_filename: 'TCVN-14552-1-2025.pdf',
      mime_type: 'application/pdf',
      file_size: 1234567,
      page_count: 42,
      preview_pages: 9,
      preview_status: 'ready',
      code_check_status: 'found',
      ...fileOverrides
    },
    versions: [],
    ...overrides
  };
}

describe('canUploadStandardFile — admin hoặc user_type=internal đang active', () => {
  it('admin / internal viewer / internal editor được tải file chuẩn lên', () => {
    expect(helpers.canUploadStandardFile(admin)).toBe(true);
    expect(helpers.canUploadStandardFile(internalViewer)).toBe(true);
    expect(helpers.canUploadStandardFile(internalEditor)).toBe(true);
  });

  it('external (kể cả editor), disabled, pending, chưa đăng nhập -> không', () => {
    expect(helpers.canUploadStandardFile(externalEditor)).toBe(false);
    expect(helpers.canUploadStandardFile(externalViewer)).toBe(false);
    expect(helpers.canUploadStandardFile(disabledInternal)).toBe(false);
    expect(helpers.canUploadStandardFile(pendingInternal)).toBe(false);
    expect(helpers.canUploadStandardFile(null)).toBe(false);
    expect(helpers.canUploadStandardFile(undefined)).toBe(false);
    expect(helpers.canUploadStandardFile({ role: 'admin' })).toBe(false);
  });
});

describe('standardFilesPath — đường dẫn elib theo mã đang hiển thị', () => {
  it('encode mã có khoảng trắng và dấu hai chấm', () => {
    expect(helpers.standardFilesPath('TCVN 14552-1:2025')).toBe('/standards/TCVN%2014552-1%3A2025/files');
    expect(helpers.standardFilesPath('ISO 9001')).toBe('/standards/ISO%209001/files');
    expect(helpers.standardFilesPath('  TCVN 9143:2022  ')).toBe('/standards/TCVN%209143%3A2022/files');
  });
});

describe('standardFileState — trạng thái mục file tiêu chuẩn', () => {
  it('có file + can_view_full -> file-view', () => {
    expect(helpers.standardFileState({ status: 200, payload: filesPayload() })).toBe('file-view');
  });

  it('có file nhưng không can_view_full -> file-noaccess', () => {
    expect(helpers.standardFileState({ status: 200, payload: filesPayload({}, { can_view_full: false }) })).toBe('file-noaccess');
  });

  it('200 mà document=null -> no-file (chưa có file hoặc không được thấy)', () => {
    expect(helpers.standardFileState({ status: 200, payload: filesPayload({ document: null, current_file: null }) })).toBe('no-file');
  });

  it('404 NOT_FOUND (tiêu chuẩn chưa có trong DB elib) -> no-file', () => {
    expect(helpers.standardFileState({ status: 404, payload: undefined, errorCode: 'NOT_FOUND' })).toBe('no-file');
  });

  it('elib tắt/lỗi/cũ -> unavailable (ẩn mục, không hiện lỗi)', () => {
    expect(helpers.standardFileState({ status: 502, payload: undefined, errorCode: 'ELIB_UNAVAILABLE' })).toBe('unavailable');
    expect(helpers.standardFileState({ status: 503, payload: undefined, errorCode: 'ELIB_DISABLED' })).toBe('unavailable');
    expect(helpers.standardFileState({ status: null, payload: undefined, errorCode: '' })).toBe('unavailable');
    // elib cũ chưa có route: handler không khớp route trả ROUTE_NOT_FOUND
    expect(helpers.standardFileState({ status: 404, payload: undefined, errorCode: 'ROUTE_NOT_FOUND' })).toBe('unavailable');
    expect(helpers.standardFileState({ status: 404, payload: undefined, errorCode: 'ELIB_ROUTE_NOT_FOUND' })).toBe('unavailable');
    expect(helpers.standardFileState(null)).toBe('unavailable');
    expect(helpers.standardFileState(undefined)).toBe('unavailable');
    expect(helpers.standardFileState({ status: 200, payload: 'không phải object' })).toBe('unavailable');
  });
});

describe('buildStandardFileDoc — chuyển payload thành shape viewer dùng', () => {
  it('file = current_file, giữ can_view_full/can_download/created_by', () => {
    const doc = helpers.buildStandardFileDoc(filesPayload());
    expect(doc).not.toBeNull();
    expect(doc!.id).toBe('doc-std-1');
    expect(doc!.can_view_full).toBe(true);
    expect(doc!.can_download).toBe(false);
    expect(doc!.created_by).toBe('u-owner');
    expect((doc!.file as Record<string, unknown>).id).toBe('file-v2');
    expect((doc!.file as Record<string, unknown>).preview_status).toBe('ready');
  });

  it('document=null / payload lạ -> null', () => {
    expect(helpers.buildStandardFileDoc(filesPayload({ document: null }))).toBeNull();
    expect(helpers.buildStandardFileDoc(null)).toBeNull();
    expect(helpers.buildStandardFileDoc(undefined)).toBeNull();
    expect(helpers.buildStandardFileDoc({})).toBeNull();
  });

  it('thiếu can_view_full/can_download -> false (fail-closed)', () => {
    const doc = helpers.buildStandardFileDoc(filesPayload({}, { can_view_full: undefined, can_download: undefined }));
    expect(doc!.can_view_full).toBe(false);
    expect(doc!.can_download).toBe(false);
  });
});

describe('codeCheckWarningKey — chỉ not_found mới cảnh báo', () => {
  it('not_found -> khóa cảnh báo; còn lại -> null', () => {
    expect(helpers.codeCheckWarningKey({ code_check_status: 'not_found' })).toBe('codeCheckNotFound');
    expect(helpers.codeCheckWarningKey({ code_check_status: 'found' })).toBeNull();
    expect(helpers.codeCheckWarningKey({ code_check_status: 'pending' })).toBeNull();
    expect(helpers.codeCheckWarningKey({ code_check_status: 'failed' })).toBeNull();
    expect(helpers.codeCheckWarningKey({ code_check_status: null })).toBeNull();
    expect(helpers.codeCheckWarningKey(null)).toBeNull();
  });
});

describe('standardUploadErrorKey — map mã ổn định, không parse message', () => {
  it('map đủ các trường hợp', () => {
    expect(helpers.standardUploadErrorKey(400, 'STANDARD_FILE_MUST_BE_PDF')).toBe('standardFileMustPdf');
    expect(helpers.standardUploadErrorKey(400, 'INVALID_STANDARD_CODE')).toBe('standardCodeInvalid');
    expect(helpers.standardUploadErrorKey(400, 'FILE_TOO_LARGE')).toBe('standardFileTooLarge');
    expect(helpers.standardUploadErrorKey(413, null)).toBe('standardFileTooLarge');
    expect(helpers.standardUploadErrorKey(401, null)).toBe('standardUploadLoginRequired');
    expect(helpers.standardUploadErrorKey(403, null)).toBe('standardUploadForbidden');
    expect(helpers.standardUploadErrorKey(429, null)).toBe('downloadRateLimited');
    expect(helpers.standardUploadErrorKey(500, null)).toBe('standardUploadFailed');
    expect(helpers.standardUploadErrorKey(0, null)).toBe('standardUploadFailed');
  });
});

describe('gắn DOM: mục file tiêu chuẩn trên trang chi tiết', () => {
  const playgroundJs = readFileSync(new URL('../public/playground.js', import.meta.url), 'utf8');
  const indexHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

  const sliceBetween = (start: string, end: string) => {
    const from = playgroundJs.indexOf(start);
    const to = playgroundJs.indexOf(end, from);
    expect(from, start).toBeGreaterThanOrEqual(0);
    expect(to, end).toBeGreaterThan(from);
    return playgroundJs.slice(from, to);
  };

  it('index.html có mục file tiêu chuẩn + cache ?v=15', () => {
    expect(indexHtml).toContain('id="detail-standard-file-section"');
    expect(indexHtml).toContain('id="detail-standard-file-body"');
    expect(indexHtml).toContain('id="detail-nopdf-note"');
    expect(indexHtml).toContain('playground.css?v=15');
    expect(indexHtml).toContain('playground.js?v=15');
  });

  it('renderDetailResult tải mục file; refreshElibAuth tải lại khi quyền đổi', () => {
    const render = sliceBetween('function renderDetailResult(result)', 'function openPreview(data, model)');
    expect(render).toContain('void loadStandardFiles(model.header.code, model)');
    expect(playgroundJs).toContain('reloadStandardFiles();');
  });

  it('tải file qua elibFetchJson + standardFilesPath; trạng thái suy bằng standardFileState', () => {
    const loader = sliceBetween('async function loadStandardFiles(code, model, options = {})', 'function buildStandardCurrentFile');
    expect(loader).toContain('elibFetchJson(standardFilesPath(cleanCode))');
    expect(loader).toContain('standardFileState(result)');
    // elib lỗi/cũ -> ẩn mục; chưa có file + không quyền tải lên -> ẩn mục
    expect(loader).toContain("state === 'unavailable'");
    expect(loader).toContain("state === 'no-file' && !canUpload");
  });

  it('"Xem PDF" mở viewer toàn bộ; không quyền xem toàn bộ thì chỉ xem trước/thông báo', () => {
    const current = sliceBetween('function buildStandardCurrentFile(doc, state)', 'function buildStandardVersionHistory');
    expect(current).toContain("t('standardFileView')");
    expect(current).toContain("openDocViewer(doc, 'full')");
    expect(current).toContain("openDocViewer(doc, 'preview')");
    expect(current).toContain("t('docNoAccess')");
    // Nút tải chỉ khi can_download (chủ + admin), dùng lại downloadFile
    expect(current).toContain('doc.can_download === true');
    expect(current).toContain('void downloadFile(doc)');
    // Badge cảnh báo kiểm tra mã
    expect(current).toContain('codeCheckWarningKey(file)');
  });

  it('lịch sử phiên bản: đánh dấu bản hiện hành, admin đặt lại bản cũ có confirm + PATCH', () => {
    const history = sliceBetween('function buildStandardVersionHistory(doc, payload)', 'function buildStandardUploadBox(model)');
    expect(history).toContain("t('standardCurrentVersion')");
    expect(history).toContain('isAdminUser(elibUser)');
    expect(history).toContain('setStandardCurrentVersion(doc, file, btn)');
    const setter = sliceBetween('async function setStandardCurrentVersion(doc, file, btn)', 'function buildStandardUploadBox(model)');
    expect(setter).toContain("confirm(t('standardSetCurrentConfirm'))");
    expect(setter).toContain('/current-version`');
    expect(setter).toContain("method: 'PATCH'");
    expect(setter).toContain('JSON.stringify({ file_id: file.id })');
  });

  it('ô tải lên: chỉ admin/internal, PDF-only, gửi standard_code + version_label, trùng file có bỏ qua/ghi đè', () => {
    const render = sliceBetween('function renderStandardFileSection(result, model)', 'function buildStandardCurrentFile');
    expect(render).toContain('canUploadStandardFile(elibUser)');
    expect(render).toContain('buildStandardUploadBox(model)');
    const box = sliceBetween('function buildStandardUploadBox(model)', 'async function requestDetail');
    expect(box).toContain("fileInput.accept = '.pdf,application/pdf'");
    expect(box).toContain("formData.append('standard_code', code)");
    expect(box).toContain("formData.append('version_label', versionLabel)");
    expect(box).toContain("formData.append('status', 'published')");
    expect(box).toContain("xhr.open('POST', elibUrl('/documents'))");
    expect(box).toContain("code2 === 'DUPLICATE_FILE'");
    expect(box).toContain('sendStandardUpload(model, els, true)');
    expect(box).toContain('standardUploadErrorKey(xhr.status');
  });

  it('nhãn i18n VI/EN cho mục file tiêu chuẩn', () => {
    for (const key of [
      "standardFileTitle: 'File tiêu chuẩn'", "standardFileTitle: 'Standard file'",
      "standardFileView: 'Xem PDF'", "standardFileView: 'View PDF'",
      "standardFileUpload: 'Tải file tiêu chuẩn'", "standardFileUpload: 'Upload standard file'",
      "codeCheckNotFound: 'Chưa thấy mã chuẩn trong vài trang đầu'",
      "codeCheckNotFound: 'Standard code not found in the first pages'",
      "standardSetCurrent: 'Đặt làm bản hiện hành'", "standardSetCurrent: 'Set as current version'"
    ]) {
      expect(playgroundJs, key).toContain(key);
    }
  });
});
