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

  return {
    ...legacy,
    detailUrl,
    source: 'VSQI',
    attributes,
    relations,
    raw
  };
}
