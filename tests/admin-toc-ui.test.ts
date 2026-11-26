import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import '../public/playground.js';

interface AdminTocHelpers {
  ADMIN_TOC_MAX_NODES: number;
  ADMIN_TOC_MAX_TITLE_LENGTH: number;
  ADMIN_TOC_MAX_NOTE_LENGTH: number;
  ADMIN_TOC_DEFAULT_LIMIT: number;
  canManageAdminTocs: (user: unknown) => boolean;
  adminTocsListPath: (filters?: Record<string, unknown>, limit?: number, offset?: number) => string;
  adminFileTocPath: (fileId: unknown) => string | null;
  adminTocActionRequest: (
    action: string,
    fileId: unknown,
    payload?: unknown
  ) => { method: string; path: string; body?: string } | null;
  adminTocTotalPages: (detail: unknown) => number | null;
  canReextractToc: (detail: unknown) => boolean;
  adminTocPreviewPath: (detail: unknown) => { url: string; fallbackUrl: string; isCurrentVersion: boolean } | null;
  validateAdminTocNodes: (
    nodes: unknown,
    totalPages: number | null,
    note?: unknown
  ) => {
    ok: boolean;
    payload?: { note: string | null; nodes: Array<{ title: string; level: number; page_pdf: number }> };
    error?: { key: string; vars?: Record<string, unknown> };
  };
  adminTocMoveNode: (nodes: unknown[], index: number, delta: number) => unknown[];
  adminTocInsertNode: (nodes: unknown[], index: number, template?: Record<string, unknown>) => unknown[];
  adminTocRemoveNode: (nodes: unknown[], index: number) => unknown[];
  adminTocErrorKey: (status: number, code: string | null) => string;
  formatAdminTocError: (result: unknown, translate?: (key: string) => string) => string;
}

const helpers = (globalThis as unknown as { __smartrailFileHelpers: AdminTocHelpers }).__smartrailFileHelpers;

describe('canManageAdminTocs — chỉ admin đang hoạt động mới quản trị TOC', () => {
  it('admin active -> true; editor/viewer/disabled/pending/null -> false', () => {
    expect(helpers.canManageAdminTocs({ id: 'u1', role: 'admin', status: 'active' })).toBe(true);
    expect(helpers.canManageAdminTocs({ id: 'u1', role: 'admin' })).toBe(true);
    expect(helpers.canManageAdminTocs({ id: 'u2', role: 'editor', status: 'active', userType: 'internal' })).toBe(false);
    expect(helpers.canManageAdminTocs({ id: 'u3', role: 'viewer', status: 'active', userType: 'internal' })).toBe(false);
    expect(helpers.canManageAdminTocs({ id: 'u4', role: 'admin', status: 'disabled' })).toBe(false);
    expect(helpers.canManageAdminTocs({ id: 'u5', role: 'admin', status: 'pending' })).toBe(false);
    expect(helpers.canManageAdminTocs(null)).toBe(false);
    expect(helpers.canManageAdminTocs(undefined)).toBe(false);
    expect(helpers.canManageAdminTocs({})).toBe(false);
  });
});

describe('adminTocsListPath & adminFileTocPath — lọc và phân trang danh sách rà soát', () => {
  it('build query string đủ tham số lọc + limit/offset; outdated_algorithm chỉ gửi khi true', () => {
    const path = helpers.adminTocsListPath(
      {
        auto_status: 'partial',
        flag: 'contents_level1_only',
        job_status: 'done',
        manual_override: 'false',
        standards_only: 'true',
        outdated_algorithm: true
      },
      20,
      40
    );
    const parsed = new URL(`http://localhost${path}`);
    expect(parsed.pathname).toBe('/admin/tocs');
    expect(parsed.searchParams.get('auto_status')).toBe('partial');
    expect(parsed.searchParams.get('flag')).toBe('contents_level1_only');
    expect(parsed.searchParams.get('job_status')).toBe('done');
    expect(parsed.searchParams.get('manual_override')).toBe('false');
    expect(parsed.searchParams.get('standards_only')).toBe('true');
    expect(parsed.searchParams.get('outdated_algorithm')).toBe('true');
    expect(parsed.searchParams.get('limit')).toBe('20');
    expect(parsed.searchParams.get('offset')).toBe('40');

    const pathDefault = helpers.adminTocsListPath({ outdated_algorithm: false });
    const parsedDefault = new URL(`http://localhost${pathDefault}`);
    expect(parsedDefault.searchParams.has('outdated_algorithm')).toBe(false);
    expect(parsedDefault.searchParams.get('limit')).toBe('20');
    expect(parsedDefault.searchParams.get('offset')).toBe('0');
  });

  it('adminFileTocPath encode fileId an toàn', () => {
    expect(helpers.adminFileTocPath('file-1')).toBe('/admin/files/file-1/toc');
    expect(helpers.adminFileTocPath('')).toBeNull();
    expect(helpers.adminFileTocPath(null)).toBeNull();
  });
});

describe('adminTocActionRequest — gọi đúng route + HTTP method cho 4 thao tác', () => {
  it('lưu (PUT), gỡ (DELETE), chép (POST promote-auto), chạy lại (POST reextract)', () => {
    const saveReq = helpers.adminTocActionRequest('save', 'f1', {
      note: 'Đã rà',
      nodes: [{ title: 'Chương 1', level: 1, page_pdf: 2 }]
    });
    expect(saveReq).toEqual({
      method: 'PUT',
      path: '/admin/files/f1/toc/manual',
      body: JSON.stringify({
        note: 'Đã rà',
        nodes: [{ title: 'Chương 1', level: 1, page_pdf: 2 }]
      })
    });

    const saveEmptyReq = helpers.adminTocActionRequest('save', 'f1', { note: null, nodes: [] });
    expect(saveEmptyReq).toEqual({
      method: 'PUT',
      path: '/admin/files/f1/toc/manual',
      body: JSON.stringify({ note: null, nodes: [] })
    });

    const delReq = helpers.adminTocActionRequest('delete', 'f1');
    expect(delReq).toEqual({
      method: 'DELETE',
      path: '/admin/files/f1/toc/manual',
      body: undefined
    });

    const promoteReq = helpers.adminTocActionRequest('promote', 'f1', { activate: true });
    expect(promoteReq).toEqual({
      method: 'POST',
      path: '/admin/files/f1/toc/promote-auto',
      body: JSON.stringify({ activate: true })
    });

    const reextractReq = helpers.adminTocActionRequest('reextract', 'f1');
    expect(reextractReq).toEqual({
      method: 'POST',
      path: '/admin/files/f1/toc/reextract',
      body: '{}'
    });

    expect(helpers.adminTocActionRequest('unknown', 'f1')).toBeNull();
    expect(helpers.adminTocActionRequest('save', '')).toBeNull();
  });
});

describe('validateAdminTocNodes — kiểm tra dữ liệu chỉnh sửa phía client', () => {
  it('hợp lệ: biên 1..200 ký tự, level 1..6, page_pdf 1..totalPages và mảng rỗng nodes: []', () => {
    const ok = helpers.validateAdminTocNodes(
      [
        { title: 'A', level: 1, page_pdf: 1 },
        { title: 'B'.repeat(200), level: 6, page_pdf: 12 }
      ],
      12,
      '  Kiểm duyệt xong  '
    );
    expect(ok).toEqual({
      ok: true,
      payload: {
        note: 'Kiểm duyệt xong',
        nodes: [
          { title: 'A', level: 1, page_pdf: 1 },
          { title: 'B'.repeat(200), level: 6, page_pdf: 12 }
        ]
      }
    });

    // Cho phép lưu nodes: [] (chủ động ẩn mục lục)
    expect(helpers.validateAdminTocNodes([], 12, '')).toEqual({
      ok: true,
      payload: { note: null, nodes: [] }
    });
  });

  it('từ chối tiêu đề rỗng hoặc >200 ký tự, level ngoài 1..6, trang ngoài 1..totalPages', () => {
    expect(helpers.validateAdminTocNodes([{ title: '   ', level: 1, page_pdf: 1 }], 10)).toMatchObject({
      ok: false,
      error: { key: 'adminTocErrTitleEmpty', vars: { index: 1 } }
    });
    expect(helpers.validateAdminTocNodes([{ title: 'X'.repeat(201), level: 1, page_pdf: 1 }], 10)).toMatchObject({
      ok: false,
      error: { key: 'adminTocErrTitleTooLong', vars: { index: 1, max: 200 } }
    });
    for (const badLevel of [0, 7, 1.5, NaN, '']) {
      expect(
        helpers.validateAdminTocNodes([{ title: 'Mục 1', level: badLevel, page_pdf: 1 }], 10),
        String(badLevel)
      ).toMatchObject({ ok: false, error: { key: 'adminTocErrLevelRange', vars: { index: 1 } } });
    }
    for (const badPage of [0, -1, 1.5, NaN, '']) {
      expect(
        helpers.validateAdminTocNodes([{ title: 'Mục 1', level: 1, page_pdf: badPage }], 10),
        String(badPage)
      ).toMatchObject({ ok: false, error: { key: 'adminTocErrPageInvalid', vars: { index: 1 } } });
    }
    expect(helpers.validateAdminTocNodes([{ title: 'Mục 1', level: 1, page_pdf: 11 }], 10)).toMatchObject({
      ok: false,
      error: { key: 'adminTocErrPageRange', vars: { index: 1, page: 11, totalPages: 10 } }
    });
  });

  it('vượt quá 2000 mục hoặc ghi chú >500 ký tự -> lỗi; totalPages=null vẫn cho page_pdf >= 1 để server kiểm', () => {
    const tooMany = Array.from({ length: 2001 }, (_, idx) => ({
      title: `Mục ${idx + 1}`,
      level: 1,
      page_pdf: 1
    }));
    expect(helpers.validateAdminTocNodes(tooMany, 50)).toMatchObject({
      ok: false,
      error: { key: 'adminTocErrTooManyNodes', vars: { max: 2000 } }
    });
    expect(helpers.validateAdminTocNodes([], 10, 'N'.repeat(501))).toMatchObject({
      ok: false,
      error: { key: 'adminTocErrNoteTooLong', vars: { max: 500 } }
    });
    expect(helpers.validateAdminTocNodes([{ title: 'Mục', level: 2, page_pdf: 5 }], null).ok).toBe(true);
  });
});

describe('adminTocMoveNode / adminTocInsertNode / adminTocRemoveNode — sửa cây bất biến', () => {
  it('thêm, xóa, sắp xếp lại không làm biến đổi mảng gốc', () => {
    const base = [
      { title: 'A', level: 1, page_pdf: 1 },
      { title: 'B', level: 2, page_pdf: 3 }
    ];
    const moved = helpers.adminTocMoveNode(base, 0, 1) as Array<{ title: string }>;
    expect(moved.map(n => n.title)).toEqual(['B', 'A']);
    expect(base.map(n => n.title)).toEqual(['A', 'B']);

    const inserted = helpers.adminTocInsertNode(base, 0, { title: 'A2', level: 2, page_pdf: 2 }) as Array<{ title: string }>;
    expect(inserted.map(n => n.title)).toEqual(['A', 'A2', 'B']);

    const removed = helpers.adminTocRemoveNode(inserted, 1) as Array<{ title: string }>;
    expect(removed.map(n => n.title)).toEqual(['A', 'B']);
  });
});

describe('canReextractToc / adminTocPreviewPath / adminTocTotalPages / formatAdminTocError', () => {
  it('reextract bị vô hiệu khi job_status = processing', () => {
    expect(helpers.canReextractToc({ file_id: 'f1', job_status: 'processing' })).toBe(false);
    expect(helpers.canReextractToc({ file_id: 'f1', job_status: 'pending' })).toBe(true);
    expect(helpers.canReextractToc({ file_id: 'f1', job_status: 'done' })).toBe(true);
    expect(helpers.canReextractToc({ file_id: 'f1', job_status: 'failed' })).toBe(true);
    expect(helpers.canReextractToc(null)).toBe(false);
  });

  it('adminTocPreviewPath chỉ dùng bản hiện hành /view (kèm isCurrentVersion)', () => {
    expect(helpers.adminTocPreviewPath({ document_id: 'd1', is_current_version: true })).toEqual({
      url: '/api/elib/documents/d1/view',
      fallbackUrl: '/api/elib/documents/d1/preview',
      isCurrentVersion: true
    });
    expect(helpers.adminTocPreviewPath({ document_id: 'd1', is_current_version: false })).toEqual({
      url: '/api/elib/documents/d1/view',
      fallbackUrl: '/api/elib/documents/d1/preview',
      isCurrentVersion: false
    });
    expect(helpers.adminTocPreviewPath(null)).toBeNull();
  });

  it('adminTocTotalPages lấy page_count hoặc auto_payload.totalPages', () => {
    expect(helpers.adminTocTotalPages({ page_count: 42 })).toBe(42);
    expect(helpers.adminTocTotalPages({ page_count: null, auto_payload: { totalPages: 18 } })).toBe(18);
    expect(helpers.adminTocTotalPages({ page_count: null })).toBeNull();
  });

  it('hiển thị đúng thông báo lỗi 403 / 400 / 409 từ server hoặc fallback i18n key', () => {
    expect(
      helpers.formatAdminTocError({
        status: 403,
        errorCode: 'FORBIDDEN',
        payload: { error: { code: 'FORBIDDEN', message: 'Chỉ quản trị viên mới quản lý được mục lục tài liệu' } }
      })
    ).toBe('Chỉ quản trị viên mới quản lý được mục lục tài liệu');

    expect(
      helpers.formatAdminTocError({
        status: 400,
        errorCode: 'INVALID_PAGE_RANGE',
        payload: { error: { code: 'INVALID_PAGE_RANGE', message: 'Số trang mục #1 (99) vượt ngoài phạm vi 1..20.' } }
      })
    ).toBe('Số trang mục #1 (99) vượt ngoài phạm vi 1..20.');

    expect(
      helpers.formatAdminTocError({
        status: 409,
        errorCode: 'TOC_ALREADY_PROCESSING',
        payload: { error: { code: 'TOC_ALREADY_PROCESSING', message: 'Job đang chạy, vui lòng đợi.' } }
      })
    ).toBe('Job đang chạy, vui lòng đợi.');

    expect(helpers.formatAdminTocError({ status: 409, errorCode: null, payload: undefined })).toBe('adminTocErrProcessing');
    expect(helpers.formatAdminTocError({ status: 403, errorCode: null, payload: undefined })).toBe('adminErrForbidden');
    expect(helpers.formatAdminTocError({ status: 400, errorCode: 'INVALID_TOC_TITLE', payload: undefined })).toBe('adminTocErrInvalid');
  });
});

describe('gắn DOM & hợp đồng tĩnh P3', () => {
  const indexHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const playgroundCss = readFileSync(new URL('../public/playground.css', import.meta.url), 'utf8');
  const playgroundJs = readFileSync(new URL('../public/playground.js', import.meta.url), 'utf8');

  it('index.html có menu #nav-admin-tocs (ẩn mặc định), màn #view-admin-tocs, bộ lọc, trình sửa, khung viewer và ?v=16', () => {
    expect(indexHtml).toMatch(/id="nav-admin-tocs"[^>]*hidden/);
    for (const id of [
      'view-admin-tocs',
      'admin-tocs-banner',
      'admin-tocs-list-panel',
      'admin-tocs-filters',
      'admin-toc-filter-auto-status',
      'admin-toc-filter-job-status',
      'admin-toc-filter-flag',
      'admin-toc-filter-manual',
      'admin-toc-filter-standards',
      'admin-toc-filter-outdated',
      'admin-tocs-list',
      'admin-tocs-pagination',
      'admin-tocs-detail-panel',
      'admin-toc-back',
      'admin-toc-detail-meta',
      'admin-toc-auto-tree',
      'admin-toc-save-btn',
      'admin-toc-promote-btn',
      'admin-toc-delete-btn',
      'admin-toc-reextract-btn',
      'admin-toc-reextract-note',
      'admin-toc-editor-error',
      'admin-toc-note',
      'admin-toc-add-node-btn',
      'admin-toc-clear-nodes-btn',
      'admin-toc-editor-rows',
      'admin-toc-pdf-prev',
      'admin-toc-pdf-page-input',
      'admin-toc-pdf-next',
      'admin-toc-pdf-version-warn',
      'admin-toc-pdf-canvas'
    ]) {
      expect(indexHtml, id).toContain(`id="${id}"`);
    }
    expect(indexHtml).toContain('playground.css?v=17');
    expect(indexHtml).toContain('playground.js?v=17');
    expect(indexHtml).not.toContain('pdfjs');
  });

  it('playground.css có style workspace 2 cột, trình sửa và khung xem thử PDF', () => {
    expect(playgroundCss).toContain('.admin-toc-workspace');
    expect(playgroundCss).toContain('.admin-toc-editor-row');
    expect(playgroundCss).toContain('.admin-toc-preview-col');
  });

  it('playground.js ẩn menu với non-admin, xác nhận khi lưu rỗng/gỡ bản thủ công, nhắc reextract, không dùng innerHTML', () => {
    expect(playgroundJs).toContain('canManageAdminTocs(elibUser)');
    expect(playgroundJs).toContain("confirm(t('adminTocSaveEmptyConfirm'))");
    expect(playgroundJs).toContain("confirm(t('adminTocDeleteManualConfirm'))");
    expect(playgroundJs).toContain('canReextractToc(detail)');
    expect(playgroundJs).toContain('formatAdminTocError(result, t)');
    expect(playgroundJs).toContain("navAdminTocs: 'Quản trị mục lục'");
    expect(playgroundJs).toContain("navAdminTocs: 'TOC admin'");
    expect(playgroundJs).toContain("adminTocReextractNote: 'Lưu ý: người đọc vẫn thấy bản thủ công hiện hành");
    expect(playgroundJs).toContain("adminTocReextractNote: 'Note: readers will continue seeing the active manual TOC");

    const p3Start = playgroundJs.indexOf('// ---- Quản trị mục lục PDF (chỉ admin, P3) ----');
    const p3End = playgroundJs.indexOf('// ---- Đăng ký / đổi mật khẩu / quản trị người dùng (Giai đoạn B3) ----', p3Start);
    expect(p3Start).toBeGreaterThan(0);
    expect(p3End).toBeGreaterThan(p3Start);
    expect(playgroundJs.slice(p3Start, p3End)).not.toContain('innerHTML');
  });
});
