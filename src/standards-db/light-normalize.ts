// Light code normalization — THE merge key for standards metadata.
// This is a verbatim copy of elib's src/standards/light-normalize.ts
// (elib is the source of truth for stored normalized_code). Reverse_proxy
// uses it only for query detection and merge keys; both repos test
// against the shared fixture tests/fixtures/code-normalize-shared.json.
// If elib's function changes, copy it here again and refresh the fixture.
//
// Rules (see elib original for the full rationale):
// - the normalizer rejects non-codes itself: raw input containing "*"
//   (a multi-code string that should have been split upstream) ->
//   skipped_reason 'multi-code'; raw input containing the full words
//   CORRIGENDUM / AMENDMENT / TECHNICAL (prose, e.g. "ISO 9001
//   Technical Corrigendum 1") -> skipped_reason 'prose'. Abbreviated
//   /Amd, /Cor suffixes are NOT rejected;
// - cut the code at the first "(" BEFORE anything else; the
//   parenthetical is returned separately (`parenthetical`) for the
//   repository to use as an equivalent-relation raw code. A
//   parenthetical that is just a date "(YYYY-MM)"/"(YYYY)" supplies
//   the year when no year field is given (TCVN_QT replaces style).
//   A parenthetical containing part/range words (phần, các phần,
//   từ…đến — checked diacritic-insensitively) flags needs_review:
//   the cut note may hide part information the key no longer shows;
// - catalog prose never becomes a key: if the truncated input
//   contains a comma or Vietnamese range words (đến, các phần, từ,
//   và — checked diacritic-insensitively), or the built key falls
//   outside [A-Z0-9.\-:/+_], the result carries
//   normalized_code = null + skipped_reason = 'catalog-prose' +
//   needs_review. Ingest logs and creates nothing;
// - uppercase, strip Vietnamese diacritics (NFD + drop combining
//   marks, đ/Đ -> D), remove whitespace/newlines — EXCEPT whitespace
//   between two digit groups, which keeps a "-" separator
//   ("TCVN 1234 12" -> "TCVN1234-12", needs_review) — unless the
//   single separated trailing group is exactly the 4-digit year
//   field ("TCVN 1234-1 2013" + 2013 -> "TCVN1234-1:2013", no
//   review: the group IS the year). Letter<->digit boundaries still
//   join. The token "STD" right after IEEE is dropped ("IEEE Std
//   802.11" -> "IEEE802.11");
// - `code_key_raw` = the light-normalized original code BEFORE year
//   rewriting (after uppercase/diacritic/slash/whitespace rules and
//   the paren cut, before dash-year -> :YYYY conversion and before
//   appending :yearField). Relation resolution and lookup match on
//   BOTH normalized_code and code_key_raw, so "14 TCN 58-88" (stored
//   as 14TCN58:1988 with code_key_raw 14TCN58-88) still resolves from
//   a yearless "14 TCN 58-88" reference;
// - slash rule: a `/` is dropped iff the char before AND after it are
//   both letters (ISO/TS -> ISOTS, TCVN/ISO -> TCVNISO, GB/T -> GBT);
//   kept when it follows a digit (suffixes /Amd 1, /BXD, /AC).
//   Suffixes are never dropped;
// - skip (null) when the normalized string has no two consecutive
//   letters before a digit: digits-only ("12345"), ICS-like
//   ("93.160"), single-letter org ("T 27"), letters-only ("abc") are
//   not standard codes. Ingest skips + logs those, never fails the
//   batch;
// - "code has year" ONLY when `:YYYY` (4 digits, not followed by
//   another digit) appears; base_key = part before the FIRST
//   `:YYYY`, year = that first year (main edition —
//   "EN 1994-1-1:2004+A1:2010" -> base EN1994-1-1, year 2004).
//   Two-digit years in the code ("14 TCN 58-88") stay untouched
//   unless the dash-year rule below applies;
// - standalone amendment ("ISO 231123-1/AC:2009"): when the first
//   `:YYYY` sits AFTER an amendment marker (/AMD, /COR, /AC, +A\d)
//   and no `:YYYY` precedes the marker, that year is the amendment's
//   year (stored in amendment_year), base_key = part before the
//   marker, and the main year stays null (or the year field when
//   given). When a main `:YYYY` precedes the marker, a `:YYYY` after
//   the marker is amendment_year and the main year is the first one;
// - dash-year rule: a trailing `-YYYY` or `/YYYY` (optionally
//   followed by `-MM`) equal to the year field is rewritten to
//   `:YYYY`; the `-MM` month is dropped from the key (month is not
//   part of a standard's identity). A trailing `-YY` becomes
//   `:YYYY` (full field year) ONLY when it equals the last two
//   digits of the year field, no other "-" precedes it (protects
//   part-chapter codes like "EN 1993-1-10"), AND the org is in the
//   two-digit-year allowlist (ASTM, AASHTO, GBJ, GB, old
//   TCN/TCXD/TCXDVN) — for any other org a matching `-YY` may be a
//   part number ("ISO 1234-13" + 2013), so it stays literal,
//   `:fieldYear` is appended and needs_review is set. A trailing
//   4-digit dash segment that DISAGREES with the year field stays
//   literal, `:fieldYear` is still appended (code lacks `:YYYY`),
//   and needs_review is set (year conflict). Amendment codes are
//   exempt from the rewrite;
// - code has `:YYYY` != yearField -> key from code, needs_review;
// - code has no `:YYYY` but yearField present -> append `:yearField`,
//   EXCEPT amendment-suffixed codes (no append, needs_review);
// - needs_review also when the resolved year is outside
//   [1900, current year + 1], and when the leading letter block is a
//   doubled org prefix ("ENEN", "EN EN", "TCVNTCVN") — the doubled
//   form is kept in the key, never collapsed;
// - is_amendment by simple regex (/AMD, /COR, /AC, +A\d);
// - is_draft when the code carries a draft token (FDIS, DIS, PRF,
//   prEN, FprEN) — drafts sort below the official edition.

export interface LightNormalized {
  /** Null only for catalog prose (see skipped_reason). */
  normalized_code: string | null;
  base_key: string | null;
  /**
   * Light-normalized original code BEFORE year rewriting (dash-year
   * conversion / :yearField append). Null when no key was created.
   */
  code_key_raw: string | null;
  year: number | null;
  /** Year of the amendment/corrigendum segment, when present. */
  amendment_year: number | null;
  is_amendment: boolean;
  is_draft: boolean;
  needs_review: boolean;
  /** Text after the first "(" (trailing ")" stripped), if any. */
  parenthetical: string | null;
  /** 'catalog-prose' | 'multi-code' | 'prose' when no key was created; otherwise null. */
  skipped_reason: string | null;
}

const LETTER_RE = /\p{L}/u;
const AMENDMENT_RE = /(?:\/AMD|\/COR|\/AC|\+A\d)/;
const COLON_YEAR_RE = /:(\d{4})(?!\d)/g;
const DASH_YEAR_RE = /[-/](\d{4})(?:-\d{2})?$/;
const DASH_YY_RE = /-(\d{2})$/;
const ORG_LETTERS_RE = /[A-Z]{2}.*\d/;
const LEADING_LETTERS_RE = /^[A-Z]+/;
const KEY_CHARSET_RE = /^[A-Z0-9.\-:\/+_]+$/;
const PAREN_DATE_RE = /^(\d{4})(?:-\d{1,2})?$/;
const DRAFT_RE = /(FDIS|FPREN|PREN|PRF|DIS)/;
/** Orgs that historically write 2-digit years (ASTM D 4719-07...). */
const TWO_DIGIT_YEAR_ORGS = /(ASTM|AASHTO|GBJ|TCXDVN|TCXD|TCN|GB)/;
/** Vietnamese catalog-range words, checked on diacritic-stripped text. */
const PROSE_WORDS_RE = /\b(DEN|CAC PHAN|TU|VA)\b/;
/** Full prose words that are never part of a code (raw input check). */
const PROSE_FULL_WORDS_RE = /\b(CORRIGENDUM|AMENDMENT|TECHNICAL)\b/i;
/** Part/range words inside a cut parenthetical (diacritic-stripped). */
const PAREN_PART_WORDS_RE = /\b(CAC PHAN|PHAN)\b|\bTU\b.*\bDEN\b/;

function stripDiacriticsUpper(text: string): string {
  return text
    .replace(/[đĐ]/g, 'D')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase();
}

function applySlashRule(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '/') {
      const before = i > 0 ? text[i - 1] : '';
      const after = i + 1 < text.length ? text[i + 1] : '';
      if (LETTER_RE.test(before) && LETTER_RE.test(after)) {
        continue; // letter/letter -> drop (ISO/TS = ISO TS)
      }
    }
    out += ch;
  }
  return out;
}

/** Leading letter block repeated twice ("ENEN", "TCVNTCVN"). */
function hasDoubledOrg(light: string): boolean {
  const run = LEADING_LETTERS_RE.exec(light)?.[0] ?? '';
  if (run.length < 4 || run.length % 2 !== 0) return false;
  const half = run.length / 2;
  return run.slice(0, half) === run.slice(half);
}

function yearInRange(year: number): boolean {
  return year >= 1900 && year <= new Date().getFullYear() + 1;
}

function skipResult(parenthetical: string | null, reason: string): LightNormalized {
  return {
    normalized_code: null,
    base_key: null,
    code_key_raw: null,
    year: null,
    amendment_year: null,
    is_amendment: false,
    is_draft: false,
    needs_review: true,
    parenthetical,
    skipped_reason: reason
  };
}

function proseSkip(parenthetical: string | null): LightNormalized {
  return skipResult(parenthetical, 'catalog-prose');
}

export function lightNormalizeCode(
  code: string,
  yearField?: number | null
): LightNormalized | null {
  if (typeof code !== 'string') return null;
  const trimmed = code.trim();
  if (trimmed.length === 0) return null;

  // The normalizer rejects non-codes itself, on the RAW input: a "*"
  // means several codes were glued together (multi-code string that
  // ingest should have split); the full words CORRIGENDUM / AMENDMENT
  // / TECHNICAL mean prose ("ISO 9001 Technical Corrigendum 1"), not
  // a code. Abbreviated /Amd, /Cor suffixes pass.
  if (trimmed.includes('*')) return skipResult(null, 'multi-code');
  if (PROSE_FULL_WORDS_RE.test(trimmed)) return skipResult(null, 'prose');

  // Cut at the first "(" — parenthetical content never enters the key.
  let main = trimmed;
  let parenthetical: string | null = null;
  const parenIdx = trimmed.indexOf('(');
  if (parenIdx >= 0) {
    main = trimmed.slice(0, parenIdx).trim();
    parenthetical = trimmed.slice(parenIdx + 1).replace(/\)\s*$/, '').trim() || null;
  }
  if (main.length === 0) return null;

  // Catalog prose (comma lists, Vietnamese range words) is not a code.
  const mainStripped = stripDiacriticsUpper(main);
  if (main.includes(',') || PROSE_WORDS_RE.test(mainStripped)) {
    return proseSkip(parenthetical);
  }

  // A cut parenthetical with part/range words ("(các phần 1-6)",
  // "(phần 1 đến 3)", "(từ 1 đến 10)") may hide part information the
  // key no longer shows — flag for review. Date/equivalent
  // parentheticals ("(2008-11)", "(ISO 3010:2001)") do not flag.
  const parenPartWords =
    parenthetical !== null &&
    PAREN_PART_WORDS_RE.test(stripDiacriticsUpper(parenthetical));

  let text = mainStripped;
  // Whitespace between two digit groups keeps a "-" separator instead
  // of joining ("TCVN 1234 12" -> "TCVN1234-12"); flagged for review
  // because the grouping is ambiguous — unless the single separated
  // trailing group is exactly the year field (checked below).
  const sepGroups: string[] = [];
  text = text.replace(/(\d)\s+(\d+)/g, (_m, a: string, b: string) => {
    sepGroups.push(b);
    return `${a}-${b}`;
  });
  text = text.replace(/\s+/g, '');
  // "IEEE Std 802.11" -> "IEEE802.11": STD is not part of the code.
  if (text.startsWith('IEEESTD')) text = `IEEE${text.slice('IEEESTD'.length)}`;
  let light = applySlashRule(text);
  // code_key_raw: the light-normalized original code BEFORE any year
  // rewriting (dash-year conversion / :yearField append below).
  const codeKeyRaw = light;

  // A standard code carries an org of at least two letters before its
  // number. Digits-only, ICS-like, single-letter and letters-only
  // strings are not codes.
  if (!ORG_LETTERS_RE.test(light)) return null;

  const isAmendment = AMENDMENT_RE.test(light);
  const isDraft = DRAFT_RE.test(light);
  // A date-only parenthetical "(YYYY-MM)" supplies the year when the
  // caller gave none (TCVN_QT replaces parts arrive pre-split, but
  // detail codes can carry the note inline).
  const parenYear =
    parenthetical !== null && PAREN_DATE_RE.test(parenthetical)
      ? Number(PAREN_DATE_RE.exec(parenthetical)?.[1])
      : null;
  const fieldYear =
    typeof yearField === 'number' && Number.isInteger(yearField) ? yearField : parenYear;
  // Digit-group exception: a single separated trailing group that is
  // exactly the 4-digit year field IS the year ("TCVN 1234-1 2013" +
  // 2013 -> dash-year rule below makes ":2013") — no review flag.
  const digitGroupYearException =
    sepGroups.length === 1 &&
    !isAmendment &&
    fieldYear !== null &&
    sepGroups[0].length === 4 &&
    Number(sepGroups[0]) === fieldYear;
  let needsReview =
    (sepGroups.length > 0 && !digitGroupYearException) ||
    hasDoubledOrg(light) ||
    parenPartWords;

  const hasColonYear = (): boolean => {
    COLON_YEAR_RE.lastIndex = 0;
    return COLON_YEAR_RE.test(light);
  };

  // Dash-year rule: trailing -YYYY or /YYYY (optional -MM) matching
  // the year field becomes :YYYY (month dropped). -YY only for the
  // two-digit-year org allowlist, when it matches the field year's
  // last two digits and no other "-" comes before it; for other orgs
  // a matching -YY may be a part number, so it stays literal and
  // flags review. A disagreeing 4-digit dash segment stays literal
  // and flags a year conflict.
  if (!hasColonYear() && !isAmendment && fieldYear !== null) {
    const dashYear = DASH_YEAR_RE.exec(light);
    if (dashYear && Number(dashYear[1]) === fieldYear) {
      light = `${light.slice(0, dashYear.index)}:${dashYear[1]}`;
    } else if (dashYear) {
      needsReview = true;
    } else {
      const dashYY = DASH_YY_RE.exec(light);
      if (
        dashYY &&
        Number(dashYY[1]) === fieldYear % 100 &&
        !light.slice(0, dashYY.index).includes('-')
      ) {
        if (TWO_DIGIT_YEAR_ORGS.test(light.slice(0, dashYY.index))) {
          light = `${light.slice(0, dashYY.index)}:${fieldYear}`;
        } else {
          needsReview = true;
        }
      }
    }
  }

  const finish = (
    normalized: string,
    baseKey: string,
    year: number | null,
    amendmentYear: number | null,
    review: boolean
  ): LightNormalized => {
    if (!KEY_CHARSET_RE.test(normalized)) return proseSkip(parenthetical);
    return {
      normalized_code: normalized,
      base_key: baseKey,
      code_key_raw: codeKeyRaw,
      year,
      amendment_year: amendmentYear,
      is_amendment: isAmendment,
      is_draft: isDraft,
      needs_review: review,
      parenthetical,
      skipped_reason: null
    };
  };

  // Locate :YYYY segments and the amendment marker (if any).
  COLON_YEAR_RE.lastIndex = 0;
  const yearSegs = [...light.matchAll(COLON_YEAR_RE)];
  const marker = AMENDMENT_RE.exec(light);

  if (yearSegs.length > 0) {
    const first = yearSegs[0];
    const firstYear = Number(first[1]);
    const firstIdx = first.index ?? 0;
    if (isAmendment && marker && firstIdx > (marker.index ?? 0)) {
      // Standalone amendment: the only :YYYY belongs to the amendment
      // segment. Main year is unknown unless the field provides it.
      return finish(
        light,
        light.slice(0, marker.index),
        fieldYear,
        firstYear,
        needsReview || !yearInRange(firstYear)
      );
    }
    // Main year = first :YYYY; a later :YYYY after an amendment
    // marker is the amendment's year.
    let amendmentYear: number | null = null;
    if (isAmendment && marker) {
      const after = yearSegs.find((s) => (s.index ?? 0) > (marker.index ?? 0));
      if (after) amendmentYear = Number(after[1]);
    }
    return finish(
      light,
      light.slice(0, firstIdx),
      firstYear,
      amendmentYear,
      needsReview ||
        (fieldYear !== null && fieldYear !== firstYear) ||
        !yearInRange(firstYear)
    );
  }

  if (fieldYear !== null) {
    if (isAmendment) {
      // Amendment suffix without ":year": do not append the field year
      // (it would fake the base edition's key) — flag for review.
      return finish(light, light, fieldYear, null, true);
    }
    return finish(
      `${light}:${fieldYear}`,
      light,
      fieldYear,
      null,
      needsReview || !yearInRange(fieldYear)
    );
  }

  return finish(light, light, null, null, needsReview);
}

/** Drafts (FDIS/DIS/PRF/prEN...) sort below the official edition. */
export function isFdisCode(normalizedCode: string): boolean {
  return normalizedCode.includes('FDIS');
}
