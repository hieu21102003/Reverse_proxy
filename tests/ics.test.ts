import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDetailHtml } from '../src/parsers/detail.parser.js';
import { parseSearchHtml } from '../src/parsers/search.parser.js';
import { mapTcvnDetail, mapTcvnSearchRecord } from '../src/providers/tcvn.mapper.js';

/** Top-level `ics` (Phase 3): TCVN from `ca`, VSQI detail from the ICS
 *  attribute/relations, VSQI search items empty. Attributes unchanged. */

describe('ics top-level field', () => {
  it('TCVN search record carries ics from `ca`', () => {
    const payload = JSON.parse(
      readFileSync(new URL('./fixtures/tcvn-vs-search.json', import.meta.url), 'utf8')
    ) as { data: Array<Record<string, unknown>> };
    const item = mapTcvnSearchRecord(payload.data[0] as never, 'VN', 'http://tracuu.tcvn.vn/sdomain/front-api');
    expect(item?.ics).toEqual(['93.160']);
  });

  it('TCVN detail carries ics and keeps the Mã ICS attribute', () => {
    const payload = JSON.parse(
      readFileSync(new URL('./fixtures/tcvn-vs-search.json', import.meta.url), 'utf8')
    ) as { data: Array<Record<string, unknown>> };
    const detail = mapTcvnDetail(payload.data[0], 'VN', 'http://tracuu.tcvn.vn/sdomain/front-api');
    expect(detail?.ics).toEqual(['93.160']);
    expect(detail?.attributes.some(attr => attr.label === 'Mã ICS')).toBe(true);
  });

  it('VSQI detail extracts ics from the ICS attribute/relations', () => {
    const html = readFileSync(
      new URL('./fixtures/detail-pages/tcvn-9143-2022.html', import.meta.url),
      'utf8'
    );
    const detail = parseDetailHtml(
      html,
      'TCVN 9143:2022',
      'https://tieuchuan.vsqi.gov.vn/tieuchuan/view?sohieu=TCVN%209143%3A2022'
    );
    expect(detail).not.toBeNull();
    expect(detail?.ics).toContain('93.160');
  });

  it('VSQI search items have empty ics', () => {
    const html = `<div id="list_tieu_chuan"><table><tr>
      <td><h4 class="text-blue"><a href="/tieuchuan/view?sohieu=TCVN+9143%3A2022">TCVN 9143:2022</a></h4></td>
      <td class="tc-item"><div class="col-md-10"><p><b>Công trình thủy lợi</b></p></div></td>
    </tr></table></div><p>Tìm thấy 1 kết quả</p>`;
    const result = parseSearchHtml(html, 1, 'https://tieuchuan.vsqi.gov.vn');
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.ics).toEqual([]);
  });
});
