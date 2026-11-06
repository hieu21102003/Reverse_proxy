import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VsqiError } from '../src/errors.js';
import { parseDetailHtml } from '../src/parsers/detail.parser.js';

const fixture = readFileSync(new URL('./fixtures/standard-detail.html', import.meta.url), 'utf8');
const detailUrl = 'https://tieuchuan.vsqi.gov.vn/tieuchuan/view?sohieu=TCVN+9143%3A2022';

const FIXTURE_CODES: Record<string, string> = {
  'tcvn-14661-2026.html': 'TCVN 14661:2026',
  'tcvn-9143-2022.html': 'TCVN 9143:2022',
  'tcvn-4054-2005.html': 'TCVN 4054:2005',
  'tcvn-5574-2018.html': 'TCVN 5574:2018',
  'tcvn-9362-2012.html': 'TCVN 9362:2012',
  'tcvn-14215-2024.html': 'TCVN 14215:2024',
  'tcvn-1-1-2008.html': 'TCVN 1-1:2008',
  'tcvn-6-1985.html': 'TCVN 6:1985',
  'qcvn-16-2023-bxd.html': 'QCVN 16:2023/BXD',
  'qcvn-02-16-2012-bnnptnt.html': 'QCVN 02-16:2012/BNNPTNT',
  'synthetic-generic-detail.html': 'TCVN 9999:2024'
};

function urlFor(code: string): string {
  const path = code.startsWith('QCVN') ? '/quychuan/view' : '/tieuchuan/view';
  return `https://tieuchuan.vsqi.gov.vn${path}?sohieu=${encodeURIComponent(code)}`;
}

function parseFixture(file: string) {
  const code = FIXTURE_CODES[file];
  const html = readFileSync(new URL(`./fixtures/detail-pages/${file}`, import.meta.url), 'utf8');
  const result = parseDetailHtml(html, code, urlFor(code));
  if (!result) throw new Error(`Expected fixture ${file} to parse`);
  return result;
}

function parseInline(html: string, code: string) {
  const result = parseDetailHtml(html, code, urlFor(code));
  if (!result) throw new Error('Expected inline fixture to parse');
  return result;
}

function labels(file: string): string[] {
  return parseFixture(file).attributes.map(attribute => attribute.label);
}

describe('parseDetailHtml legacy compatibility', () => {
  it('extracts the existing metadata fields from the legacy fixture', () => {
    const result = parseDetailHtml(fixture, 'TCVN 9143:2022', detailUrl);
    expect(result).toMatchObject({
      code: 'TCVN 9143:2022',
      name: 'Công trình thuỷ lợi - Tính toán thiết kế thấm dưới đáy và vai công trình trên nền không phải là đá',
      englishName: 'Hydraulic structures - Seepage analysis through non-rock foundation and around abutments of hydraulic structures',
      year: 2022,
      status: 'Active',
      issuedDate: null,
      effectiveDate: null,
      issuingAgency: null,
      replacedBy: null,
      replaces: 'TCVN 9143:2012',
      detailUrl,
      source: 'VSQI'
    });

    expect(result?.attributes.map(attribute => attribute.label)).toEqual([
      'Số hiệu',
      'Năm ban hành',
      'Tình trạng',
      'Tên tiếng Việt',
      'Tên tiếng Anh',
      'Thay thế cho',
      'Cơ quan biên soạn'
    ]);
    expect(result?.attributes.every(attribute => attribute.source.strategy === 'vsqi-columns')).toBe(true);
    expect(result?.raw.page.pageType).toBe('standard');
  });

  it('returns null for metadata fields absent from a valid detail page', () => {
    const html = `<div class="tieuchuan-view"><table><tr><td>
      <div class="col-md-2"><strong>Số hiệu</strong></div>
      <div class="col-md-2"><strong>QCVN 16:2023/BXD</strong></div>
    </td></tr></table></div>`;

    const result = parseDetailHtml(html, 'QCVN 16:2023/BXD', detailUrl);
    expect(result).toMatchObject({
      code: 'QCVN 16:2023/BXD',
      name: null,
      englishName: null,
      year: null,
      status: null,
      issuedDate: null,
      effectiveDate: null,
      issuingAgency: null,
      replacedBy: null,
      replaces: null,
      detailUrl,
      source: 'VSQI'
    });
    expect(result?.attributes).toHaveLength(1);
    expect(result?.attributes[0].value).toBe('QCVN 16:2023/BXD');
  });

  it('returns null when the detail page contains another standard code', () => {
    expect(parseDetailHtml(fixture, 'TCVN 9143:2012', detailUrl)).toBeNull();
  });

  it('rejects HTML without the expected detail metadata structure', () => {
    expect(() => parseDetailHtml('<html><body>Unavailable</body></html>', 'TCVN 9143:2022', detailUrl))
      .toThrowError(new VsqiError('VSQI detail page has an unexpected structure', 'INVALID_UPSTREAM_HTML', 502));
  });
});

describe('parseDetailHtml TCVN fixtures', () => {
  it('extracts every attribute from TCVN 14661:2026 in DOM order', () => {
    const result = parseFixture('tcvn-14661-2026.html');

    expect(result).toMatchObject({
      code: 'TCVN 14661:2026',
      name: 'Thi công trên đường bộ đang khai thác – Tổ chức giao thông và bố trí phòng hộ',
      englishName: 'Works on Roadways – Traffic Control and Traffic Control Devices',
      year: 2026,
      status: 'Active',
      issuedDate: null,
      effectiveDate: null,
      issuingAgency: null,
      replacedBy: null,
      replaces: null
    });

    expect(labels('tcvn-14661-2026.html')).toEqual([
      'Số hiệu',
      'Năm ban hành',
      'Tình trạng',
      'Tên tiếng Việt',
      'Tên tiếng Anh',
      'Chỉ số phân loại Quốc tế (ICS)',
      'Giá',
      'Phạm vi áp dụng',
      'Tiêu chuẩn viện dẫn',
      'Quyết định công bố',
      'Cơ quan biên soạn'
    ]);
    expect(result.attributes.map(attribute => attribute.order)).toEqual(
      Array.from({ length: result.attributes.length }, (_, index) => index)
    );

    expect(result.attributes[3].labelEn).toBe('Title in Vietnamese');
    expect(result.attributes[5].value).toBe('93.080.10 - Xây dựng đường');
    expect(result.attributes[9].value).toBe('3162/QĐ-BKHCN , Ngày 17-07-2026');
    expect(result.attributes[10].value).toBe('Cục Đường bộ Việt nam - Bộ Xây dựng');

    const price = result.attributes[6];
    expect(price.value).toBe('Liên hệ/Contact');
    expect(price.links).toEqual([
      expect.objectContaining({ rawHref: 'javascript:;', href: null, kind: 'contact' })
    ]);
    expect(price.valueHtml).not.toContain('javascript:');
    expect(price.source).toMatchObject({
      strategy: 'vsqi-columns',
      table: 0,
      row: 4,
      cell: 0,
      labelColumn: 'col-md-2',
      valueColumns: ['col-md-4']
    });

    expect(result.raw.page).toMatchObject({
      pageType: 'standard',
      internalId: '46598',
      barcode: '_8*L9G3L4G0G0L0**R2R1R4R5R6R8*',
      purchaseUrl: '/tieuchuan/add-gio?id=46598'
    });
    expect(result.raw.tables).toHaveLength(1);
    expect(result.raw.tables[0].kind).toBe('detail');
    expect(result.raw.lists).toHaveLength(0);

    expect(result.relations.filter(relation => relation.type === 'normativeReference')).toHaveLength(7);
    expect(result.relations.some(relation => relation.type === 'ics' && relation.code === '93.080.10')).toBe(true);
    expect(result.relations.some(relation => relation.type === 'contact' && relation.url === null)).toBe(true);
    expect(result.relations.some(relation =>
      relation.type === 'purchase' && relation.url?.endsWith('/tieuchuan/add-gio?id=46598')
    )).toBe(true);
  });

  it('extracts the history timeline, prices, references and compilation agency from TCVN 9143:2022', () => {
    const result = parseFixture('tcvn-9143-2022.html');

    expect(result.replaces).toBe('TCVN 9143:2012');
    expect(result.replacedBy).toBeNull();
    expect(result.status).toBe('Active');

    const price = result.attributes.find(attribute => attribute.label === 'Giá');
    expect(price?.value).toBe('Bản Giấy (Paper): 248,000 VNĐ\nBản File (PDF):744,000 VNĐ');

    const history = result.attributes.find(attribute => attribute.label === 'Lịch sử soát xét');
    expect(history?.lists).toHaveLength(1);
    expect(history?.lists[0].tag).toBe('ul');
    expect(history?.lists[0].className).toBe('timeline');
    expect(history?.lists[0].items.map(item => item.history)).toEqual([
      { code: 'TCVN 9143:2012', status: 'W - Hết hiệu lực', note: null, active: false },
      { code: 'TCVN 9143:2022', status: 'A - Còn Hiệu lực', note: null, active: true }
    ]);

    const references = result.attributes.find(attribute => attribute.label === 'Tiêu chuẩn viện dẫn');
    expect(references?.links).toHaveLength(13);
    expect(references?.links.every(link => link.href?.startsWith('https://tieuchuan.vsqi.gov.vn/'))).toBe(true);
    expect(references?.links[0].kind).toBe('search');

    const scope = result.attributes.find(attribute => attribute.label === 'Phạm vi áp dụng');
    expect(scope?.value).toContain('\n');

    expect(result.attributes.find(attribute =>
      attribute.label === 'Cơ quan biên soạn' && attribute.value?.includes('Trường đại học Thuỷ lợi')
    )).toBeDefined();
    expect(result.relations.filter(relation => relation.type === 'history')).toHaveLength(2);

    const replacesAttribute = result.attributes.find(attribute => attribute.label === 'Thay thế cho');
    const replacesRelation = result.relations.find(relation => relation.type === 'replaces');
    expect(replacesAttribute?.value).toBe('TCVN 9143:2012');
    expect(replacesRelation).toMatchObject({
      code: 'TCVN 9143:2012',
      label: 'Thay thế cho',
      sourceAttributeIndex: result.attributes.indexOf(replacesAttribute!)
    });
  });

  it('maps "Thay thế bằng" and preserves cancellation metadata on TCVN 9362:2012', () => {
    const result = parseFixture('tcvn-9362-2012.html');

    expect(result.status).toBe('Withdrawn');
    expect(result.replaces).toBe('TCXD 45:1978');
    expect(result.replacedBy).toBe('TCVN 9362:2026');

    const cancellation = result.attributes.find(attribute => attribute.label === 'Quyết định Huỷ bỏ');
    expect(cancellation).toMatchObject({
      labelEn: 'Cancellation number',
      value: '4261/QĐ-BKHCN 28-10-2026'
    });
    expect(result.relations.find(relation => relation.type === 'replacedBy')).toMatchObject({
      code: 'TCVN 9362:2026',
      label: 'Thay thế bằng'
    });
  });

  it('covers the other TCVN fixtures without dropping optional fields', () => {
    const legacy = parseFixture('tcvn-4054-2005.html');
    expect(legacy.replaces).toBe('TCVN 4054:1998');
    expect(legacy.attributes.some(attribute => attribute.label === 'Lịch sử soát xét')).toBe(true);

    const equivalent = parseFixture('tcvn-5574-2018.html');
    expect(equivalent.attributes.some(attribute => attribute.label === 'Tiêu chuẩn tương đương')).toBe(true);
    expect(equivalent.relations.some(relation => relation.type === 'equivalent')).toBe(true);

    const modern = parseFixture('tcvn-14215-2024.html');
    expect(modern.year).toBe(2024);
    expect(modern.attributes.find(attribute => attribute.label === 'Số trang')?.value).toBe('18');

    const committee = parseFixture('tcvn-1-1-2008.html');
    expect(committee.replacedBy).toBe('TCVN 1-1:2015');
    expect(committee.attributes.some(attribute =>
      attribute.label === 'Ban kỹ thuật' && attribute.labelEn === 'Technical Committee'
    )).toBe(true);

    const old = parseFixture('tcvn-6-1985.html');
    expect(old.replaces).toBe('TCVN 6::1974');
    expect(old.relations.find(relation => relation.type === 'replaces')?.code).toBe('TCVN 6::1974');
    const oldHistory = old.attributes.find(attribute => attribute.label === 'Lịch sử soát xét');
    expect(oldHistory?.lists[0].items[1].history).toEqual({
      code: null,
      status: null,
      note: 'Đang có kế hoạch soát xét',
      active: false
    });
  });
});

describe('parseDetailHtml QCVN fixtures', () => {
  it('maps QCVN 16:2023/BXD labels and preserves regulation-specific attributes', () => {
    const result = parseFixture('qcvn-16-2023-bxd.html');

    expect(result).toMatchObject({
      code: 'QCVN 16:2023/BXD',
      name: 'Quy chuẩn kỹ thuật về Sản phẩm, hàng hóa vật liệu xây dựng',
      englishName: null,
      year: 2023,
      status: 'Active',
      issuedDate: '30-06-2023',
      issuingAgency: 'Bộ Xây dựng',
      replacedBy: null,
      replaces: null
    });

    expect(labels('qcvn-16-2023-bxd.html')).toEqual([
      'Số hiệu',
      'Năm công bố, ban hành',
      'Tình trạng',
      'Tên tiếng Việt',
      'Cơ quan ban hành',
      'Văn bản công bố, ban hành',
      'Ngày ban hành',
      'Đối tượng áp dụng',
      'Tài liệu viện dẫn'
    ]);

    const references = result.attributes.find(attribute => attribute.label === 'Tài liệu viện dẫn');
    expect(references?.value).toContain('TCVN 141:2023');
    expect(references?.links).toHaveLength(0);

    const relation = result.relations.find(item => item.type === 'normativeReference');
    expect(relation).toMatchObject({ url: null, code: null, text: references?.value });
    expect(result.raw.page.pageType).toBe('regulation');
  });

  it('preserves a prose "Thay thế cho" value without inventing a code for QCVN 02-16:2012/BNNPTNT', () => {
    const result = parseFixture('qcvn-02-16-2012-bnnptnt.html');

    expect(result.status).toBe('Withdrawn');
    expect(result.year).toBe(2012);
    expect(result.issuedDate).toBe('09-01-2012');
    expect(result.issuingAgency).toBe('Bộ Nông nghiệp và Phát triển nông thôn');
    expect(result.replaces).toBe('Khoản 5, khoản 6 Điều 1 Thông tư số 47/2009/TT-BNNPTNT ngày 31/7/2009');

    const relation = result.relations.find(item => item.type === 'replaces');
    expect(relation).toMatchObject({
      code: null,
      text: 'Khoản 5, khoản 6 Điều 1 Thông tư số 47/2009/TT-BNNPTNT ngày 31/7/2009'
    });
  });
});

describe('parseDetailHtml dynamic attributes and fallbacks', () => {
  it('preserves duplicate labels and uses the first non-empty value for legacy fields', () => {
    const html = `<div class="tieuchuan-view"><table><tr><td>
      <div class="col-md-2"><strong>Số hiệu</strong><p class="t-anh">Standard Number</p></div>
      <div class="col-md-2"><strong>TCVN 1111:2024</strong></div>
      <div class="col-md-2"><strong>Tên tiếng Việt</strong><p class="t-anh">Title in Vietnamese</p></div>
    </td></tr><tr><td>
      <div class="col-md-2"><strong>Tên tiếng Việt</strong><p class="t-anh">Title in Vietnamese</p></div>
      <div class="col-md-10">Tên thật</div>
      <div class="col-md-2"><strong>Tên tiếng Việt</strong><p class="t-anh">Title in Vietnamese</p></div>
      <div class="col-md-10">Tên thứ hai</div>
    </td></tr></table></div>`;

    const result = parseInline(html, 'TCVN 1111:2024');
    const duplicates = result.attributes.filter(attribute => attribute.label === 'Tên tiếng Việt');
    expect(duplicates).toHaveLength(3);
    expect(duplicates.map(attribute => attribute.value)).toEqual([null, 'Tên thật', 'Tên thứ hai']);
    expect(result.name).toBe('Tên thật');
  });

  it('ignores empty trailing columns and extracts multiple pairs from one row', () => {
    const result = parseFixture('tcvn-14661-2026.html');
    expect(result.attributes).toHaveLength(11);
    expect(result.attributes.some(attribute => attribute.label === '')).toBe(false);
    expect(result.attributes.find(attribute => attribute.label === 'Quyết định công bố')?.value)
      .toBe('3162/QĐ-BKHCN , Ngày 17-07-2026');
  });

  it('falls back to th/td table structures', () => {
    const result = parseFixture('synthetic-generic-detail.html');
    expect(result.attributes.every(attribute => attribute.source.strategy === 'table-header')).toBe(true);
    expect(result.attributes.find(attribute => attribute.label === 'Nhãn lạ')?.value).toBe('Giá trị lạ');
  });

  it('falls back to dl/dt/dd structures', () => {
    const html = `<div class="tieuchuan-view"><dl>
      <dt>Số hiệu</dt><dd>TCVN 2222:2024</dd>
      <dt>Nhãn lạ</dt><dd>Giá trị</dd>
      <dt>Trường rỗng</dt><dd></dd>
    </dl></div>`;

    const result = parseInline(html, 'TCVN 2222:2024');
    expect(result.attributes.map(attribute => attribute.label)).toEqual(['Số hiệu', 'Nhãn lạ', 'Trường rỗng']);
    expect(result.attributes.every(attribute => attribute.source.strategy === 'definition-list')).toBe(true);
    expect(result.attributes[2].value).toBeNull();
  });

  it('falls back to label elements followed by values', () => {
    const html = `<div class="tieuchuan-view">
      <div><strong>Số hiệu</strong> TCVN 3333:2024</div>
      <div><strong>Nhãn lạ</strong><span>Giá trị</span></div>
    </div>`;

    const result = parseInline(html, 'TCVN 3333:2024');
    expect(result.attributes.map(attribute => attribute.label)).toEqual(['Số hiệu', 'Nhãn lạ']);
    expect(result.attributes.every(attribute => attribute.source.strategy === 'label-element')).toBe(true);
    expect(result.code).toBe('TCVN 3333:2024');
  });

  it('falls back to colon-delimited text', () => {
    const html = `<div class="tieuchuan-view">
      <p>Số hiệu: TCVN 4444:2024</p>
      <p>Nhãn lạ: Giá trị</p>
    </div>`;

    const result = parseInline(html, 'TCVN 4444:2024');
    expect(result.attributes.map(attribute => attribute.label)).toEqual(['Số hiệu', 'Nhãn lạ']);
    expect(result.attributes.every(attribute => attribute.source.strategy === 'colon-text')).toBe(true);
    expect(result.attributes[1].value).toBe('Giá trị');
  });

  it('preserves Vietnamese labels, English labels and unknown labels', () => {
    const result = parseFixture('tcvn-1-1-2008.html');
    expect(result.attributes.find(attribute => attribute.label === 'Số hiệu')).toMatchObject({
      labelRaw: 'Số hiệu',
      labelEn: 'Standard Number',
      value: 'TCVN 1-1:2008'
    });
    expect(result.attributes.find(attribute => attribute.label === 'Chỉ số phân loại Quốc tế (ICS)')).toMatchObject({
      labelEn: 'By field',
      value: '01.120 - Tiêu chuẩn hóa. Quy tắc chung'
    });

    const synthetic = parseFixture('synthetic-generic-detail.html');
    expect(synthetic.attributes.find(attribute => attribute.label === 'Nhãn lạ')).toBeDefined();
  });
});

describe('parseDetailHtml raw extraction and sanitization', () => {
  it('captures tables, nested tables, sections, lists, links, documents, media, forms, data and JSON-LD', () => {
    const result = parseFixture('synthetic-generic-detail.html');

    expect(result.code).toBe('TCVN 9999:2024');
    expect(result.name).toBe('Tiêu chuẩn tổng hợp thử nghiệm');
    expect(result.englishName).toBe('Synthetic generic standard');

    expect(result.raw.tables).toHaveLength(2);
    expect(result.raw.tables[0]).toMatchObject({
      index: 0,
      kind: 'detail',
      caption: 'Bảng thông tin',
      className: 'table detail-meta'
    });
    expect(result.raw.tables[0].rows).toHaveLength(5);
    expect(result.raw.tables[1].className).toBe('nested');

    expect(result.raw.sections.map(section => section.heading)).toEqual([
      'Thông tin chung',
      'Tài liệu và liên kết',
      'Ghi chú'
    ]);
    expect(result.raw.sections[0].tables).toHaveLength(1);
    expect(result.raw.sections[1].lists).toHaveLength(1);

    expect(result.raw.lists).toHaveLength(1);
    expect(result.raw.lists[0]).toMatchObject({ tag: 'ul', className: 'refs' });
    expect(result.raw.lists[0].items).toHaveLength(2);
    expect(result.raw.lists[0].items[0].links[0]).toMatchObject({
      kind: 'detail',
      href: 'https://tieuchuan.vsqi.gov.vn/tieuchuan/view?sohieu=TCVN%209998%3A2023'
    });

    expect(result.raw.documents.map(document => document.kind)).toEqual([
      'purchase',
      'attachment',
      'attachment'
    ]);
    expect(result.raw.images).toEqual([
      { src: '/images/preview.png', alt: 'Ảnh xem trước', title: 'Preview', width: '120', height: '80' }
    ]);
    expect(result.raw.embeds).toEqual([
      { tag: 'iframe', src: 'https://example.com/embed', type: null },
      { tag: 'object', src: 'https://example.com/object', type: 'application/pdf' }
    ]);
    expect(result.raw.forms).toEqual([
      {
        action: '/download',
        method: 'post',
        fields: [
          { name: 'csrf-token', type: 'hidden', value: '[REDACTED]' },
          { name: 'password', type: 'password', value: '[REDACTED]' },
          { name: 'public', type: 'text', value: 'visible' }
        ]
      }
    ]);
    expect(result.raw.dataAttributes).toEqual([
      { tag: 'div', name: 'data-standard-id', value: '99999' },
      { tag: 'div', name: 'data-toggle', value: 'tab' }
    ]);
    expect(result.raw.embeddedData).toEqual([
      { '@context': 'https://schema.org', name: 'TCVN 9999:2024' }
    ]);
    expect(result.raw.page).toMatchObject({
      pageType: 'standard',
      internalId: '99999',
      barcode: 'SYNTHETIC-BARCODE',
      purchaseUrl: '/tieuchuan/add-gio?id=99999'
    });
  });

  it('sanitizes HTML fragments and never exposes scripts, event handlers, CSRF tokens or forms', () => {
    const result = parseFixture('synthetic-generic-detail.html');

    const serialized = [
      ...result.raw.tables.map(table => table.html),
      ...result.raw.sections.map(section => section.html),
      ...result.raw.lists.flatMap(list => list.items.map(item => item.html)),
      ...result.attributes.map(attribute => attribute.valueHtml ?? '')
    ].join('\n');

    expect(serialized).not.toMatch(/<script/i);
    expect(serialized).not.toMatch(/<style/i);
    expect(serialized).not.toMatch(/\son\w+\s*=/i);
    expect(serialized).not.toMatch(/javascript:/i);
    expect(serialized).not.toMatch(/<form/i);
    expect(serialized).not.toMatch(/csrf|SUPER_SECRET|META_SECRET|OUTSIDE_FORM_SECRET/i);
    expect(serialized).not.toContain('alert(');

    const javascriptLink = result.raw.links.find(link => link.rawHref.startsWith('javascript:'));
    expect(javascriptLink).toMatchObject({ rawHref: "javascript:alert('bad')", href: null, kind: 'other' });
  });

  it('keeps raw data separate from normalized legacy data', () => {
    const result = parseFixture('tcvn-9362-2012.html');
    expect(result.status).toBe('Withdrawn');
    expect(result.attributes.find(attribute => attribute.label === 'Tình trạng')?.value)
      .toBe('W - Hết hiệu lực (Withdraw)');
    expect(result.raw.page.detailUrl).toContain('TCVN%209362%3A2012');
  });
});
