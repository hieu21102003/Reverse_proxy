import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { StandardProvider } from '../src/types.js';
import '../public/playground.js';

/**
 * Phase B2 — bấm thẻ mở viewer + deep link #doc=<id> + thông báo trạng
 * thái không có preview + kênh liên hệ cấu hình được + đổi visibility.
 * Helper thuần test không cần DOM; phần gắn DOM kiểm bằng đọc source
 * (cùng mẫu với tests/document-preview-ui.test.ts).
 */

interface FileHelpers {
  previewStateKey: (doc: unknown) => string | null;
  parseDocDeepLink: (hash: unknown) => string | null;
  docDeepLinkHash: (id: unknown) => string;
  canChangeVisibility: (user: unknown, doc: unknown) => boolean;
  visibilityErrorKey: (status: number, code: string | null) => string;
  normalizeContact: (contact: unknown) => { text: string | null; url: string | null };
}

const helpers = (globalThis as unknown as { __smartrailFileHelpers: FileHelpers }).__smartrailFileHelpers;

function docWith(overrides: Record<string, unknown> = {}, fileOverrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    title: 'Tài liệu mẫu',
    visibility: 'public',
    status: 'published',
    created_by: 'user-owner',
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

describe('parseDocDeepLink / docDeepLinkHash — deep link #doc=<id>', () => {
  it('parse đúng id, bỏ qua hash khác', () => {
    expect(helpers.parseDocDeepLink('#doc=abc-123')).toBe('abc-123');
    expect(helpers.parseDocDeepLink('#doc=a%20b')).toBe('a b');
    expect(helpers.parseDocDeepLink('#view=search&doc=x9')).toBe('x9');
    expect(helpers.parseDocDeepLink('')).toBeNull();
    expect(helpers.parseDocDeepLink('#')).toBeNull();
    expect(helpers.parseDocDeepLink('#view=home')).toBeNull();
    expect(helpers.parseDocDeepLink('#doc=')).toBeNull();
    expect(helpers.parseDocDeepLink(null)).toBeNull();
    expect(helpers.parseDocDeepLink(undefined)).toBeNull();
  });

  it('docDeepLinkHash tạo hash và roundtrip qua parse', () => {
    expect(helpers.docDeepLinkHash('abc-123')).toBe('#doc=abc-123');
    expect(helpers.parseDocDeepLink(helpers.docDeepLinkHash('a b/c'))).toBe('a b/c');
  });
});

describe('previewStateKey — thông báo rõ cho từng trạng thái không có preview', () => {
  it('ready -> null (mở viewer bình thường)', () => {
    expect(helpers.previewStateKey(docWith())).toBeNull();
  });

  it('pending/processing -> Đang chuẩn bị... thử lại sau', () => {
    for (const status of ['pending', 'processing']) {
      expect(helpers.previewStateKey(docWith({}, { preview_status: status })), status).toBe('previewPreparingLong');
    }
  });

  it('failed -> Không tạo được bản xem trước', () => {
    expect(helpers.previewStateKey(docWith({}, { preview_status: 'failed' }))).toBe('previewFailed');
  });

  it('unsupported (Office/ảnh/DWG) -> Định dạng này chưa hỗ trợ xem trước', () => {
    expect(helpers.previewStateKey(docWith({}, {
      preview_status: 'unsupported', original_filename: 'mau.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', page_count: null
    }))).toBe('previewUnsupported');
    expect(helpers.previewStateKey(docWith({}, {
      preview_status: 'unsupported', original_filename: 'anh.png', mime_type: 'image/png', page_count: null
    }))).toBe('previewUnsupported');
  });

  it('PDF 1 trang (unsupported + page_count=1) -> Tài liệu này không có bản xem trước', () => {
    expect(helpers.previewStateKey(docWith({}, { preview_status: 'unsupported', page_count: 1 }))).toBe('previewNotAvailable');
    // PDF nhiều trang mà unsupported thì vẫn là thông báo định dạng
    expect(helpers.previewStateKey(docWith({}, { preview_status: 'unsupported', page_count: 5 }))).toBe('previewUnsupported');
  });

  it('thiếu trạng thái/file -> null (cứ gọi endpoint, map lỗi theo mã)', () => {
    expect(helpers.previewStateKey(docWith({}, { preview_status: null }))).toBeNull();
    expect(helpers.previewStateKey({ id: 'x', file: null })).toBeNull();
    expect(helpers.previewStateKey(null)).toBeNull();
  });
});

describe('canChangeVisibility — chỉ admin hoặc chủ tài liệu', () => {
  const admin = { id: 'u-admin', role: 'admin' };
  const owner = { id: 'user-owner', role: 'editor' };
  const otherEditor = { id: 'u-other', role: 'editor' };
  const viewer = { id: 'u-viewer', role: 'viewer' };

  it('admin đổi được mọi tài liệu; chủ đổi được tài liệu của mình', () => {
    expect(helpers.canChangeVisibility(admin, docWith())).toBe(true);
    expect(helpers.canChangeVisibility(owner, docWith())).toBe(true);
  });

  it('editor không phải chủ / viewer / chưa đăng nhập -> không', () => {
    expect(helpers.canChangeVisibility(otherEditor, docWith())).toBe(false);
    expect(helpers.canChangeVisibility(viewer, docWith())).toBe(false);
    expect(helpers.canChangeVisibility(null, docWith())).toBe(false);
    expect(helpers.canChangeVisibility(undefined, docWith())).toBe(false);
    expect(helpers.canChangeVisibility(admin, null)).toBe(false);
  });

  it('created_by rỗng: chỉ admin', () => {
    expect(helpers.canChangeVisibility(owner, docWith({ created_by: null }))).toBe(false);
    expect(helpers.canChangeVisibility(admin, docWith({ created_by: null }))).toBe(true);
  });
});

describe('visibilityErrorKey — map mã ổn định, không parse message', () => {
  it('map đủ các trường hợp', () => {
    expect(helpers.visibilityErrorKey(400, 'INVALID_VISIBILITY')).toBe('visibilityInvalid');
    expect(helpers.visibilityErrorKey(400, null)).toBe('visibilityInvalid');
    expect(helpers.visibilityErrorKey(401, null)).toBe('visibilityLoginRequired');
    expect(helpers.visibilityErrorKey(403, null)).toBe('visibilityForbidden');
    expect(helpers.visibilityErrorKey(404, null)).toBe('visibilityNotFound');
    expect(helpers.visibilityErrorKey(500, null)).toBe('visibilityFailed');
    expect(helpers.visibilityErrorKey(0, null)).toBe('visibilityFailed');
  });
});

describe('normalizeContact — kênh liên hệ từ ui-config', () => {
  it('giữ text + URL hợp lệ, bỏ URL lạ scheme', () => {
    expect(helpers.normalizeContact({ elibContactText: '  Phòng CNTT ', elibContactUrl: 'https://congty.vn/lien-he' }))
      .toEqual({ text: 'Phòng CNTT', url: 'https://congty.vn/lien-he' });
    expect(helpers.normalizeContact({ elibContactText: '', elibContactUrl: 'mailto:hotro@congty.vn' }))
      .toEqual({ text: null, url: 'mailto:hotro@congty.vn' });
    expect(helpers.normalizeContact({ elibContactText: 'Gọi 1900', elibContactUrl: 'javascript:alert(1)' }))
      .toEqual({ text: 'Gọi 1900', url: null });
  });

  it('rỗng/thiếu -> null cả hai (chỉ hiện câu chung)', () => {
    expect(helpers.normalizeContact({})).toEqual({ text: null, url: null });
    expect(helpers.normalizeContact(null)).toEqual({ text: null, url: null });
    expect(helpers.normalizeContact(undefined)).toEqual({ text: null, url: null });
  });
});

describe('gắn DOM: bấm thẻ, deep link, ô chọn visibility, kênh liên hệ', () => {
  const playgroundJs = readFileSync(new URL('../public/playground.js', import.meta.url), 'utf8');
  const indexHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

  const sliceBetween = (start: string, end: string) => {
    const from = playgroundJs.indexOf(start);
    const to = playgroundJs.indexOf(end, from);
    expect(from, start).toBeGreaterThanOrEqual(0);
    expect(to, end).toBeGreaterThan(from);
    return playgroundJs.slice(from, to);
  };

  it('cả hai loại thẻ đều bấm để mở viewer + có ô chọn visibility + ghi nhớ doc cho deep link', () => {
    const homeRecent = sliceBetween('async function loadHomeRecent()', '// ---- Categories ----');
    expect(homeRecent).toContain('makeCardOpenPreview(row, doc)');
    expect(homeRecent).toContain('appendVisibilityControl(actions, doc)');
    expect(homeRecent).toContain('rememberDoc(doc)');

    const fileCard = sliceBetween('function renderFileCard(doc)', 'async function searchFiles');
    expect(fileCard).toContain('makeCardOpenPreview(card, doc)');
    expect(fileCard).toContain('appendVisibilityControl(actions, doc)');
    expect(playgroundJs).toContain('rememberDoc(doc); container.append(renderFileCard(doc))');
  });

  it('bấm thẻ mở viewer ở chế độ preview, không kích hoạt khi bấm nút/link/select', () => {
    const maker = sliceBetween('function makeCardOpenPreview(element, doc)', '/** Ô chọn mức hiển thị');
    expect(maker).toContain("openDocViewer(doc, 'preview')");
    expect(maker).toContain("event.target.closest('button, a, select, input, textarea, label')");
  });

  it('deep link: mở viewer đặt hash, đóng xóa hash, tải trang + hashchange tự mở', () => {
    expect(playgroundJs).toContain('setDocDeepLink(viewerDocId)');
    expect(playgroundJs).toContain('clearDocDeepLink();');
    expect(playgroundJs).toContain("window.addEventListener('hashchange'");
    expect(playgroundJs).toContain('refreshElibAuth().then(() => openDeepLinkFromHash())');
    expect(playgroundJs).toContain('openDeepLinkedDoc');
    // Deep link tới tài liệu không có quyền -> thông báo rõ + gợi ý đăng nhập
    expect(playgroundJs).toContain("options.deepLink && error?.status === 404");
    expect(playgroundJs).toContain("t('docNoAccess')");
  });

  it('viewer hiện thông báo trạng thái không có preview trước khi gọi endpoint', () => {
    const viewer = sliceBetween('async function openDocViewer(doc, mode, options = {})', 'async function loadHomeRecent()');
    expect(viewer).toContain('previewStateKey(doc)');
    expect(viewer).toContain('statusEl.textContent = t(stateKey)');
  });

  it('panel hết preview có kênh liên hệ cấu hình được; không hiển thị giá', () => {
    expect(indexHtml).toContain('id="doc-viewer-end-contact"');
    expect(playgroundJs).toContain('normalizeContact(uiConfig)');
    expect(playgroundJs).toContain("fetch('/api/v1/ui-config'");
    // Chuỗi thông báo đúng wording đã chốt
    expect(playgroundJs).toContain('Liên hệ để được cấp quyền xem toàn bộ.');
    expect(playgroundJs).toContain('Đang chuẩn bị bản xem trước, vui lòng thử lại sau.');
    expect(playgroundJs).toContain('Không tạo được bản xem trước cho tài liệu này.');
    expect(playgroundJs).toContain('Định dạng này chưa hỗ trợ xem trước.');
    expect(playgroundJs).toContain('Tài liệu này không có bản xem trước.');
    expect(playgroundJs).toContain('Bạn không có quyền xem tài liệu này.');
  });

  it('ô chọn visibility gọi PATCH qua proxy và hoàn tác khi lỗi', () => {
    const control = sliceBetween('function appendVisibilityControl(container, doc)', '// ---- Document preview / full viewer');
    expect(control).toContain("method: 'PATCH'");
    expect(control).toContain('canChangeVisibility(elibUser, doc)');
    expect(control).toContain('visibilityErrorKey(result.status');
    expect(control).toContain('doc.visibility = result.payload.document.visibility');
  });
});

describe('GET /api/v1/ui-config — kênh liên hệ công khai', () => {
  const provider: StandardProvider = {
    search: async () => ({ data: [], pagination: { currentPage: 1 }, source: 'MULTI' }),
    getDetail: async () => null
  };

  it('mặc định rỗng khi chưa cấu hình env', async () => {
    const app = await createApp(provider);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/ui-config' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ elibContactText: '', elibContactUrl: '' });
    } finally {
      await app.close();
    }
  });

  it('trả kênh liên hệ đã cấu hình', async () => {
    const app = await createApp(provider, {
      uiConfig: { elibContactText: 'Phòng CNTT', elibContactUrl: 'https://congty.vn/lien-he' }
    });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/ui-config' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ elibContactText: 'Phòng CNTT', elibContactUrl: 'https://congty.vn/lien-he' });
    } finally {
      await app.close();
    }
  });
});
