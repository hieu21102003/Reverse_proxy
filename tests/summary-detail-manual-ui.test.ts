import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import '../public/playground.js';

/**
 * Trang chi tiết "tóm tắt" + form nhập/sửa metadata thủ công (admin):
 * helper thuần test không cần DOM; phần gắn DOM kiểm bằng đọc source
 * (cùng mẫu với tests/standard-pdf-ui.test.ts).
 *
 * Trường hợp chính: TCVN 14553-1:2025 chỉ có ở VSQI search, VSQI
 * detail 500, TCVN_VN/QT chưa có -> API chi tiết 404/lỗi nhưng trang
 * vẫn mở bằng dữ liệu tóm tắt của kết quả tìm kiếm.
 */

interface Helpers {
  summaryMatchesCode: (summary: unknown, code: unknown) => boolean;
  buildSummaryDetail: (summary: unknown) => Record<string, unknown> | null;
  resolveSummaryFallback: (result: unknown, summary: unknown, code: unknown) => Record<string, unknown> | null;
  adminStandardPath: (code: unknown) => string;
  canEditStandardMetadata: (user: unknown) => boolean;
  parseIcsInput: (value: unknown) => string[];
  formatIcsInput: (ics: unknown) => string;
  normalizeDateInput: (value: unknown) => string;
  buildManualPrefill: (detail: unknown, summary: unknown, stored: unknown) => Record<string, string>;
  buildManualSavePayload: (values: unknown) => Record<string, unknown>;
  manualSaveErrorKey: (status: number, code: string | null) => string;
}

interface DetailModel {
  buildDetailViewModel: (data: unknown) => {
    header: { code: string | null; titleVi: string | null; titleEn: string | null; status: { text: string; tone: string } | null; year: string | null };
    general: Array<{ label: string; value: string | null }>;
    fallbackLinks: Array<{ kind: string; url: string }>;
    isEmpty: boolean;
  };
}

const helpers = (globalThis as unknown as { __smartrailFileHelpers: Helpers }).__smartrailFileHelpers;
const detailModel = (globalThis as unknown as { __vsqiDetailModel: DetailModel }).__vsqiDetailModel;

const summary14553 = {
  code: 'TCVN 14553-1:2025',
  name: 'Đường sắt — Phần 1: Yêu cầu chung',
  englishName: 'Railways — Part 1: General requirements',
  year: 2025,
  status: 'A - Còn hiệu lực (Active)',
  source: 'VSQI',
  ics: ['45.020', '93.100']
};

const notFoundResult = { ok: false, status: 404, payload: { error: { code: 'NOT_FOUND', message: 'Standard not found' } } };
const serverErrorResult = { ok: false, status: 500, payload: { error: { code: 'UPSTREAM_ERROR', message: 'VSQI detail failed' } } };
const okResult = {
  ok: true,
  status: 200,
  payload: { data: { code: 'TCVN 14553-1:2025', name: 'Chi tiết thật', attributes: [], relations: [] } }
};

describe('buildSummaryDetail — chi tiết tổng hợp từ kết quả tìm kiếm', () => {
  it('điền trường đã biết, trường thiếu để null, đánh dấu summaryOnly', () => {
    const data = helpers.buildSummaryDetail(summary14553);
    expect(data).not.toBeNull();
    expect(data!.code).toBe('TCVN 14553-1:2025');
    expect(data!.name).toBe(summary14553.name);
    expect(data!.englishName).toBe(summary14553.englishName);
    expect(data!.year).toBe(2025);
    expect(data!.status).toBe(summary14553.status);
    expect(data!.source).toBe('VSQI');
    expect(data!.ics).toEqual(['45.020', '93.100']);
    expect(data!.issuedDate).toBeNull();
    expect(data!.effectiveDate).toBeNull();
    expect(data!.issuingAgency).toBeNull();
    expect(data!.replaces).toBeNull();
    expect(data!.replacedBy).toBeNull();
    expect(data!.summaryOnly).toBe(true);
    expect(data!.relations).toEqual([]);
  });

  it('render qua buildDetailViewModel: header đủ, ICS vào Thông tin chung, có fallback link, không rỗng', () => {
    const view = detailModel.buildDetailViewModel(helpers.buildSummaryDetail(summary14553));
    expect(view.isEmpty).toBe(false);
    expect(view.header).toMatchObject({
      code: 'TCVN 14553-1:2025',
      titleVi: summary14553.name,
      titleEn: summary14553.englishName,
      year: '2025',
      status: { tone: 'active' }
    });
    expect(view.general.find(item => item.label.includes('ICS'))?.value).toBe('45.020, 93.100');
    // Không có detailUrl công khai -> fallback ISO OBP + Google theo mã
    expect(view.fallbackLinks.map(link => link.kind)).toEqual(['iso-obp', 'google']);
  });

  it('tóm tắt thiếu ICS/năm -> không có attribute ICS, năm null', () => {
    const data = helpers.buildSummaryDetail({ code: 'TCVN 1:2024', name: 'X', source: 'TCVN_VN' });
    expect(data!.attributes).toEqual([]);
    expect(data!.year).toBeNull();
    expect(data!.ics).toEqual([]);
  });

  it('không có mã / đầu vào lạ -> null', () => {
    expect(helpers.buildSummaryDetail(null)).toBeNull();
    expect(helpers.buildSummaryDetail(undefined)).toBeNull();
    expect(helpers.buildSummaryDetail({})).toBeNull();
    expect(helpers.buildSummaryDetail({ code: '  ' })).toBeNull();
    expect(helpers.buildSummaryDetail('TCVN 1')).toBeNull();
  });
});

describe('resolveSummaryFallback — chỉ fallback khi chi tiết lỗi VÀ tóm tắt đúng mã', () => {
  it('404 + tóm tắt đúng mã -> chi tiết tổng hợp', () => {
    const data = helpers.resolveSummaryFallback(notFoundResult, summary14553, 'TCVN 14553-1:2025');
    expect(data?.code).toBe('TCVN 14553-1:2025');
    expect(data?.summaryOnly).toBe(true);
  });

  it('500 (VSQI detail lỗi) + tóm tắt đúng mã -> chi tiết tổng hợp', () => {
    expect(helpers.resolveSummaryFallback(serverErrorResult, summary14553, 'TCVN 14553-1:2025')?.code)
      .toBe('TCVN 14553-1:2025');
  });

  it('chi tiết thật dùng được -> không fallback (chi tiết thật thắng)', () => {
    expect(helpers.resolveSummaryFallback(okResult, summary14553, 'TCVN 14553-1:2025')).toBeNull();
  });

  it('không có tóm tắt (mở trực tiếp bằng liên kết/mã gõ tay) -> null, giữ hành vi lỗi cũ', () => {
    expect(helpers.resolveSummaryFallback(notFoundResult, null, 'TCVN 14553-1:2025')).toBeNull();
    expect(helpers.resolveSummaryFallback(notFoundResult, undefined, 'TCVN 14553-1:2025')).toBeNull();
  });

  it('tóm tắt của mã khác -> null (không hiện nhầm tiêu chuẩn)', () => {
    expect(helpers.resolveSummaryFallback(notFoundResult, summary14553, 'TCVN 9143:2022')).toBeNull();
    expect(helpers.summaryMatchesCode(summary14553, 'TCVN 9143:2022')).toBe(false);
    expect(helpers.summaryMatchesCode(summary14553, ' TCVN 14553-1:2025 ')).toBe(true);
    expect(helpers.summaryMatchesCode(null, 'TCVN 14553-1:2025')).toBe(false);
  });
});

describe('canEditStandardMetadata — chỉ admin', () => {
  it('admin -> true; editor/viewer/chưa đăng nhập -> false', () => {
    expect(helpers.canEditStandardMetadata({ id: 'u1', role: 'admin', status: 'active' })).toBe(true);
    expect(helpers.canEditStandardMetadata({ id: 'u2', role: 'editor', status: 'active' })).toBe(false);
    expect(helpers.canEditStandardMetadata({ id: 'u3', role: 'viewer', status: 'active' })).toBe(false);
    expect(helpers.canEditStandardMetadata(null)).toBe(false);
    expect(helpers.canEditStandardMetadata(undefined)).toBe(false);
    expect(helpers.canEditStandardMetadata({})).toBe(false);
  });
});

describe('adminStandardPath — đường dẫn elib theo mã', () => {
  it('encode mã có khoảng trắng và dấu hai chấm', () => {
    expect(helpers.adminStandardPath('TCVN 14553-1:2025')).toBe('/admin/standards/TCVN%2014553-1%3A2025');
    expect(helpers.adminStandardPath('  ISO 9001  ')).toBe('/admin/standards/ISO%209001');
  });
});

describe('parseIcsInput / formatIcsInput / normalizeDateInput', () => {
  it('tách dấu phẩy, bỏ rỗng, khử trùng giữ thứ tự', () => {
    expect(helpers.parseIcsInput('45.020, 93.100 ,45.020,, ')).toEqual(['45.020', '93.100']);
    expect(helpers.parseIcsInput('')).toEqual([]);
    expect(helpers.parseIcsInput(null)).toEqual([]);
    expect(helpers.parseIcsInput([' 91.010 ', ''])).toEqual(['91.010']);
    expect(helpers.formatIcsInput(['45.020', '93.100'])).toBe('45.020, 93.100');
    expect(helpers.formatIcsInput(undefined)).toBe('');
  });

  it('ngày: giữ YYYY-MM-DD từ timestamp, còn lại rỗng', () => {
    expect(helpers.normalizeDateInput('2025-03-01')).toBe('2025-03-01');
    expect(helpers.normalizeDateInput('2025-03-01T00:00:00.000Z')).toBe('2025-03-01');
    expect(helpers.normalizeDateInput('01/03/2025')).toBe('');
    expect(helpers.normalizeDateInput(null)).toBe('');
    expect(helpers.normalizeDateInput('')).toBe('');
  });
});

describe('buildManualPrefill — điền sẵn form nhập tay', () => {
  const detail = {
    code: 'TCVN 9143:2022',
    name: 'Công trình thủy lợi',
    englishName: 'Hydraulic structures',
    status: 'A - Còn hiệu lực (Active)',
    issuedDate: '2022-06-15',
    effectiveDate: '2023-01-01T00:00:00.000Z',
    replaces: 'TCVN 9143:2012',
    replacedBy: null,
    ics: ['93.160']
  };

  it('có chi tiết thật -> lấy từ chi tiết, ngày chuẩn hóa, ICS thành chuỗi', () => {
    expect(helpers.buildManualPrefill(detail, null, null)).toEqual({
      title_vi: 'Công trình thủy lợi',
      title_en: 'Hydraulic structures',
      status: 'A - Còn hiệu lực (Active)',
      issued_date: '2022-06-15',
      effective_date: '2023-01-01',
      replaces: 'TCVN 9143:2012',
      replaced_by: '',
      ics: '93.160'
    });
  });

  it('trang tóm tắt -> lấy từ tóm tắt, trường chưa biết để trống', () => {
    const prefill = helpers.buildManualPrefill(null, summary14553, null);
    expect(prefill.title_vi).toBe(summary14553.name);
    expect(prefill.title_en).toBe(summary14553.englishName);
    expect(prefill.status).toBe(summary14553.status);
    expect(prefill.issued_date).toBe('');
    expect(prefill.replaces).toBe('');
    expect(prefill.ics).toBe('45.020, 93.100');
  });

  it('bản ghi manual đã lưu ghi đè từng trường có giá trị, giữ phần còn lại từ tóm tắt', () => {
    const stored = {
      title_vi: 'Tên đã sửa tay',
      issued_date: '2025-02-01',
      replaces: 'TCVN 14553-1:2020',
      ics: ['45.020']
    };
    const prefill = helpers.buildManualPrefill(null, summary14553, stored);
    expect(prefill.title_vi).toBe('Tên đã sửa tay');
    expect(prefill.title_en).toBe(summary14553.englishName);
    expect(prefill.issued_date).toBe('2025-02-01');
    expect(prefill.replaces).toBe('TCVN 14553-1:2020');
    expect(prefill.ics).toBe('45.020');
  });

  it('stored bọc {standard} / khóa camelCase vẫn đọc được; không có gì -> toàn trống', () => {
    const prefill = helpers.buildManualPrefill(null, null, {
      standard: { titleVi: 'Tên bọc', effectiveDate: '2026-01-01', replacedBy: 'TCVN 9:2026' }
    });
    expect(prefill.title_vi).toBe('Tên bọc');
    expect(prefill.effective_date).toBe('2026-01-01');
    expect(prefill.replaced_by).toBe('TCVN 9:2026');
    expect(helpers.buildManualPrefill(null, null, null)).toEqual({
      title_vi: '', title_en: '', status: '', issued_date: '', effective_date: '',
      replaces: '', replaced_by: '', ics: ''
    });
  });
});

describe('buildManualSavePayload — body PUT theo hợp đồng elib', () => {
  it('cắt khoảng trắng, bỏ trường trống, ICS thành mảng', () => {
    expect(helpers.buildManualSavePayload({
      title_vi: '  Tên mới  ',
      title_en: '',
      status: 'A - Còn hiệu lực',
      issued_date: '2025-03-01',
      effective_date: '',
      replaces: 'TCVN 14553-1:2020',
      replaced_by: '   ',
      ics: '45.020, 93.100'
    })).toEqual({
      title_vi: 'Tên mới',
      status: 'A - Còn hiệu lực',
      issued_date: '2025-03-01',
      replaces: 'TCVN 14553-1:2020',
      ics: ['45.020', '93.100']
    });
  });

  it('toàn trống -> chỉ còn ics rỗng (xóa hết ICS được, không gửi null)', () => {
    expect(helpers.buildManualSavePayload({
      title_vi: '', title_en: '', status: '', issued_date: '', effective_date: '',
      replaces: '', replaced_by: '', ics: ''
    })).toEqual({ ics: [] });
    expect(helpers.buildManualSavePayload(null)).toEqual({ ics: [] });
  });

  it('ngày không đúng định dạng bị bỏ qua thay vì gửi sai', () => {
    expect(helpers.buildManualSavePayload({ issued_date: '01/03/2025', ics: [] })).toEqual({ ics: [] });
  });
});

describe('manualSaveErrorKey — map mã ổn định, không parse message', () => {
  it('map đủ các trường hợp', () => {
    expect(helpers.manualSaveErrorKey(400, 'INVALID_STANDARD_CODE')).toBe('standardCodeInvalid');
    expect(helpers.manualSaveErrorKey(401, null)).toBe('manualLoginRequired');
    expect(helpers.manualSaveErrorKey(403, null)).toBe('manualForbidden');
    expect(helpers.manualSaveErrorKey(404, null)).toBe('manualNotFound');
    expect(helpers.manualSaveErrorKey(400, null)).toBe('manualInvalid');
    expect(helpers.manualSaveErrorKey(429, null)).toBe('downloadRateLimited');
    expect(helpers.manualSaveErrorKey(500, null)).toBe('manualSaveFailed');
    expect(helpers.manualSaveErrorKey(0, null)).toBe('manualSaveFailed');
  });
});

describe('gắn DOM: trang tóm tắt + form nhập tay', () => {
  const playgroundJs = readFileSync(new URL('../public/playground.js', import.meta.url), 'utf8');
  const indexHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

  const sliceBetween = (start: string, end: string) => {
    const from = playgroundJs.indexOf(start);
    const to = playgroundJs.indexOf(end, from);
    expect(from, start).toBeGreaterThanOrEqual(0);
    expect(to, end).toBeGreaterThan(from);
    return playgroundJs.slice(from, to);
  };

  it('index.html có ghi chú tóm tắt + mục form nhập tay + cache ?v=16', () => {
    expect(indexHtml).toContain('id="detail-summary-note"');
    expect(indexHtml).toContain('id="detail-manual-section"');
    expect(indexHtml).toContain('id="detail-manual-body"');
    expect(indexHtml).toContain('playground.css?v=16');
    expect(indexHtml).toContain('playground.js?v=16');
  });

  it('bấm kết quả tìm kiếm/thư viện truyền cả record làm tóm tắt; quan hệ/lịch sử thì không', () => {
    expect(playgroundJs).toContain('openDetail(record.code, record.source, record)');
    expect(playgroundJs).toContain('openDetail(item.code, item.source, item)');
    expect(playgroundJs).toContain('function openDetail(code, source, summary)');
    // Liên kết quan hệ vẫn mở chỉ bằng mã (không có tóm tắt)
    expect(playgroundJs).toContain('openDetail(entry.code)');
  });

  it('renderDetailResult: fallback tóm tắt + ghi chú + vẫn tải File tiêu chuẩn + form nhập tay', () => {
    const render = sliceBetween('function renderDetailResult(result)', 'function openPreview(data, model)');
    expect(render).toContain('resolveSummaryFallback(result, pendingSummary, requestedCode)');
    expect(render).toContain("t('summaryNote')");
    expect(render).toContain('void loadStandardFiles(model.header.code, model)');
    expect(render).toContain('renderManualSection(model.header.code, data, isSummary)');
    // Không có tóm tắt -> giữ nguyên nhánh lỗi cũ
    expect(render).toContain("empty.querySelector('strong').textContent = result.errorMessage || t('requestFailed')");
    // Tóm tắt không được lưu như chi tiết thật: memory.detail chỉ gán ở requestDetail từ response gốc
    expect(render).not.toContain('memory.detail =');
  });

  it('requestDetail: tóm tắt chỉ gắn với đúng mã, đổi mã thì bỏ', () => {
    const request = sliceBetween('async function requestDetail(codeOverride, sourceOverride, summaryOverride)', 'function openDetail(code, source, summary)');
    expect(request).toContain('summaryMatchesCode(summaryOverride, code)');
    expect(request).toContain('pendingSummary = null');
    expect(request).toContain('memory.detail = result');
  });

  it('form nhập tay: chỉ admin, GET bản ghi đã lưu chỉ ở trang tóm tắt, PUT khi lưu + làm mới chi tiết', () => {
    const section = sliceBetween('function renderManualSection(code, data, isSummary)', 'async function requestDetail');
    expect(section).toContain('canEditStandardMetadata(elibUser)');
    expect(section).toContain('if (isSummary) void loadStoredManual(cleanCode, data, els, seq)');
    expect(section).toContain('elibFetchJson(adminStandardPath(code))');
    expect(section).toContain("method: 'PUT'");
    expect(section).toContain('buildManualSavePayload(values)');
    expect(section).toContain("showToast(t('manualSaved'))");
    expect(section).toContain('void requestDetail(code, detailSourceSelect.value)');
    // Lỗi elib hiện đọc được, không để trống
    expect(section).toContain('manualSaveErrorKey(result.status ?? 0, result.errorCode || null)');
    // Đủ 8 trường của hợp đồng
    for (const key of ['title_vi', 'title_en', 'status', 'issued_date', 'effective_date', 'replaces', 'replaced_by', 'ics']) {
      expect(section, key).toContain(`key: '${key}'`);
    }
    // Đăng nhập đổi quyền -> dựng lại form
    expect(playgroundJs).toContain('reloadManualSection();');
  });

  it('nhãn i18n VI/EN cho ghi chú tóm tắt + form nhập tay', () => {
    for (const key of [
      "summaryNote: 'Chưa tải được chi tiết từ nguồn — đang hiển thị thông tin tóm tắt'",
      "summaryNote: 'Could not load details from the source — showing summary information'",
      "manualTitle: 'Nhập / sửa metadata (admin)'", "manualTitle: 'Edit metadata (admin)'",
      "manualSave: 'Lưu metadata'", "manualSave: 'Save metadata'",
      "manualTitleVi: 'Tên tiếng Việt'", "manualTitleVi: 'Vietnamese title'",
      "manualIcs: 'Mã ICS'", "manualIcs: 'ICS codes'",
      "manualSaveFailed: 'Không lưu được metadata. Vui lòng thử lại sau.'",
      "manualSaveFailed: 'Could not save metadata. Please try again later.'"
    ]) {
      expect(playgroundJs, key).toContain(key);
    }
  });
});
