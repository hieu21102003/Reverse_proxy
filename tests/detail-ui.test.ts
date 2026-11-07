import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { StandardDetail } from '../src/types.js';
import { parseDetailHtml } from '../src/parsers/detail.parser.js';
import '../public/playground.js';

interface DetailViewModel {
  header: {
    code: string | null;
    titleVi: string | null;
    titleEn: string | null;
    status: { text: string; tone: string } | null;
    type: string | null;
    year: string | null;
  };
  general: Array<{ label: string; value: string | null; index: number }>;
  scope: Array<{ label: string; value: string | null; index: number }>;
  related: Array<{
    type: string;
    label: string;
    intro?: string;
    entries: Array<{ text: string | null; code: string | null; url: string | null; status: { text: string; tone: string } | null }>;
  }>;
  history: Array<{ code: string | null; status: string | null; note: string | null; active: boolean | null; url: string | null; text: string | null }>;
  other: Array<{ label: string; value: string | null; index: number }>;
  source: { website: string; host: string | null; url: string | null } | null;
  isEmpty: boolean;
}

const detailModel = (globalThis as unknown as {
  __vsqiDetailModel: {
    buildDetailViewModel: (data: unknown) => DetailViewModel;
    statusTone: (value: unknown) => string;
    safeWebUrl: (value: unknown) => string | null;
  };
}).__vsqiDetailModel;

const FIXTURE_CODES: Record<string, string> = {
  'tcvn-9143-2022.html': 'TCVN 9143:2022',
  'tcvn-14661-2026.html': 'TCVN 14661:2026',
  'qcvn-16-2023-bxd.html': 'QCVN 16:2023/BXD'
};

function loadFixture(file: string): StandardDetail {
  const code = FIXTURE_CODES[file];
  const html = readFileSync(new URL(`./fixtures/detail-pages/${file}`, import.meta.url), 'utf8');
  const path = code.startsWith('QCVN') ? '/quychuan/view' : '/tieuchuan/view';
  const detailUrl = `https://tieuchuan.vsqi.gov.vn${path}?sohieu=${encodeURIComponent(code)}`;
  const detail = parseDetailHtml(html, code, detailUrl);
  if (!detail) throw new Error(`Expected fixture ${file} to parse`);
  return detail;
}

function build(file: string): DetailViewModel {
  return detailModel.buildDetailViewModel(loadFixture(file));
}

function labels(items: Array<{ label: string }>): string[] {
  return items.map(item => item.label);
}

describe('Standard Detail view model', () => {
  it('renders the TCVN 9143:2022 header, general metadata, scope, relations, history, and source', () => {
    const view = build('tcvn-9143-2022.html');

    expect(view.header).toMatchObject({
      code: 'TCVN 9143:2022',
      type: 'Tiêu chuẩn quốc gia',
      year: '2022',
      status: { text: 'A - Còn hiệu lực (Active)', tone: 'active' }
    });
    expect(view.header.titleVi).toContain('Công trình thuỷ lợi');
    expect(view.header.titleEn).toContain('Hydraulic structures');

    const generalLabels = labels(view.general);
    expect(generalLabels).toEqual(expect.arrayContaining([
      'Chỉ số phân loại Quốc tế (ICS)',
      'Số trang',
      'Giá',
      'Quyết định công bố',
      'Cơ quan biên soạn'
    ]));
    expect(generalLabels).not.toContain('Số hiệu');
    expect(generalLabels).not.toContain('Tên tiếng Việt');
    expect(generalLabels).not.toContain('Tình trạng');
    expect(view.general.find(item => item.label === 'Số trang')?.value).toBe('62');
    expect(view.general.find(item => item.label === 'Giá')?.value).toContain('248,000 VNĐ');

    expect(view.scope).toHaveLength(1);
    expect(view.scope[0]).toMatchObject({ label: 'Phạm vi áp dụng' });
    expect(view.scope[0].value?.split('\n')).toHaveLength(2);
    expect(view.scope[0].value).toContain('Tiêu chuẩn này không áp dụng');

    const replaces = view.related.find(group => group.type === 'replaces');
    expect(replaces?.label).toBe('Thay thế cho');
    expect(replaces?.entries).toHaveLength(1);
    expect(replaces?.entries[0]).toMatchObject({ code: 'TCVN 9143:2012' });
    expect(replaces?.entries[0].url).toContain('tieuchuan.vsqi.gov.vn');

    const references = view.related.find(group => group.type === 'normativeReference');
    expect(references?.label).toBe('Tiêu chuẩn viện dẫn');
    expect(references?.entries).toHaveLength(13);
    expect(references?.entries.every(entry => /^https?:\/\//.test(entry.url ?? ''))).toBe(true);
    expect(references?.intro).toContain('Các tài liệu sau đây là cần thiết');
    expect(references?.entries[0].text).toContain('Nền các công trình thủy công');

    expect(view.history).toHaveLength(2);
    expect(view.history.map(entry => entry.code)).toEqual(['TCVN 9143:2012', 'TCVN 9143:2022']);
    expect(view.history.map(entry => entry.status)).toEqual(['W - Hết hiệu lực', 'A - Còn Hiệu lực']);
    expect(view.history.map(entry => entry.active)).toEqual([false, true]);
    expect(view.history[0].url).toContain('tieuchuan.vsqi.gov.vn');
    expect(view.history[1].url).toBeNull();

    expect(view.other).toEqual([]);
    expect(view.source).toMatchObject({ website: 'VSQI', host: 'tieuchuan.vsqi.gov.vn' });
    expect(view.source?.url).toContain('TCVN%209143%3A2022');
    expect(view.isEmpty).toBe(false);

    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('<b>');
    expect(serialized).not.toContain('<a ');
    expect(serialized).not.toContain('valueHtml');
  });

  it('renders the TCVN 14661:2026 contact price and seven normative references without a history section', () => {
    const view = build('tcvn-14661-2026.html');

    expect(view.header).toMatchObject({
      code: 'TCVN 14661:2026',
      type: 'Tiêu chuẩn quốc gia',
      year: '2026',
      status: { tone: 'active' }
    });
    expect(view.general.find(item => item.label === 'Giá')?.value).toBe('Liên hệ/Contact');
    expect(view.general.find(item => item.label === 'Quyết định công bố')?.value).toContain('3162/QĐ-BKHCN');

    expect(view.scope).toHaveLength(1);
    expect(view.scope[0].value?.split('\n')).toHaveLength(3);

    const references = view.related.find(group => group.type === 'normativeReference');
    expect(references?.entries).toHaveLength(7);
    expect(references?.entries.map(entry => entry.code)).toEqual([
      'TCVN 4054', 'TCVN 5729', 'TCVN 7887', 'TCVN 13080', 'TCVN 13592', 'TCVN 13757', 'TCVN 13758'
    ]);
    expect(references?.intro).toContain('Các tài liệu sau đây là cần thiết');
    expect(references?.entries[0].text).toContain('Đường ô tô');
    expect(view.history).toEqual([]);
    expect(view.other).toEqual([]);
  });

  it('renders the QCVN regulation header, general metadata, scope text, and unlinked reference text', () => {
    const view = build('qcvn-16-2023-bxd.html');

    expect(view.header).toMatchObject({
      code: 'QCVN 16:2023/BXD',
      type: 'Quy chuẩn quốc gia',
      year: '2023',
      status: { text: 'A - Còn hiệu lực', tone: 'active' }
    });
    expect(view.header.titleVi).toBe('Quy chuẩn kỹ thuật về Sản phẩm, hàng hóa vật liệu xây dựng');
    expect(view.header.titleEn).toBeNull();

    const generalLabels = labels(view.general);
    expect(generalLabels).toEqual(expect.arrayContaining([
      'Cơ quan ban hành',
      'Văn bản công bố, ban hành',
      'Ngày ban hành'
    ]));
    expect(view.general.find(item => item.label === 'Cơ quan ban hành')?.value).toBe('Bộ Xây dựng');
    expect(view.general.find(item => item.label === 'Ngày ban hành')?.value).toBe('30-06-2023');

    expect(view.scope).toHaveLength(1);
    expect(view.scope[0].label).toBe('Đối tượng áp dụng');
    expect(view.scope[0].value).toContain('Các tổ chức, cá nhân sản xuất');

    expect(view.related).toHaveLength(1);
    const references = view.related[0];
    expect(references.type).toBe('normativeReference');
    expect(references.label).toBe('Tài liệu viện dẫn');
    expect(references.entries).toHaveLength(1);
    expect(references.entries[0].code).toBeNull();
    expect(references.entries[0].url).toBeNull();
    expect(references.entries[0].text).toContain('TCVN 141:2023');
    expect(references.entries[0].text?.split('\n').length).toBeGreaterThan(20);
    expect(view.history).toEqual([]);
    expect(view.other).toEqual([]);
  });

  it('preserves duplicate and unknown attributes instead of discarding them', () => {
    const base = loadFixture('tcvn-9143-2022.html');
    const synthetic = {
      ...base,
      attributes: [
        { label: 'Số hiệu', value: 'TCVN 9999:2024' },
        { label: 'Tên tiếng Việt', value: 'Tiêu đề thử nghiệm' },
        { label: 'Tình trạng', value: 'W - Hết hiệu lực' },
        { label: 'Số trang', value: '12' },
        { label: 'Số trang', value: '13' },
        { label: 'Ghi chú', value: 'Một' },
        { label: 'Ghi chú', value: 'Hai' },
        { label: 'Trường lạ', value: null }
      ],
      relations: [],
      detailUrl: 'https://tieuchuan.vsqi.gov.vn/tieuchuan/view?sohieu=TCVN%209999%3A2024'
    };

    const view = detailModel.buildDetailViewModel(synthetic);

    expect(view.header.status).toEqual({ text: 'W - Hết hiệu lực', tone: 'withdrawn' });
    expect(view.general.filter(item => item.label === 'Số trang').map(item => item.value)).toEqual(['12', '13']);
    expect(view.other.map(item => item.label)).toEqual(['Ghi chú', 'Ghi chú', 'Trường lạ']);
    expect(view.other.map(item => item.value)).toEqual(['Một', 'Hai', null]);
    expect(view.isEmpty).toBe(false);
  });

  it('hides empty records and rejects non-web links', () => {
    const empty = detailModel.buildDetailViewModel({ attributes: [], relations: [], detailUrl: null, source: null, raw: { page: { pageType: 'unknown' } } });
    expect(empty.isEmpty).toBe(true);
    expect(empty.general).toEqual([]);
    expect(empty.related).toEqual([]);
    expect(empty.source).toBeNull();

    expect(detailModel.safeWebUrl('javascript:alert(1)')).toBeNull();
    expect(detailModel.safeWebUrl('data:text/html,test')).toBeNull();
    expect(detailModel.safeWebUrl('https://example.com/standard')).toBe('https://example.com/standard');
    expect(detailModel.safeWebUrl('http://example.com/standard')).toBe('http://example.com/standard');

    const view = detailModel.buildDetailViewModel({
      attributes: [],
      relations: [{
        type: 'replaces',
        label: 'Thay thế cho',
        labelEn: 'Replace',
        text: 'TCVN 1:2020',
        code: 'TCVN 1:2020',
        url: 'javascript:alert(1)',
        status: null,
        active: null,
        sourceAttributeIndex: -1,
        links: [],
        listItems: []
      }],
      detailUrl: 'https://example.com/standard',
      source: 'VSQI',
      raw: { page: { pageType: 'standard' } }
    });
    expect(view.related[0].entries[0].url).toBeNull();
  });

  it('maps status text to badge tones', () => {
    expect(detailModel.statusTone('A - Còn hiệu lực (Active)')).toBe('active');
    expect(detailModel.statusTone('A - Còn Hiệu lực')).toBe('active');
    expect(detailModel.statusTone('W - Hết hiệu lực')).toBe('withdrawn');
    expect(detailModel.statusTone('Withdrawn')).toBe('withdrawn');
    expect(detailModel.statusTone('Unknown')).toBe('other');
    expect(detailModel.statusTone(null)).toBe('other');
  });
});
