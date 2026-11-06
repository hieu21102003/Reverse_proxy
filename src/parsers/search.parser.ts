
import * as cheerio from 'cheerio';
import { VsqiError } from '../errors.js';
import type { Standard, SearchResult } from '../types.js';

const clean = (value: string | undefined): string =>
  (value ?? '').replace(/\s+/g, ' ').trim();

function parseYear(code: string): number | undefined {
  const match = code.match(/:(\d{4})$/);
  return match ? Number(match[1]) : undefined;
}

export function parseSearchHtml(
  html: string,
  page: number,
  baseUrl: string
): SearchResult {
  const $ = cheerio.load(html);
  if ($('#list_tieu_chuan').length === 0) {
    throw new VsqiError('VSQI search page has an unexpected structure', 'INVALID_UPSTREAM_HTML', 502);
  }

  const records: Standard[] = [];

  // Actual VSQI result table
  $('#list_tieu_chuan tr').each((_, element) => {
    const row = $(element);

    const codeLink = row.find('h4.text-blue a').first();

    const code = clean(codeLink.text());
    const href = codeLink.attr('href');

    if (!code || !href) return;

    const content = row.find('td.tc-item').first();

    // Vietnamese title
    const vietnameseName = clean(
      content.find('p b').first().text()
    );

    // English title: paragraph immediately after Vietnamese title
    const paragraphs = content.find('div.col-md-10 > p');

    const englishName = clean(
      paragraphs.filter((_, p) => !$(p).find('b').length).first().text()
    );

    // VSQI marks withdrawn standards using glyphicon-ban-circle
    const statusIcon = row.find(
      '.glyphicon-ban-circle'
    ).first();

    const status = statusIcon.length
      ? 'Withdrawn'
      : 'Active';

    let detailUrl: string | undefined;

    try {
      detailUrl = new URL(href, baseUrl).toString();
    } catch {
      detailUrl = undefined;
    }

    records.push({
      code,
      name: vietnameseName || code,
      ...(englishName ? { englishName } : {}),
      ...(parseYear(code) ? { year: parseYear(code) } : {}),
      status,
      ...(detailUrl ? { detailUrl } : {}),
      source: 'VSQI'
    });
  });

  // Actual result count
  const resultText = clean(
    $('#list_tieu_chuan')
      .parent()
      .find('p')
      .first()
      .text()
  );

  const totalMatch = resultText.match(
    /Tìm thấy\s+([\d.,]+)\s+kết quả/i
  );

  const totalResults = totalMatch
    ? Number(totalMatch[1].replace(/[.,]/g, ''))
    : undefined;

  // Actual pagination text
  const bodyText = clean($('body').text());

  const pagesMatch = bodyText.match(
    /Tổng số trang:\s*(\d+)/i
  );

  const totalPages = pagesMatch
    ? Number(pagesMatch[1])
    : undefined;

  return {
    data: records,
    pagination: {
      currentPage: page,
      ...(totalPages ? { totalPages } : {}),
      ...(totalResults !== undefined ? { totalResults } : {})
    },
    source: 'VSQI'
  };
}
