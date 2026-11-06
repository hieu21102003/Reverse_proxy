import type { CheerioAPI } from 'cheerio';
import type { AnyNode, Element, ParentNode } from 'domhandler';
import type {
  DetailHistory,
  DetailLink,
  DetailList,
  DetailListItem,
  LinkKind
} from '../../types.js';

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'div',
  'dl',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul'
]);

const DANGEROUS_SELECTOR = [
  'script',
  'style',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'optgroup',
  'meta',
  'link',
  'base',
  'noscript',
  'template',
  'iframe',
  'object',
  'embed',
  'source',
  'track'
].join(', ');

const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'poster',
  'data',
  'xlink:href',
  'srcdoc'
]);

const DOWNLOAD_EXTENSION = /\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|7z|txt|csv|rtf|odt|ods)(?:$|[?#])/i;
const DOWNLOAD_PATH = /\/(?:download|attachment|file)(?:\/|$)/i;

const STANDARD_CODE_RE =
  /\b((?:TCVN|TCXD|QCVN|TCN|TCCS|ST\s*SEV|ISO(?:\/IEC)?|IEC|EN|BS(?:\s+EN)?|GOST|ASTM)\s+(?:[A-Z]+\s+)?[0-9][0-9A-Z./-]*(?:\s*-\s*[0-9A-Z][0-9A-Z./-]*)*(?:\s*:+\s*\d{4}(?:[/-][A-Z0-9]+)?)?)/i;

const STANDARD_CODE_PREFIX =
  /\b(?:TCVN|TCXD|QCVN|TCN|TCCS|ISO(?:\/IEC)?|IEC|EN|BS(?:\s+EN)?|GOST|ASTM|ST\s*SEV)\b/i;

export function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function cleanMultiline(value: string | null | undefined): string {
  const lines = (value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[^\S\n]+/g, ' ').trim());

  while (lines.length > 0 && lines[0] === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const output: string[] = [];
  for (const line of lines) {
    if (line === '' && output.length > 0 && output[output.length - 1] === '') continue;
    output.push(line);
  }
  return output.join('\n');
}

export function normalizeLabel(value: string): string {
  return cleanText(value).replace(/:+\s*$/, '').trim().toLocaleLowerCase('vi');
}

export function isPunctuationOnly(value: string): boolean {
  return value.replace(/[\s:;,.·•\-–—]/g, '') === '';
}

export function isElementNode(node: AnyNode): node is Element {
  return node.type === 'tag' || node.type === 'script' || node.type === 'style';
}

export function nodeText(node: AnyNode): string {
  if (node.type === 'text') return node.data;
  if (node.type === 'comment' || node.type === 'directive') return '';
  if (!isElementNode(node)) {
    return 'children' in node ? node.children.map(child => nodeText(child)).join('') : '';
  }

  const name = node.name.toLowerCase();
  if (name === 'script' || name === 'style') return '';
  if (name === 'br') return '\n';

  let output = '';
  for (const child of node.children) output += nodeText(child);
  if (BLOCK_TAGS.has(name) && !output.endsWith('\n')) output += '\n';
  return output;
}

/**
 * Returns sanitized HTML for an element. Scripts/styles/forms and executable
 * URL attributes are removed; CSRF/session-like attributes are stripped.
 */
export function sanitizeElementHtml(
  $: CheerioAPI,
  element: Element,
  mode: 'inner' | 'outer' = 'inner'
): string {
  const $clone = $(element).clone();
  $clone.find(DANGEROUS_SELECTOR).remove();

  $clone.find('*').addBack().contents().filter((_, node) => node.type === 'comment').remove();

  const elements = $clone.find('*').addBack().toArray();
  for (const node of elements) {
    if (!isElementNode(node)) continue;

    for (const name of Object.keys(node.attribs)) {
      const lower = name.toLowerCase();
      if (
        lower.startsWith('on')
        || lower === 'style'
        || lower === 'srcdoc'
        || lower === 'nonce'
        || lower.includes('csrf')
        || lower.includes('antiforgery')
        || lower.includes('sessionid')
        || lower.includes('session-id')
        || lower.includes('cookie')
        || lower.includes('token')
      ) {
        $(node).removeAttr(name);
        continue;
      }

      if (URL_ATTRIBUTES.has(lower)) {
        const value = (node.attribs[name] ?? '').trim();
        if (/^(?:javascript|vbscript|data):/i.test(value)) {
          $(node).removeAttr(name);
        }
      }
    }
  }

  return mode === 'outer' ? $.html($clone) : ($clone.html() ?? '');
}

export function resolveHref(rawHref: string, baseUrl: string): string | null {
  const raw = rawHref.trim();
  if (!raw) return null;
  if (/^(?:javascript|vbscript|data|mailto|tel):/i.test(raw)) return null;

  try {
    const url = new URL(raw, baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function isDownloadableHref(rawHref: string): boolean {
  return DOWNLOAD_EXTENSION.test(rawHref) || DOWNLOAD_PATH.test(rawHref);
}

export function looksLikeStandardCode(value: string): boolean {
  return STANDARD_CODE_PREFIX.test(value) && /\d/.test(value);
}

export function parseStandardCode(value: string): string | null {
  const match = value.match(STANDARD_CODE_RE);
  return match ? cleanText(match[1]) : null;
}

function linkKind(
  rawHref: string,
  absoluteHref: string | null,
  baseHost: string,
  downloadable: boolean,
  data: Record<string, string>,
  text: string
): LinkKind {
  const raw = rawHref.trim().toLowerCase();
  if (raw.startsWith('#')) return 'other';
  if (/^(?:javascript|vbscript|data):/i.test(raw)) {
    const target = (data['data-target'] ?? '').toLowerCase();
    if (target.includes('contact') || /liên hệ|contact/i.test(text)) return 'contact';
    return 'other';
  }

  const path = absoluteHref ? new URL(absoluteHref).pathname.toLowerCase() : raw.toLowerCase();

  if (path.includes('/tieuchuan/add-gio') || path.includes('/quychuan/add-gio')) return 'purchase';
  if (path.includes('/tieuchuan/view') || path.includes('/quychuan/view')) return 'detail';

  if (path.includes('/tim-kiem') || path.includes('/tra-cuu-quy-chuan')) {
    if (absoluteHref) {
      const url = new URL(absoluteHref);
      const keys = [...url.searchParams.keys()];
      if (keys.some(key => key === 'ic[]' || key.startsWith('ic['))) return 'ics';
      if (keys.some(key => key.startsWith('linhvucxaydung['))) return 'specialized-field';
    }
    if (/ic%5b%5d|ic\[/i.test(rawHref)) return 'ics';
    if (/linhvucxaydung/i.test(rawHref)) return 'specialized-field';
    return 'search';
  }

  if (downloadable) return 'download';
  if (absoluteHref) {
    try {
      if (new URL(absoluteHref).host !== baseHost) return 'external';
    } catch {
      // ignore malformed URL; the caller only receives absolute HTTP(S) URLs
    }
  }
  return 'other';
}

export function collectLinks(
  $: CheerioAPI,
  scope: ReturnType<CheerioAPI>,
  detailUrl: string
): DetailLink[] {
  const base = new URL(detailUrl);
  const anchors = scope.filter('a[href]').add(scope.find('a[href]')).toArray();
  const seen = new Set<Element>();
  const links: DetailLink[] = [];

  for (const node of anchors) {
    if (!isElementNode(node) || seen.has(node)) continue;
    seen.add(node);

    const $link = $(node);
    const rawHref = ($link.attr('href') ?? '').trim();
    const href = resolveHref(rawHref, detailUrl);
    const downloadable = isDownloadableHref(rawHref);

    const data: Record<string, string> = {};
    for (const [name, value] of Object.entries(node.attribs)) {
      if (name.toLowerCase().startsWith('data-')) data[name] = value;
    }

    const text = cleanText(nodeText(node));
    const kind = linkKind(rawHref, href, base.host, downloadable, data, text);

    links.push({
      text,
      rawHref,
      href,
      kind,
      external: href !== null && new URL(href).host !== base.host,
      downloadable,
      title: cleanText($link.attr('title')) || null,
      target: cleanText($link.attr('target')) || null,
      rel: cleanText($link.attr('rel')) || null,
      data
    });
  }

  return links;
}

function stripOuterParentheses(value: string): string {
  return cleanText(value).replace(/^\s*\(/, '').replace(/\)\s*$/, '').trim();
}

function extractHistory($: CheerioAPI, $item: ReturnType<CheerioAPI>): DetailHistory | null {
  const statusElement = $item.find('.history_status').first();
  const identityElement = $item.find('.history_identity').first();
  const reviewElement = $item.find('.history_review').first();

  if (statusElement.length === 0 && identityElement.length === 0) return null;

  const statusText = cleanText(statusElement.text());
  const identityText = cleanText(identityElement.text());
  const reviewText = cleanText(reviewElement.text());

  let code: string | null = null;
  let status: string | null = null;
  let note: string | null = null;

  if (identityText) {
    status = stripOuterParentheses(identityText) || null;
    if (statusText) {
      if (looksLikeStandardCode(statusText)) code = statusText;
      else note = statusText;
    }
  } else if (statusText) {
    if (looksLikeStandardCode(statusText)) code = statusText;
    else note = statusText;
  }

  if (reviewText) note = note ? `${note}\n${reviewText}` : reviewText;

  return {
    code,
    status,
    note,
    active: $item.find('.history_box.active').length > 0
  };
}

export function collectLists(
  $: CheerioAPI,
  scope: ReturnType<CheerioAPI>,
  detailUrl: string
): DetailList[] {
  const listNodes = scope.filter('ul, ol').add(scope.find('ul, ol')).toArray();
  const seen = new Set<Element>();
  const lists: DetailList[] = [];

  for (const node of listNodes) {
    if (!isElementNode(node) || seen.has(node)) continue;
    seen.add(node);

    const $list = $(node);
    const items: DetailListItem[] = [];

    $list.children('li').each((_, item) => {
      if (!isElementNode(item)) return;
      const $item = $(item);
      items.push({
        text: cleanMultiline(nodeText(item)),
        html: sanitizeElementHtml($, item),
        links: collectLinks($, $item, detailUrl),
        history: extractHistory($, $item)
      });
    });

    lists.push({
      tag: node.name.toLowerCase() === 'ol' ? 'ol' : 'ul',
      className: cleanText($list.attr('class')) || null,
      items
    });
  }

  return lists;
}

export function cssPath(
  $: CheerioAPI,
  element: Element,
  stopAt: Element | null
): string | null {
  const parts: string[] = [];
  let node: AnyNode | null = element;

  while (node && node.type !== 'root') {
    if (stopAt && node === stopAt) break;
    if (!isElementNode(node)) {
      node = node.parent;
      continue;
    }

    const parent: ParentNode | null = node.parent;
    if (!parent) break;

    const siblings = parent.children.filter((child): child is Element => isElementNode(child));
    const index = siblings.indexOf(node) + 1;
    const className = cleanText($(node).attr('class')).split(/\s+/).filter(Boolean)[0];
    parts.unshift(`${node.name.toLowerCase()}${className ? `.${className}` : ''}:nth-child(${index})`);
    node = parent;
  }

  return parts.length > 0 ? parts.join(' ') : null;
}
