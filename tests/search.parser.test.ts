import { describe, expect, it } from 'vitest';
import { parseSearchHtml } from '../src/parsers/search.parser.js';

describe('parseSearchHtml', () => {
  it('does not fabricate results when no verified result links exist', () => {
    const result = parseSearchHtml(
      '<html><body><p>No result</p><table id="list_tieu_chuan"></table></body></html>',
      1,
      'https://tieuchuan.vsqi.gov.vn'
    );
    expect(result.data).toEqual([]);
    expect(result.pagination.currentPage).toBe(1);
    expect(result.source).toBe('VSQI');
  });

  it('rejects HTML without the expected search table', () => {
    expect(() => parseSearchHtml('<html><body>Unavailable</body></html>', 1, 'https://tieuchuan.vsqi.gov.vn'))
      .toThrowError(/unexpected structure/i);
  });

  it('extracts a clearly marked standard link', () => {
    const html = `<html><body><table id="list_tieu_chuan"><tr><td class="tc-item">
      <div class="col-md-10"><div class="col-md-10">
        <h4 class="text-blue"><a href="/tieu-chuan/123">TCVN 9143:2022</a></h4>
        <p><b>Tiêu chuẩn thử nghiệm</b></p>
        <p>Test standard</p>
      </div></div>
    </td></tr></table></body></html>`;
    const result = parseSearchHtml(html, 1, 'https://tieuchuan.vsqi.gov.vn');
    expect(result.data).toHaveLength(1);
    expect(result.data[0].code).toBe('TCVN 9143:2022');
    expect(result.data[0].detailUrl).toBe('https://tieuchuan.vsqi.gov.vn/tieu-chuan/123');
  });
});
