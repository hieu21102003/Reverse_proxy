import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import type {
  DataAttribute,
  DetailList,
  DocumentLink,
  RawDetail,
  RawEmbed,
  RawForm,
  RawImage,
  RawPage,
  RawSection,
  RawTable,
  RawTableCell,
  RawTableRow
} from '../../types.js';
import { cleanMultiline, cleanText, collectLinks, collectLists, isElementNode, nodeText, sanitizeElementHtml } from './helpers.js';
import { directCells, directRows } from './extract.js';

function parseSpan(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function tableHeaders($: CheerioAPI, table: Element): string[][] {
  const headers: string[][] = [];

  for (const row of directRows($, table)) {
    const cells = directCells($, row);
    if (cells.length === 0) continue;
    if (cells.every(cell => cell.name.toLowerCase() === 'th')) {
      headers.push(cells.map(cell => cleanText(nodeText(cell))));
    }
  }

  return headers;
}

function collectRawTables(
  $: CheerioAPI,
  scope: Element,
  primaryTable: Element | null,
  detailUrl: string
): { tables: RawTable[]; byElement: Map<Element, RawTable> } {
  const tables: RawTable[] = [];
  const byElement = new Map<Element, RawTable>();

  const tableElements = $(scope).find('table').toArray().filter(isElementNode);
  for (let index = 0; index < tableElements.length; index++) {
    const element = tableElements[index];
    const $table = $(element);
    const className = cleanText($table.attr('class')) || null;

    const rows: RawTableRow[] = [];
    const rowElements = directRows($, element);
    for (let rowIndex = 0; rowIndex < rowElements.length; rowIndex++) {
      const cells: RawTableCell[] = [];
      for (const cell of directCells($, rowElements[rowIndex])) {
        const $cell = $(cell);
        const tag = cell.name.toLowerCase() === 'th' ? 'th' : 'td';
        cells.push({
          tag,
          text: cleanMultiline(nodeText(cell)),
          html: sanitizeElementHtml($, cell),
          links: collectLinks($, $cell, detailUrl),
          colspan: parseSpan($cell.attr('colspan')),
          rowspan: parseSpan($cell.attr('rowspan'))
        });
      }
      rows.push({ index: rowIndex, cells });
    }

    const rawTable: RawTable = {
      index,
      kind: element === primaryTable || className?.split(/\s+/).includes('detail-view') ? 'detail' : 'content',
      className,
      caption: cleanText($table.children('caption').first().text()) || null,
      headers: tableHeaders($, element),
      rows,
      html: sanitizeElementHtml($, element, 'outer')
    };

    tables.push(rawTable);
    byElement.set(element, rawTable);
  }

  return { tables, byElement };
}

function collectRawPage(
  $: CheerioAPI,
  scope: Element,
  code: string,
  detailUrl: string
): RawPage {
  const heading = cleanText($(scope).find('h1').first().text())
    || cleanText($('h1').first().text())
    || null;
  const title = cleanText($('title').first().text()) || null;
  const metaDescription = cleanText($('meta[name="description"]').attr('content')) || null;

  const combined = `${heading ?? ''} ${title ?? ''}`.toLocaleLowerCase('vi');
  let pageType: RawPage['pageType'] = 'unknown';
  if (combined.includes('quy chuẩn') || /^QCVN/i.test(code)) pageType = 'regulation';
  else if (combined.includes('tiêu chuẩn') || /^(TCVN|TCXD|TCN|TCCS)/i.test(code)) pageType = 'standard';

  const tabId = $(scope).find('[id^="tab_"]').first().attr('id')
    ?? $('[id^="tab_"]').first().attr('id')
    ?? '';
  const idMatch = tabId.match(/_(\d+)$/);
  const purchaseHref = $(scope)
    .find('a[href*="/tieuchuan/add-gio"], a[href*="/quychuan/add-gio"]')
    .first()
    .attr('href');
  const purchaseMatch = purchaseHref?.match(/[?&]id=(\d+)/);

  return {
    title,
    metaDescription,
    heading,
    breadcrumb: $('ul.breadcrumb li').toArray()
      .filter(isElementNode)
      .map(element => cleanText(nodeText(element)))
      .filter(Boolean),
    pageType,
    internalId: idMatch?.[1] ?? purchaseMatch?.[1] ?? null,
    barcode: cleanText($(scope).find('.ean13_font').first().text()) || null,
    purchaseUrl: purchaseHref?.trim() || null,
    detailUrl
  };
}

function collectRawSections(
  $: CheerioAPI,
  scope: Element,
  tablesByElement: Map<Element, RawTable>,
  detailUrl: string
): RawSection[] {
  const headings = $(scope).find('h1, h2, h3, h4, h5, h6').toArray().filter(isElementNode);
  const firstH1 = headings.find(heading => heading.name.toLowerCase() === 'h1') ?? null;
  const sections: RawSection[] = [];

  for (const heading of headings) {
    if (heading === firstH1) continue;
    if ($(heading).closest('.marquee, footer, nav, script, style').length > 0) continue;
    if (cleanText(nodeText(heading)).startsWith('©')) continue;

    const level = Number.parseInt(heading.name.replace(/^h/i, ''), 10);
    const wrapper = $('<div></div>');
    const contentElements: Element[] = [];
    let sibling = heading.nextSibling;

    while (sibling) {
      if (isElementNode(sibling) && /^h[1-6]$/i.test(sibling.name)) break;
      wrapper.append($(sibling).clone());
      if (isElementNode(sibling)) contentElements.push(sibling);
      sibling = sibling.nextSibling;
    }

    const wrapperElement = wrapper[0] as Element;
    const links = collectLinks($, wrapper, detailUrl);
    const lists: DetailList[] = contentElements.flatMap(element => collectLists($, $(element), detailUrl));
    const tables: RawTable[] = [];

    for (const element of contentElements) {
      const tableElements = element.name.toLowerCase() === 'table'
        ? [element]
        : $(element).find('table').toArray().filter(isElementNode);
      for (const tableElement of tableElements) {
        const table = tablesByElement.get(tableElement);
        if (table) tables.push(table);
      }
    }

    sections.push({
      heading: cleanText(nodeText(heading)) || null,
      level: Number.isFinite(level) ? level : null,
      text: cleanMultiline(nodeText(wrapperElement)),
      html: sanitizeElementHtml($, wrapperElement),
      links,
      lists,
      tables
    });
  }

  return sections;
}

function collectImages($: CheerioAPI, scope: Element): RawImage[] {
  return $(scope).find('img').toArray().filter(isElementNode).map(element => {
    const $image = $(element);
    return {
      src: $image.attr('src')?.trim() || null,
      alt: cleanText($image.attr('alt')) || null,
      title: cleanText($image.attr('title')) || null,
      width: $image.attr('width')?.trim() || null,
      height: $image.attr('height')?.trim() || null
    };
  });
}

function collectEmbeds($: CheerioAPI, scope: Element): RawEmbed[] {
  return $(scope)
    .find('iframe, embed, object')
    .toArray()
    .filter(isElementNode)
    .map(element => {
      const $embed = $(element);
      const tag = element.name.toLowerCase() as RawEmbed['tag'];
      return {
        tag,
        src: ($embed.attr('src') ?? $embed.attr('data'))?.trim() || null,
        type: cleanText($embed.attr('type')) || null
      };
    });
}

function shouldRedactField(name: string | null, type: string | null): boolean {
  const combined = `${name ?? ''} ${type ?? ''}`.toLocaleLowerCase('en');
  return /csrf|xsrf|antiforgery|token|password|passwd|session|cookie/.test(combined)
    || (type ?? '').toLocaleLowerCase('en') === 'hidden'
    || (type ?? '').toLocaleLowerCase('en') === 'password';
}

function collectForms($: CheerioAPI, scope: Element): RawForm[] {
  return $(scope).find('form').toArray().filter(isElementNode).map(form => {
    const $form = $(form);
    const fields: RawForm['fields'] = [];

    $form.find('input, textarea, select').each((_, field) => {
      if (!isElementNode(field)) return;
      const $field = $(field);
      const name = $field.attr('name')?.trim() || null;
      const type = $field.attr('type')?.trim().toLocaleLowerCase('en') || null;

      let value: string | null;
      if (field.name.toLowerCase() === 'textarea') value = cleanText($field.text()) || null;
      else if (field.name.toLowerCase() === 'select') {
        const selected = $field.find('option[selected]').first();
        value = cleanText(selected.attr('value') ?? selected.text()) || null;
      } else {
        value = $field.attr('value') ?? null;
      }

      if (value !== null && shouldRedactField(name, type)) value = '[REDACTED]';
      fields.push({ name, type, value });
    });

    return {
      action: $form.attr('action')?.trim() || null,
      method: $form.attr('method')?.trim().toLocaleLowerCase('en') || null,
      fields
    };
  });
}

function collectDataAttributes($: CheerioAPI, scope: Element): DataAttribute[] {
  const attributes: DataAttribute[] = [];
  const elements = [scope, ...$(scope).find('*').toArray()].filter(isElementNode);

  for (const element of elements) {
    for (const [name, value] of Object.entries(element.attribs)) {
      if (name.toLocaleLowerCase('en').startsWith('data-')) {
        attributes.push({
          tag: element.name.toLowerCase(),
          name,
          value
        });
      }
    }
  }

  return attributes;
}

function collectEmbeddedData($: CheerioAPI, scope: Element): unknown[] {
  const embedded: unknown[] = [];

  for (const element of $(scope).find('script').toArray()) {
    if (!isElementNode(element)) continue;
    const type = ($(element).attr('type') ?? '').toLocaleLowerCase('en');
    if (!type.includes('json')) continue;

    const text = $(element).text().trim();
    if (!text) continue;

    try {
      embedded.push(JSON.parse(text) as unknown);
    } catch {
      // A malformed embedded JSON block must not abort extraction of the page.
    }
  }

  return embedded;
}

function collectDocuments(links: RawDetail['links']): DocumentLink[] {
  const documents: DocumentLink[] = [];

  for (const link of links) {
    let kind: DocumentLink['kind'] | null = null;
    if (link.kind === 'purchase') kind = 'purchase';
    else if (link.kind === 'contact') kind = 'contact';
    else if (link.kind === 'download' || link.downloadable) kind = 'attachment';
    else if (/toàn văn|full\s*text/i.test(link.text)) kind = 'fullText';

    if (!kind) continue;

    documents.push({
      text: link.text,
      href: link.href,
      rawHref: link.rawHref,
      kind,
      downloadable: link.downloadable
    });
  }

  return documents;
}

export function collectRawDetail(
  $: CheerioAPI,
  scope: Element,
  primaryTable: Element | null,
  code: string,
  detailUrl: string
): RawDetail {
  const { tables, byElement } = collectRawTables($, scope, primaryTable, detailUrl);
  const lists = collectLists($, $(scope), detailUrl);
  const links = collectLinks($, $(scope), detailUrl);

  return {
    page: collectRawPage($, scope, code, detailUrl),
    tables,
    sections: collectRawSections($, scope, byElement, detailUrl),
    lists,
    links,
    documents: collectDocuments(links),
    images: collectImages($, scope),
    embeds: collectEmbeds($, scope),
    forms: collectForms($, scope),
    dataAttributes: collectDataAttributes($, scope),
    embeddedData: collectEmbeddedData($, scope)
  };
}
