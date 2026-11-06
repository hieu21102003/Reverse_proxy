import { VsqiError } from '../../errors.js';
import type {
  DetailAttribute,
  DetailLink,
  DetailListItem,
  DetailRelation,
  RelationType
} from '../../types.js';
import { cleanText, looksLikeStandardCode, normalizeLabel, parseStandardCode } from './helpers.js';

export interface LegacyDetail {
  code: string;
  name: string | null;
  englishName: string | null;
  year: number | null;
  status: string | null;
  issuedDate: string | null;
  effectiveDate: string | null;
  issuingAgency: string | null;
  replacedBy: string | null;
  replaces: string | null;
}

type LegacyField = keyof LegacyDetail;

interface AliasDefinition {
  vi: string[];
  en?: string[];
}

/**
 * Centralized normalization map for the legacy fields. The dynamic
 * `attributes` array remains the lossless source of truth.
 */
export const LEGACY_ALIASES: Record<LegacyField, AliasDefinition> = {
  code: {
    vi: ['Số hiệu'],
    en: ['Standard Number']
  },
  name: {
    vi: ['Tên tiếng Việt'],
    en: ['Title in Vietnamese']
  },
  englishName: {
    vi: ['Tên tiếng Anh'],
    en: ['Title in English']
  },
  year: {
    vi: ['Năm ban hành', 'Năm công bố, ban hành', 'Năm công bố'],
    en: ['Publication date']
  },
  status: {
    vi: ['Tình trạng', 'Trạng thái'],
    en: ['Status']
  },
  issuedDate: {
    vi: ['Ngày ban hành', 'Ngày công bố']
  },
  effectiveDate: {
    vi: ['Ngày có hiệu lực', 'Ngày hiệu lực', 'Ngày bắt đầu có hiệu lực'],
    en: ['Effective date']
  },
  issuingAgency: {
    vi: ['Cơ quan ban hành', 'Cơ quan công bố'],
    en: ['Agency issued']
  },
  replacedBy: {
    vi: ['Thay thế bằng', 'Được thay thế bởi', 'Bị thay thế bởi'],
    en: ['Replaced by']
  },
  replaces: {
    vi: ['Thay thế cho'],
    en: ['Replace', 'Replaces']
  }
};

export function normalizeCode(value: string): string {
  return cleanText(value).replace(/\s*:\s*/g, ':').toLocaleUpperCase('en');
}

function hasValue(attribute: DetailAttribute): boolean {
  return attribute.value !== null && attribute.value.trim() !== '';
}

function matchingVietnameseField(label: string): LegacyField | null {
  const normalized = normalizeLabel(label);
  for (const [field, aliases] of Object.entries(LEGACY_ALIASES) as Array<[LegacyField, AliasDefinition]>) {
    if (aliases.vi.some(alias => normalizeLabel(alias) === normalized)) return field;
  }
  return null;
}

function findAttribute(attributes: DetailAttribute[], field: LegacyField): DetailAttribute | null {
  const aliases = LEGACY_ALIASES[field];
  const vietnameseAliases = aliases.vi.map(normalizeLabel);

  // Prefer the Vietnamese label. This avoids the upstream "Replaced by"
  // English label on "Thay thế cho" changing the relation direction.
  for (const attribute of attributes) {
    if (!hasValue(attribute)) continue;
    if (vietnameseAliases.includes(normalizeLabel(attribute.label))) return attribute;
  }

  const englishAliases = (aliases.en ?? []).map(normalizeLabel);
  for (const attribute of attributes) {
    if (!hasValue(attribute) || !attribute.labelEn) continue;
    if (!englishAliases.includes(normalizeLabel(attribute.labelEn))) continue;

    const vietnameseField = matchingVietnameseField(attribute.label);
    if (vietnameseField !== null && vietnameseField !== field) continue;
    return attribute;
  }

  return null;
}

function statusValue(value: string | null): string | null {
  if (!value) return null;
  const active = value.match(/\b(Active|Withdrawn|Expired)\b/i)?.[1];
  if (active) return active.toLowerCase() === 'active' ? 'Active' : 'Withdrawn';
  if (/còn hiệu lực/i.test(value)) return 'Active';
  if (/hết hiệu lực|bị thay thế/i.test(value)) return 'Withdrawn';
  return value;
}

export function normalizeLegacy(
  attributes: DetailAttribute[],
  requestedCode: string
): LegacyDetail | null {
  const codeAttribute = findAttribute(attributes, 'code');
  if (!codeAttribute || !codeAttribute.value) {
    throw new VsqiError('VSQI detail page has an unexpected structure', 'INVALID_UPSTREAM_HTML', 502);
  }

  const code = cleanText(codeAttribute.value);
  if (normalizeCode(code) !== normalizeCode(requestedCode)) return null;

  const yearAttribute = findAttribute(attributes, 'year');
  const yearMatch = yearAttribute?.value?.match(/\b\d{4}\b/);
  const statusAttribute = findAttribute(attributes, 'status');

  return {
    code,
    name: findAttribute(attributes, 'name')?.value ?? null,
    englishName: findAttribute(attributes, 'englishName')?.value ?? null,
    year: yearMatch ? Number(yearMatch[0]) : null,
    status: statusValue(statusAttribute?.value ?? null),
    issuedDate: findAttribute(attributes, 'issuedDate')?.value ?? null,
    effectiveDate: findAttribute(attributes, 'effectiveDate')?.value ?? null,
    issuingAgency: findAttribute(attributes, 'issuingAgency')?.value ?? null,
    replacedBy: findAttribute(attributes, 'replacedBy')?.value ?? null,
    replaces: findAttribute(attributes, 'replaces')?.value ?? null
  };
}

function relationTypeForAttribute(attribute: DetailAttribute): RelationType | null {
  const label = normalizeLabel(attribute.label);
  const englishLabel = attribute.labelEn ? normalizeLabel(attribute.labelEn) : '';

  switch (label) {
    case 'thay thế cho':
      return 'replaces';
    case 'thay thế bằng':
    case 'được thay thế bởi':
    case 'bị thay thế bởi':
      return 'replacedBy';
    case 'lịch sử soát xét':
      return 'history';
    case 'tiêu chuẩn viện dẫn':
    case 'tài liệu viện dẫn':
      return 'normativeReference';
    case 'tiêu chuẩn tương đương':
      return 'equivalent';
    case 'chỉ số phân loại quốc tế':
    case 'chỉ số phân loại quốc tế (ics)':
      return 'ics';
    case 'lĩnh vực chuyên ngành':
      return 'specializedField';
    case 'ban kỹ thuật':
      return 'committee';
    case 'giá': {
      const hasContact = attribute.links.some(link => link.kind === 'contact');
      return hasContact ? 'contact' : 'purchase';
    }
    default:
      break;
  }

  if (englishLabel === 'replaced by') return 'replacedBy';
  if (englishLabel === 'replace' || englishLabel === 'replaces') return 'replaces';
  return null;
}

function firstNavigableLink(links: DetailLink[]): DetailLink | null {
  return links.find(link => link.href !== null) ?? null;
}

function singleValueCode(value: string | null): string | null {
  if (!value || value.includes('\n') || value.length > 80) return null;
  return parseStandardCode(value);
}

function relationCode(type: RelationType, text: string): string | null {
  if (type === 'ics') {
    const match = text.match(/\b\d{2}(?:\.\d{1,3})+\b/);
    return match ? match[0] : null;
  }
  if (text.includes('\n') || text.length > 80) return null;
  return parseStandardCode(text);
}

function makeRelation(
  attribute: DetailAttribute,
  index: number,
  type: RelationType,
  values: {
    text: string;
    code?: string | null;
    url?: string | null;
    status?: string | null;
    active?: boolean | null;
    links?: DetailLink[];
    listItems?: DetailListItem[];
  }
): DetailRelation {
  return {
    type,
    label: attribute.label,
    labelEn: attribute.labelEn,
    text: values.text,
    code: values.code ?? null,
    url: values.url ?? null,
    status: values.status ?? null,
    active: values.active ?? null,
    sourceAttributeIndex: index,
    links: values.links ?? attribute.links,
    listItems: values.listItems ?? []
  };
}

function deriveHistoryRelations(
  attribute: DetailAttribute,
  index: number,
  relations: DetailRelation[]
): void {
  const listItems = attribute.lists.flatMap(list => list.items);
  const historyItems = listItems.filter(item => item.history !== null);

  if (historyItems.length > 0) {
    for (const item of historyItems) {
      const history = item.history;
      if (!history) continue;
      relations.push(makeRelation(attribute, index, 'history', {
        text: item.text,
        code: history.code,
        url: firstNavigableLink(item.links)?.href ?? null,
        status: history.status,
        active: history.active,
        links: item.links,
        listItems: [item]
      }));
    }
    return;
  }

  if (!attribute.value) return;
  relations.push(makeRelation(attribute, index, 'history', {
    text: attribute.value,
    code: singleValueCode(attribute.value),
    url: firstNavigableLink(attribute.links)?.href ?? null,
    listItems
  }));
}

function deriveLinkRelations(
  attribute: DetailAttribute,
  index: number,
  type: RelationType,
  relations: DetailRelation[]
): void {
  const navigableLinks = attribute.links.filter(link => link.href !== null);

  if (navigableLinks.length > 0) {
    for (const link of navigableLinks) {
      relations.push(makeRelation(attribute, index, type, {
        text: link.text || attribute.value || '',
        code: relationCode(type, link.text),
        url: link.href,
        links: [link]
      }));
    }
    return;
  }

  if (!attribute.value) return;
  relations.push(makeRelation(attribute, index, type, {
    text: attribute.value,
    code: relationCode(type, attribute.value),
    url: null
  }));
}

export function deriveRelations(
  attributes: DetailAttribute[],
  pageLinks: DetailLink[] = []
): DetailRelation[] {
  const relations: DetailRelation[] = [];

  for (let index = 0; index < attributes.length; index++) {
    const attribute = attributes[index];
    const type = relationTypeForAttribute(attribute);
    if (!type) continue;

    if (type === 'history') {
      deriveHistoryRelations(attribute, index, relations);
      continue;
    }

    if (type === 'normativeReference' || type === 'ics' || type === 'specializedField') {
      deriveLinkRelations(attribute, index, type, relations);
      continue;
    }

    if (type === 'purchase' || type === 'contact') {
      deriveLinkRelations(attribute, index, type, relations);
      continue;
    }

    if (type === 'replaces' || type === 'replacedBy' || type === 'equivalent' || type === 'committee') {
      if (!attribute.value) continue;
      relations.push(makeRelation(attribute, index, type, {
        text: attribute.value,
        code: parseStandardCode(attribute.value),
        url: firstNavigableLink(attribute.links)?.href ?? null,
        listItems: attribute.lists.flatMap(list => list.items)
      }));
    }
  }

  const representedPurchaseUrls = new Set(
    relations
      .filter(relation => relation.type === 'purchase' && relation.url !== null)
      .map(relation => relation.url)
  );

  for (const link of pageLinks) {
    if (link.kind !== 'purchase' || link.href === null || representedPurchaseUrls.has(link.href)) continue;
    representedPurchaseUrls.add(link.href);
    relations.push({
      type: 'purchase',
      label: 'Đặt mua tiêu chuẩn',
      labelEn: null,
      text: link.text,
      code: null,
      url: link.href,
      status: null,
      active: null,
      sourceAttributeIndex: -1,
      links: [link],
      listItems: []
    });
  }

  return relations;
}
