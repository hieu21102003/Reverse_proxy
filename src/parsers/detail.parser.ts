import * as cheerio from 'cheerio';
import { VsqiError } from '../errors.js';
import type { StandardDetail } from '../types.js';

const clean = (value: string | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

function normalizeLabel(value: string): string {
  return clean(value).replace(/:$/, '').toLocaleLowerCase('vi');
}

function normalizeCode(value: string): string {
  return clean(value).replace(/\s*:\s*/, ':').toLocaleUpperCase('en');
}

function statusValue(value: string | null): string | null {
  if (!value) return null;
  const active = value.match(/\b(Active|Withdrawn|Expired)\b/i)?.[1];
  if (active) return active.toLowerCase() === 'active' ? 'Active' : 'Withdrawn';
  if (/còn hiệu lực/i.test(value)) return 'Active';
  if (/hết hiệu lực|bị thay thế/i.test(value)) return 'Withdrawn';
  return value;
}

export function parseDetailHtml(
  html: string,
  requestedCode: string,
  detailUrl: string
): StandardDetail | null {
  const $ = cheerio.load(html);

  const valueFor = (labels: string[]): string | null => {
    let value: string | null = null;
    $('table tr').each((_, element) => {
      if (value) return;

      const cell = $(element).find('td').first();
      const label = cell.find('strong, b').filter((__, node) =>
        labels.map(normalizeLabel).includes(normalizeLabel($(node).text()))
      ).first();
      if (!label.length) return;

      const labelBlock = label.parent();
      const inlineValue = clean(
        labelBlock.clone().find('strong, b, p').remove().end().text()
      );
      const valueBlock = inlineValue
        ? labelBlock
        : labelBlock.nextAll('div').first();
      if (!valueBlock.length) return;

      const links = valueBlock.find('a').map((___, link) => clean($(link).text())).get();
      value = clean(inlineValue || (links.length ? links.join(', ') : valueBlock.text())) || null;
    });
    return value;
  };

  const sourceCode = valueFor(['Số hiệu']);
  if (!sourceCode) {
    throw new VsqiError('VSQI detail page has an unexpected structure', 'INVALID_UPSTREAM_HTML', 502);
  }
  if (normalizeCode(sourceCode) !== normalizeCode(requestedCode)) return null;

  const yearText = valueFor(['Năm ban hành']);
  const yearMatch = yearText?.match(/\b\d{4}\b/);

  return {
    code: clean(sourceCode),
    name: valueFor(['Tên tiếng Việt']),
    englishName: valueFor(['Tên tiếng Anh']),
    year: yearMatch ? Number(yearMatch[0]) : null,
    status: statusValue(valueFor(['Tình trạng', 'Trạng thái'])),
    issuedDate: valueFor(['Ngày ban hành']),
    effectiveDate: valueFor(['Ngày có hiệu lực', 'Ngày hiệu lực']),
    issuingAgency: valueFor(['Cơ quan ban hành', 'Cơ quan công bố']),
    replacedBy: valueFor(['Được thay thế bởi', 'Bị thay thế bởi']),
    replaces: valueFor(['Thay thế cho']),
    detailUrl,
    source: 'VSQI'
  };
}
