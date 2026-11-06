import type { CheerioAPI } from 'cheerio';
import type { Element, ParentNode } from 'domhandler';
import type {
  AttributeSourceStrategy,
  DetailAttribute,
  DetailLink,
  DetailList
} from '../../types.js';
import {
  cleanMultiline,
  cleanText,
  collectLinks,
  collectLists,
  cssPath,
  isElementNode,
  isPunctuationOnly,
  nodeText,
  sanitizeElementHtml
} from './helpers.js';

interface PendingLabel {
  label: string;
  labelRaw: string;
  labelEn: string | null;
  labelElement: Element;
  labelColumn: string | null;
}

interface ExtractedValue {
  text: string | null;
  html: string | null;
  links: DetailLink[];
  lists: DetailList[];
}

interface LabelCandidate extends PendingLabel {
  inlineValue: ExtractedValue;
  highConfidence: boolean;
}

export interface AttributeExtraction {
  attributes: DetailAttribute[];
  primaryTable: Element | null;
  primaryTableIndex: number | null;
}

export function findDetailContainer($: CheerioAPI): Element | null {
  for (const selector of ['div.tieuchuan-view', 'div.quychuan-view', '#main', 'main']) {
    const candidate = $(selector).first();
    if (candidate.length > 0 && isElementNode(candidate[0])) return candidate[0];
  }

  const body = $('body').first();
  return body.length > 0 && isElementNode(body[0]) ? body[0] : null;
}

export function directRows($: CheerioAPI, table: Element): Element[] {
  return $(table)
    .find('tr')
    .toArray()
    .filter((node): node is Element => isElementNode(node) && $(node).closest('table')[0] === table);
}

export function directCells($: CheerioAPI, row: Element): Element[] {
  return $(row).children('td, th').toArray().filter(isElementNode);
}

export function directColumns($: CheerioAPI, cell: Element): Element[] {
  return $(cell).children('div[class*="col-"]').toArray().filter(isElementNode);
}

function className($: CheerioAPI, element: Element): string | null {
  return cleanText($(element).attr('class')) || null;
}

function scoreTable($: CheerioAPI, table: Element): number {
  let score = 0;
  for (const row of directRows($, table)) {
    const cells = directCells($, row);
    const headerCells = cells.filter(cell => cell.name.toLowerCase() === 'th').length;
    const dataCells = cells.filter(cell => cell.name.toLowerCase() === 'td').length;

    if (headerCells > 0 && dataCells > 0) score += headerCells * 3;
    if (dataCells >= 2) score += 1;

    for (const cell of cells) score += directColumns($, cell).length;
  }
  return score;
}

export function findPrimaryTable($: CheerioAPI, scope: Element): Element | null {
  const detailTable = $(scope).find('table.detail-view').first();
  if (detailTable.length > 0 && isElementNode(detailTable[0])) return detailTable[0];

  let best: Element | null = null;
  let bestScore = 0;

  for (const candidate of $(scope).find('table').toArray()) {
    if (!isElementNode(candidate)) continue;
    const score = scoreTable($, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function isEmptyColumn($: CheerioAPI, column: Element): boolean {
  const text = cleanMultiline(nodeText(column));
  if (text !== '') return false;
  return $(column).find('a[href], ul, ol, table, img, iframe, object, embed, form').length === 0;
}

function extractValue($: CheerioAPI, element: Element, detailUrl: string): ExtractedValue {
  const rawText = cleanMultiline(nodeText(element));
  const text = isPunctuationOnly(rawText) ? null : rawText;
  return {
    text,
    html: text === null ? null : sanitizeElementHtml($, element),
    links: collectLinks($, $(element), detailUrl),
    lists: collectLists($, $(element), detailUrl)
  };
}

function extractInlineValue($: CheerioAPI, column: Element, detailUrl: string): ExtractedValue {
  const $clone = $(column).clone();
  $clone.find('strong, b').first().remove();
  $clone.find('p.t-anh').remove();

  if ($clone.length === 0 || !isElementNode($clone[0])) {
    return { text: null, html: null, links: [], lists: [] };
  }

  const rawText = cleanMultiline(nodeText($clone[0]));
  const text = isPunctuationOnly(rawText) ? null : rawText;

  return {
    text,
    html: text === null ? null : sanitizeElementHtml($, $clone[0]),
    links: collectLinks($, $clone, detailUrl),
    lists: collectLists($, $clone, detailUrl)
  };
}

function parseLabelColumn(
  $: CheerioAPI,
  column: Element,
  detailUrl: string
): LabelCandidate | null {
  const $column = $(column);
  const englishLabel = cleanText($column.find('p.t-anh').first().text()) || null;
  const highConfidence = $column.find('p.t-anh').length > 0;

  const labelElement = $column.find('strong, b').first();
  if (labelElement.length === 0 || !isElementNode(labelElement[0])) {
    if (!highConfidence) return null;

    const $clone = $column.clone();
    $clone.find('p.t-anh').remove();
    if ($clone.length === 0 || !isElementNode($clone[0])) return null;
    const labelRaw = cleanText(nodeText($clone[0]));
    const label = labelRaw.replace(/:+\s*$/, '').trim();
    if (!label) return null;

    return {
      label,
      labelRaw,
      labelEn: englishLabel,
      labelElement: column,
      labelColumn: className($, column),
      inlineValue: { text: null, html: null, links: [], lists: [] },
      highConfidence
    };
  }

  const rawLabelText = cleanText(nodeText(labelElement[0]));
  const label = rawLabelText.replace(/:+\s*$/, '').trim();
  if (!label) return null;

  const $clone = $column.clone();
  $clone.find('strong, b').first().remove();
  $clone.find('p.t-anh').remove();

  let inlineText = '';
  if ($clone.length > 0 && isElementNode($clone[0])) {
    inlineText = cleanMultiline(nodeText($clone[0]));
  }

  const inlineValue = extractInlineValue($, column, detailUrl);
  if (!highConfidence && inlineValue.text !== null) return null;

  const colonRemainder = inlineText.trim().startsWith(':') || inlineText.trim().startsWith('：');
  const labelRaw = /:\s*$/.test(rawLabelText) || colonRemainder
    ? `${label}:`
    : label;

  return {
    label,
    labelRaw,
    labelEn: englishLabel,
    labelElement: labelElement[0],
    labelColumn: className($, column),
    inlineValue,
    highConfidence
  };
}

function makeAttribute(
  $: CheerioAPI,
  scope: Element,
  details: {
    order: number;
    strategy: AttributeSourceStrategy;
    table: number | null;
    row: number | null;
    cell: number | null;
    label: string;
    labelRaw: string;
    labelEn: string | null;
    labelColumn: string | null;
    valueColumns: string[];
    value: ExtractedValue;
    selectorElement: Element | null;
  }
): DetailAttribute {
  return {
    order: details.order,
    label: details.label,
    labelRaw: details.labelRaw,
    labelEn: details.labelEn,
    value: details.value.text,
    valueHtml: details.value.html,
    links: details.value.links,
    lists: details.value.lists,
    source: {
      strategy: details.strategy,
      table: details.table,
      row: details.row,
      cell: details.cell,
      labelColumn: details.labelColumn,
      valueColumns: details.valueColumns,
      selector: details.selectorElement ? cssPath($, details.selectorElement, scope) : null
    }
  };
}

function extractVsqiColumns(
  $: CheerioAPI,
  scope: Element,
  table: Element,
  tableIndex: number | null,
  detailUrl: string
): DetailAttribute[] {
  const attributes: DetailAttribute[] = [];
  const rows = directRows($, table);

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const cells = directCells($, rows[rowIndex]);

    for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
      const columns = directColumns($, cells[cellIndex]);
      if (columns.length === 0) continue;

      let pending: PendingLabel | null = null;

      for (const column of columns) {
        const empty = isEmptyColumn($, column);
        if (pending && empty) continue;

        const candidate = empty ? null : parseLabelColumn($, column, detailUrl);

        if (pending && !(candidate && candidate.highConfidence)) {
          const value = extractValue($, column, detailUrl);
          const valueColumns = className($, column) ? [className($, column) as string] : [];
          attributes.push(makeAttribute($, scope, {
            order: attributes.length,
            strategy: 'vsqi-columns',
            table: tableIndex,
            row: rowIndex,
            cell: cellIndex,
            label: pending.label,
            labelRaw: pending.labelRaw,
            labelEn: pending.labelEn,
            labelColumn: pending.labelColumn,
            valueColumns,
            value,
            selectorElement: column
          }));
          pending = null;
          continue;
        }

        if (pending && candidate && candidate.highConfidence) {
          attributes.push(makeAttribute($, scope, {
            order: attributes.length,
            strategy: 'vsqi-columns',
            table: tableIndex,
            row: rowIndex,
            cell: cellIndex,
            label: pending.label,
            labelRaw: pending.labelRaw,
            labelEn: pending.labelEn,
            labelColumn: pending.labelColumn,
            valueColumns: [],
            value: { text: null, html: null, links: [], lists: [] },
            selectorElement: pending.labelElement
          }));
          pending = null;
        }

        if (!candidate) continue;

        if (candidate.inlineValue.text !== null) {
          const labelColumn = className($, column);
          attributes.push(makeAttribute($, scope, {
            order: attributes.length,
            strategy: 'vsqi-columns',
            table: tableIndex,
            row: rowIndex,
            cell: cellIndex,
            label: candidate.label,
            labelRaw: candidate.labelRaw,
            labelEn: candidate.labelEn,
            labelColumn,
            valueColumns: labelColumn ? [labelColumn] : [],
            value: candidate.inlineValue,
            selectorElement: column
          }));
        } else {
          pending = {
            label: candidate.label,
            labelRaw: candidate.labelRaw,
            labelEn: candidate.labelEn,
            labelElement: candidate.labelElement,
            labelColumn: candidate.labelColumn
          };
        }
      }

      if (pending) {
        attributes.push(makeAttribute($, scope, {
          order: attributes.length,
          strategy: 'vsqi-columns',
          table: tableIndex,
          row: rowIndex,
          cell: cellIndex,
          label: pending.label,
          labelRaw: pending.labelRaw,
          labelEn: pending.labelEn,
          labelColumn: pending.labelColumn,
          valueColumns: [],
          value: { text: null, html: null, links: [], lists: [] },
          selectorElement: pending.labelElement
        }));
      }
    }
  }

  return attributes;
}

function extractTableHeaderAttributes(
  $: CheerioAPI,
  scope: Element,
  table: Element | null,
  tableIndex: number | null,
  detailUrl: string
): DetailAttribute[] {
  if (!table) return [];
  const attributes: DetailAttribute[] = [];
  const rows = directRows($, table);

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const cells = directCells($, rows[rowIndex]);
    const hasDataCell = cells.some(cell => cell.name.toLowerCase() === 'td');
    if (!hasDataCell) continue;

    let index = 0;
    while (index < cells.length) {
      if (cells[index].name.toLowerCase() !== 'th') {
        index += 1;
        continue;
      }

      const labelCell = cells[index];
      const valueCells: Element[] = [];
      let next = index + 1;
      while (next < cells.length && cells[next].name.toLowerCase() !== 'th') {
        if (cells[next].name.toLowerCase() === 'td') valueCells.push(cells[next]);
        next += 1;
      }

      if (valueCells.length > 0) {
        const labelRaw = cleanText(nodeText(labelCell));
        const label = labelRaw.replace(/:+\s*$/, '').trim();
        if (label) {
          const text = cleanMultiline(valueCells.map(cell => nodeText(cell)).join('\n'));
          const valueText = isPunctuationOnly(text) ? null : text;
          const links = valueCells.flatMap(cell => collectLinks($, $(cell), detailUrl));
          const lists = valueCells.flatMap(cell => collectLists($, $(cell), detailUrl));
          const html = valueText === null
            ? null
            : valueCells.map(cell => sanitizeElementHtml($, cell)).join('');
          const valueColumns = valueCells
            .map(cell => className($, cell))
            .filter((value): value is string => value !== null);

          attributes.push(makeAttribute($, scope, {
            order: attributes.length,
            strategy: 'table-header',
            table: tableIndex,
            row: rowIndex,
            cell: index,
            label,
            labelRaw,
            labelEn: null,
            labelColumn: className($, labelCell),
            valueColumns,
            value: { text: valueText, html, links, lists },
            selectorElement: valueCells[0]
          }));
        }
      }

      index = next;
    }
  }

  return attributes;
}

function hasConsumedAncestor($: CheerioAPI, element: Element, consumed: Set<Element>): boolean {
  let node: Element | null = element;
  while (node) {
    if (consumed.has(node)) return true;
    const parent: ParentNode | null = node.parent;
    node = parent && isElementNode(parent) ? parent : null;
  }
  return false;
}

function followingSiblingsWrapper(
  $: CheerioAPI,
  element: Element,
  detailUrl: string
): { text: string; html: string; links: DetailLink[]; lists: DetailList[]; elements: Element[] } {
  const wrapper = $('<div></div>');
  const elements: Element[] = [];
  let sibling = element.nextSibling;

  while (sibling) {
    wrapper.append($(sibling).clone());
    if (isElementNode(sibling)) elements.push(sibling);
    sibling = sibling.nextSibling;
  }

  const wrapperElement = wrapper[0] as Element;
  const text = cleanMultiline(nodeText(wrapperElement));
  return {
    text,
    html: sanitizeElementHtml($, wrapperElement),
    links: collectLinks($, wrapper, detailUrl),
    lists: collectLists($, wrapper, detailUrl),
    elements
  };
}

function elementValue(
  $: CheerioAPI,
  element: Element,
  detailUrl: string
): { text: string; html: string; links: DetailLink[]; lists: DetailList[] } {
  return {
    text: cleanMultiline(nodeText(element)),
    html: sanitizeElementHtml($, element),
    links: collectLinks($, $(element), detailUrl),
    lists: collectLists($, $(element), detailUrl)
  };
}

function extractDefinitionListAttributes(
  $: CheerioAPI,
  scope: Element,
  detailUrl: string
): DetailAttribute[] {
  const attributes: DetailAttribute[] = [];

  for (const term of $(scope).find('dt').toArray()) {
    if (!isElementNode(term)) continue;
    const labelRaw = cleanText(nodeText(term));
    const label = labelRaw.replace(/:+\s*$/, '').trim();
    if (!label) continue;

    const valueElements: Element[] = [];
    let sibling = term.nextSibling;
    while (sibling) {
      if (isElementNode(sibling) && sibling.name.toLowerCase() === 'dt') break;
      if (isElementNode(sibling) && sibling.name.toLowerCase() === 'dd') valueElements.push(sibling);
      sibling = sibling.nextSibling;
    }

    const text = cleanMultiline(valueElements.map(element => nodeText(element)).join('\n'));
    const valueText = isPunctuationOnly(text) ? null : text;
    const links = valueElements.flatMap(element => collectLinks($, $(element), detailUrl));
    const lists = valueElements.flatMap(element => collectLists($, $(element), detailUrl));
    const html = valueText === null
      ? null
      : valueElements.map(element => sanitizeElementHtml($, element)).join('');

    attributes.push(makeAttribute($, scope, {
      order: attributes.length,
      strategy: 'definition-list',
      table: null,
      row: null,
      cell: null,
      label,
      labelRaw,
      labelEn: null,
      labelColumn: null,
      valueColumns: [],
      value: { text: valueText, html, links, lists },
      selectorElement: valueElements[0] ?? term
    }));
  }

  return attributes;
}

function extractLabelElementAttributes(
  $: CheerioAPI,
  scope: Element,
  detailUrl: string
): DetailAttribute[] {
  const attributes: DetailAttribute[] = [];
  const consumed = new Set<Element>();
  const candidates = $(scope)
    .find('.label, .field-label, .control-label, label, strong, b')
    .toArray()
    .filter(isElementNode);

  for (const element of candidates) {
    if (hasConsumedAncestor($, element, consumed)) continue;
    if ($(element).closest('form, script, style').length > 0) continue;

    const labelRaw = cleanText(nodeText(element));
    const label = labelRaw.replace(/:+\s*$/, '').trim();
    if (!label) continue;

    const $parent = $(element).parent();
    const following = followingSiblingsWrapper($, element, detailUrl);
    let valueText = following.text;
    let valueHtml = following.html;
    let valueLinks = following.links;
    let valueLists = following.lists;
    let valueElement: Element | null = following.elements[0] ?? null;

    for (const sibling of following.elements) consumed.add(sibling);

    if (!valueText) {
      const $next = $parent.next();
      if ($next.length > 0 && isElementNode($next[0])) {
        const nextValue = elementValue($, $next[0], detailUrl);
        valueText = nextValue.text;
        valueHtml = nextValue.html;
        valueLinks = nextValue.links;
        valueLists = nextValue.lists;
        valueElement = $next[0];
        consumed.add($next[0]);
      }
    }

    if (!valueText) continue;

    attributes.push(makeAttribute($, scope, {
      order: attributes.length,
      strategy: 'label-element',
      table: null,
      row: null,
      cell: null,
      label,
      labelRaw,
      labelEn: null,
      labelColumn: null,
      valueColumns: [],
      value: {
        text: isPunctuationOnly(valueText) ? null : valueText,
        html: isPunctuationOnly(valueText) ? null : valueHtml,
        links: valueLinks,
        lists: valueLists
      },
      selectorElement: valueElement ?? element
    }));
  }

  return attributes;
}

function extractColonTextAttributes(
  $: CheerioAPI,
  scope: Element,
  detailUrl: string
): DetailAttribute[] {
  const attributes: DetailAttribute[] = [];
  const elements = $(scope)
    .find('p, li, div, span, td, dd')
    .toArray()
    .filter(isElementNode);

  for (const element of elements) {
    const directText = element.children
      .filter(child => child.type === 'text')
      .map(child => (child.type === 'text' ? child.data : ''))
      .join(' ');
    const match = cleanText(directText).match(/^([^:：]{1,80})\s*[:：]\s*(.*)$/);
    if (!match) continue;

    const labelRaw = cleanText(match[1]) + ':';
    const label = cleanText(match[1]);
    let valueText = cleanText(match[2]);

    let valueElement: Element | null = element;
    if (!valueText) {
      const $next = $(element).next();
      if ($next.length > 0 && isElementNode($next[0])) {
        valueText = cleanText(nodeText($next[0]));
        valueElement = $next[0];
      }
    }

    if (!label || !valueText) continue;

    const wrapper = $('<div></div>').text(valueText);
    const wrapperElement = wrapper[0] as Element;

    attributes.push(makeAttribute($, scope, {
      order: attributes.length,
      strategy: 'colon-text',
      table: null,
      row: null,
      cell: null,
      label,
      labelRaw,
      labelEn: null,
      labelColumn: null,
      valueColumns: [],
      value: {
        text: valueText,
        html: sanitizeElementHtml($, wrapperElement),
        links: valueElement ? collectLinks($, $(valueElement), detailUrl) : [],
        lists: valueElement ? collectLists($, $(valueElement), detailUrl) : []
      },
      selectorElement: valueElement
    }));
  }

  return attributes;
}

export function extractAttributes(
  $: CheerioAPI,
  scope: Element,
  primaryTable: Element | null,
  primaryTableIndex: number | null,
  detailUrl: string
): DetailAttribute[] {
  if (primaryTable) {
    const vsqiAttributes = extractVsqiColumns($, scope, primaryTable, primaryTableIndex, detailUrl);
    if (vsqiAttributes.length > 0) return vsqiAttributes;
  }

  const headerAttributes = extractTableHeaderAttributes(
    $,
    scope,
    primaryTable,
    primaryTableIndex,
    detailUrl
  );
  if (headerAttributes.length > 0) return headerAttributes;

  const definitionAttributes = extractDefinitionListAttributes($, scope, detailUrl);
  if (definitionAttributes.length > 0) return definitionAttributes;

  const labelAttributes = extractLabelElementAttributes($, scope, detailUrl);
  if (labelAttributes.length > 0) return labelAttributes;

  return extractColonTextAttributes($, scope, detailUrl);
}
