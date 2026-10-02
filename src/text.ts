const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Normalises a string for comparison: optional lower-casing and accent
 * removal. Text is recomposed (NFC) afterwards so that scripts that NFD
 * decomposes into letters — such as Hangul syllables into jamo — never match
 * partial characters.
 */
export function fold(value: string, caseSensitive: boolean, ignoreDiacritics: boolean): string {
  let out = value;
  if (ignoreDiacritics) {
    out = out.normalize('NFD').replace(COMBINING_MARKS, '').normalize('NFC');
  }
  return caseSensitive ? out : out.toLowerCase();
}

/**
 * Matches `value` against literal `parts` separated by `*` wildcards
 * (the whole value must match). Runs in O(n·m) without regular expressions,
 * so user-supplied patterns cannot cause catastrophic backtracking.
 */
export function globMatch(parts: readonly string[], value: string): boolean {
  if (parts.length === 1) return parts[0] === value;
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  if (value.length < first.length + last.length) return false;
  if (!value.startsWith(first) || !value.endsWith(last)) return false;
  let pos = first.length;
  const limit = value.length - last.length;
  for (let i = 1; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (part === '') continue;
    const found = value.indexOf(part, pos);
    if (found === -1 || found + part.length > limit) return false;
    pos = found + part.length;
  }
  return true;
}

/** Edit distance where an adjacent transposition (`opne` → `open`) costs 1. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const width = b.length + 1;
  let prevPrev = new Array<number>(width).fill(0);
  let prev = new Array<number>(width);
  let cur = new Array<number>(width);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let best = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
        best = Math.min(best, prevPrev[j - 2]! + 1);
      }
      cur[j] = best;
    }
    const tmp = prevPrev;
    prevPrev = prev;
    prev = cur;
    cur = tmp;
  }
  return prev[b.length]!;
}

/** Finds the closest candidate within a sensible edit distance. */
export function closest(input: string, candidates: Iterable<string>): string | undefined {
  const needle = input.toLowerCase();
  let best: string | undefined;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const hay = candidate.toLowerCase();
    let score = editDistance(needle, hay);
    if (hay.startsWith(needle) && needle.length > 0) score = Math.min(score, 1);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  const tolerance = Math.max(1, Math.floor(needle.length / 3));
  return best !== undefined && bestScore <= tolerance ? best : undefined;
}

/**
 * Makes raw source text safe to embed anywhere in a query, without changing
 * what it means:
 * - a quote left open is closed, so text appended afterwards is not swallowed
 *   (a trailing literal backslash is doubled so it can't escape that quote);
 * - an unquoted `)` is quoted (`a)b` → `a")"b`), so it can't close a group.
 */
export function safeRaw(raw: string): string {
  let out = '';
  let open = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (open) {
      if (ch === '\\' && (raw[i + 1] === '"' || raw[i + 1] === '\\')) {
        out += ch + raw[i + 1];
        i++;
      } else if (ch === '\\' && i === raw.length - 1) {
        out += '\\\\';
      } else {
        if (ch === '"') open = false;
        out += ch;
      }
    } else if (ch === '"') {
      open = true;
      out += ch;
    } else if (ch === ')') {
      out += '")"';
    } else {
      out += ch;
    }
  }
  return open ? out + '"' : out;
}

export function quote(value: string): string {
  return '"' + value.replace(/[\\"]/g, (ch) => '\\' + ch) + '"';
}

export function isSpace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/.test(ch);
}

/** Characters that always force a value to be quoted. */
const STRUCTURAL = /[\s",()]/;

/**
 * Formats a qualifier value so that it parses back to `value`.
 * @param literal quote `*` and `..` too, so they are not read as wildcard / range.
 */
export function formatValue(value: string, literal: boolean): string {
  if (
    value === '' ||
    STRUCTURAL.test(value) ||
    /^[<>=]/.test(value) ||
    (literal && (value.indexOf('*') !== -1 || value.indexOf('..') !== -1))
  ) {
    return quote(value);
  }
  return value;
}

const KEY_LIKE = /^[\p{L}_][\p{L}\p{N}_.-]*:/u;

/** Formats a free-text word so that it parses back as the same free text. */
export function formatText(value: string, quoted: boolean): string {
  if (
    quoted ||
    value === '' ||
    /[\s"()]/.test(value) ||
    /^[-!]/.test(value) ||
    value === 'AND' ||
    value === 'OR' ||
    value === 'NOT' ||
    KEY_LIKE.test(value)
  ) {
    return quote(value);
  }
  return value;
}
