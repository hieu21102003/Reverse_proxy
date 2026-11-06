import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VsqiError } from '../src/errors.js';
import { parseDetailHtml } from '../src/parsers/detail.parser.js';

const fixture = readFileSync(new URL('./fixtures/standard-detail.html', import.meta.url), 'utf8');
const detailUrl = 'https://tieuchuan.vsqi.gov.vn/tieuchuan/view?sohieu=TCVN+9143%3A2022';

describe('parseDetailHtml', () => {
  it('extracts metadata from the VSQI detail page structure', () => {
    expect(parseDetailHtml(fixture, 'TCVN 9143:2022', detailUrl)).toEqual({
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
  });

  it('returns null for metadata fields absent from a valid detail page', () => {
    const html = `<table><tr><td>
      <div class="col-md-2"><strong>Số hiệu</strong></div>
      <div class="col-md-2"><strong>QCVN 16:2023/BXD</strong></div>
    </td></tr></table>`;

    expect(parseDetailHtml(html, 'QCVN 16:2023/BXD', detailUrl)).toEqual({
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
  });

  it('returns null when the detail page contains another standard code', () => {
    expect(parseDetailHtml(fixture, 'TCVN 9143:2012', detailUrl)).toBeNull();
  });

  it('rejects HTML without the expected detail metadata structure', () => {
    expect(() => parseDetailHtml('<html><body>Unavailable</body></html>', 'TCVN 9143:2022', detailUrl))
      .toThrowError(new VsqiError('VSQI detail page has an unexpected structure', 'INVALID_UPSTREAM_HTML', 502));
  });
});
