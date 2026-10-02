import { isUrl, resolveField, type ParserConfig } from './parser';
import { scan, type Chunk, type WordChunk } from './scanner';
import { fold, formatValue } from './text';
import type { Diagnostic, FieldDef, Suggestion, SuggestOptions, SuggestResult, Token, TokenType } from './types';

/* ------------------------------------------------------------------------ */
/* Syntax highlighting                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Splits the input into tokens that cover every character exactly once, so
 * `tokens.map(t => t.text).join('') === input` always holds.
 */
export function tokenize(input: string, config: ParserConfig, diagnostics: Diagnostic[]): Token[] {
  const chunks = scan(input, { operators: config.operators, negation: config.negation });
  const tokens: Token[] = [];
  let pos = 0;

  const push = (type: TokenType, start: number, end: number, field?: string): void => {
    if (end <= start) return;
    if (start > pos) push('whitespace', pos, start);
    const token: Token = { type, text: input.slice(start, end), start, end };
    if (field !== undefined) token.field = field;
    tokens.push(token);
    pos = end;
  };

  for (const chunk of chunks) {
    switch (chunk.kind) {
      case 'lparen':
      case 'rparen':
        push('paren', chunk.start, chunk.end);
        break;
      case 'stray':
        push('error', chunk.start, chunk.end);
        break;
      case 'keyword':
        push('keyword', chunk.start, chunk.end);
        break;
      case 'neg':
        push('negation', chunk.start, chunk.end);
        break;
      case 'word': {
        const key = chunk.key;
        const name = key ? resolveField(config, key.name) : undefined;
        if (!key || (name === undefined && (config.unknownFields === 'text' || isUrl(input, key)))) {
          push('text', chunk.start, chunk.end);
          break;
        }
        const field = name ?? key.name;
        push('field', key.start, key.end, field);
        push('colon', chunk.colon!, chunk.colon! + 1);
        if (chunk.op) push('operator', chunk.op.start, chunk.op.end, field);
        let c = 0;
        for (const item of chunk.items) {
          while (c < chunk.commas.length && chunk.commas[c]! < item.start) {
            push('separator', chunk.commas[c]!, chunk.commas[c]! + 1);
            c++;
          }
          push('value', item.start, item.end, field);
        }
        while (c < chunk.commas.length) {
          push('separator', chunk.commas[c]!, chunk.commas[c]! + 1);
          c++;
        }
        break;
      }
    }
  }
  if (pos < input.length) push('whitespace', pos, input.length);

  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) {
    // covered[k] = number of characters before offset k that some error spans.
    // Linear in the input size however many errors there are.
    const depth = new Array<number>(input.length + 1).fill(0);
    for (const d of errors) {
      depth[Math.max(0, d.start)]!++;
      depth[Math.min(input.length, d.end)]!--;
    }
    const covered = new Array<number>(input.length + 1);
    covered[0] = 0;
    let active = 0;
    for (let k = 0; k < input.length; k++) {
      active += depth[k]!;
      covered[k + 1] = covered[k]! + (active > 0 ? 1 : 0);
    }
    for (const token of tokens) {
      if (token.type !== 'whitespace' && covered[token.end]! - covered[token.start]! > 0) token.invalid = true;
    }
  }
  return tokens;
}

/* ------------------------------------------------------------------------ */
/* Autocomplete                                                              */
/* ------------------------------------------------------------------------ */

const DATE_SUGGESTIONS: Array<[string, string]> = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['7d', 'In the last 7 days'],
  ['30d', 'In the last 30 days'],
  ['3mo', 'In the last 3 months'],
  ['1y', 'In the last year'],
];

function candidatesFor(field: FieldDef, prefix: string): Array<[string, string | undefined]> {
  switch (field.type) {
    case 'enum':
      return field.values.map((v) => [v, undefined]);
    case 'boolean':
      return [
        ['true', undefined],
        ['false', undefined],
      ];
    case 'date':
      return DATE_SUGGESTIONS;
    case 'string': {
      const list = typeof field.suggestions === 'function' ? field.suggestions(prefix) : field.suggestions;
      return Array.isArray(list) ? list.filter((v) => typeof v === 'string').map((v) => [v, undefined]) : [];
    }
    default:
      return [];
  }
}

/** Orders candidates: prefix matches first, then substring matches. */
function rank<T>(entries: T[], text: (entry: T) => string[], prefix: string, diacritics: boolean): T[] {
  const needle = fold(prefix, false, diacritics);
  const starts: T[] = [];
  const contains: T[] = [];
  for (const entry of entries) {
    const hay = text(entry).map((s) => fold(s, false, diacritics));
    if (hay.some((h) => h.startsWith(needle))) starts.push(entry);
    else if (needle !== '' && hay.some((h) => h.indexOf(needle) !== -1)) contains.push(entry);
  }
  return starts.concat(contains);
}

const unquote = (s: string): string => (s.startsWith('"') ? s.slice(1).replace(/\\(["\\])/g, '$1') : s);

export function suggest(
  input: string,
  cursorArg: number | undefined,
  config: ParserConfig,
  diacritics: boolean,
  options: SuggestOptions = {},
): SuggestResult {
  const cursor = Math.max(0, Math.min(input.length, cursorArg === undefined ? input.length : Math.floor(cursorArg) || 0));
  const limit = typeof options.limit === 'number' && options.limit >= 0 ? Math.floor(options.limit) : 50;
  const chunks: Chunk[] = scan(input, { operators: config.operators, negation: config.negation });
  const word = chunks.find((c): c is WordChunk => c.kind === 'word' && c.start <= cursor && cursor <= c.end);

  const fieldSuggestions = (from: number, to: number, prefix: string): SuggestResult => {
    const entries = Object.keys(config.fields).map((name) => ({ name, def: config.fields[name]! }));
    const ranked = rank(entries, (e) => [e.name, ...(e.def.aliases ?? [])], prefix, diacritics);
    const items: Suggestion[] = ranked.map((e) => {
      const s: Suggestion = { label: e.name, insert: e.name + ':', kind: 'field' };
      if (e.def.description !== undefined) s.description = e.def.description;
      return s;
    });
    if (config.operators && prefix !== '' && prefix === prefix.toUpperCase()) {
      // An all-caps prefix ("O", "AN") most likely means a keyword: list those first.
      const keywords: Suggestion[] = ['AND', 'OR', 'NOT']
        .filter((kw) => kw.startsWith(prefix))
        .map((kw) => ({ label: kw, insert: kw, kind: 'keyword' }));
      items.unshift(...keywords);
    }
    return { context: 'field', from, to, prefix, items: items.slice(0, Math.max(0, limit)) };
  };

  if (!word) return fieldSuggestions(cursor, cursor, '');

  const key = word.key;
  if (!key || cursor <= key.end) {
    const first = input[word.start];
    if (!key && first === '"') return { context: 'none', from: cursor, to: cursor, prefix: '', items: [] };
    const to = key ? word.colon! + 1 : word.end;
    return fieldSuggestions(word.start, to, input.slice(word.start, cursor));
  }

  const name = resolveField(config, key.name);
  const valueStart = word.op ? word.op.end : word.colon! + 1;
  if (name === undefined) return { context: 'none', from: cursor, to: cursor, prefix: '', items: [] };
  const field = config.fields[name]!;

  if (cursor < valueStart) {
    // Cursor sits inside the comparison operator: offer values after it.
    return { context: 'value', field: name, from: valueStart, to: valueStart, prefix: '', items: [] };
  }

  let from = valueStart;
  let to = word.end;
  for (const comma of word.commas) {
    if (comma < cursor) from = comma + 1;
    else {
      to = comma;
      break;
    }
  }
  const typed = input.slice(from, cursor);
  const prefix = unquote(typed);

  const taken = new Set(
    word.items.filter((it) => it.end < from || it.start > to).map((it) => it.value.toLowerCase()),
  );
  const candidates = candidatesFor(field, prefix).filter(([v]) => !taken.has(v.toLowerCase()));
  const literal = field.type === 'string' || field.type === 'enum';
  const items: Suggestion[] = rank(candidates, (c) => [c[0]], prefix, diacritics).map(([v, description]) => {
    const s: Suggestion = { label: v, insert: formatValue(v, literal), kind: 'value' };
    if (description !== undefined) s.description = description;
    return s;
  });
  return { context: 'value', field: name, from, to, prefix: typed, items: items.slice(0, Math.max(0, limit)) };
}

/** Applies a suggestion; returns the new input and where the cursor should go. */
export function applySuggestion(
  input: string,
  result: Pick<SuggestResult, 'from' | 'to'>,
  suggestion: Pick<Suggestion, 'insert' | 'kind'>,
): { text: string; cursor: number } {
  const from = Math.max(0, Math.min(input.length, result.from));
  const to = Math.max(from, Math.min(input.length, result.to));
  let insert = suggestion.insert;
  const after = input.slice(to);
  if ((suggestion.kind === 'value' || suggestion.kind === 'keyword') && after === '') insert += ' ';
  return { text: input.slice(0, from) + insert + after, cursor: from + insert.length };
}
