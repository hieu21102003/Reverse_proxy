import * as cheerio from 'cheerio';
import { VsqiError } from '../errors.js';
import type { StandardDetail } from '../types.js';
import { extractAttributes, findDetailContainer, findPrimaryTable } from './detail/extract.js';
import { isElementNode } from './detail/helpers.js';
import { deriveRelations, normalizeLegacy } from './detail/normalize.js';
import { collectRawDetail } from './detail/raw.js';

export function parseDetailHtml(
  html: string,
  requestedCode: string,
  detailUrl: string
): StandardDetail | null {
  const $ = cheerio.load(html);
  const scope = findDetailContainer($);

  if (!scope) {
    throw new VsqiError('VSQI detail page has an unexpected structure', 'INVALID_UPSTREAM_HTML', 502);
  }

  const primaryTable = findPrimaryTable($, scope);
  const tableElements = $(scope).find('table').toArray().filter(isElementNode);
  const primaryTableIndex = primaryTable ? tableElements.indexOf(primaryTable) : null;
  const attributes = extractAttributes($, scope, primaryTable, primaryTableIndex, detailUrl);

  if (attributes.length === 0) {
    throw new VsqiError('VSQI detail page has an unexpected structure', 'INVALID_UPSTREAM_HTML', 502);
  }

  const legacy = normalizeLegacy(attributes, requestedCode);
  if (legacy === null) return null;

  const raw = collectRawDetail($, scope, primaryTable, legacy.code, detailUrl);
  const relations = deriveRelations(attributes, raw.links);

  // ICS codes: VSQI exposes them as "Chỉ số phân loại quốc tế (ICS)"
  // attributes, which deriveRelations turns into type 'ics' relations
  // (one per code). Fall back to splitting the attribute value.
  const ics: string[] = [];
  for (const relation of relations) {
    if (relation.type === 'ics' && relation.text && !ics.includes(relation.text)) {
      ics.push(relation.text);
    }
  }
  if (ics.length === 0) {
    for (const attribute of attributes) {
      if (!/ics/i.test(attribute.label) && !/ics/i.test(attribute.labelEn ?? '')) continue;
      for (const part of (attribute.value ?? '').split(/[,\n]/)) {
        const code = part.trim();
        if (code && !ics.includes(code)) ics.push(code);
      }
    }
  }

  return {
    ...legacy,
    detailUrl,
    ics,
    source: 'VSQI',
    attributes,
    relations,
    raw
  };
}
