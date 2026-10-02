import { isSpace } from './text';
import type { Operator, Span } from './types';

/** One comma-separated piece of a value, or a whole free-text word. */
export interface Item extends Span {
  /** Unescaped value, with quotes removed. */
  value: string;
  /** Literal pieces between unquoted `*` wildcards (length 1 when none). */
  parts: string[];
  /** Any part of the item was quoted. */
  quoted: boolean;
  /** A quote was opened but never closed. */
  unterminated: boolean;
}

export interface WordChunk extends Span {
  kind: 'word';
  /** Present when the word looks like `key:...`. */
  key?: Span & { name: string };
  /** Offset of the `:` after the key. */
  colon?: number;
  op?: Span & { value: Operator };
  /** Comma separated items for `key:` words; a single item for free text. */
  items: Item[];
  /** Offsets of the commas between items. */
  commas: number[];
}

export type Chunk =
  | (Span & { kind: 'lparen' })
  | (Span & { kind: 'rparen' })
  | (Span & { kind: 'stray' })
  | (Span & { kind: 'keyword'; value: 'AND' | 'OR' | 'NOT' })
  | (Span & { kind: 'neg'; attached: boolean })
  | WordChunk;

export interface ScanOptions {
  operators: boolean;
  negation: boolean;
}

/** Maximum parenthesis nesting; deeper `(` are read as text. */
export const MAX_DEPTH = 100;

const KEY = /[\p{L}_][\p{L}\p{N}_.-]*:/uy;
const KEYWORD = /(AND|OR|NOT)(?=[\s()]|$)/y;
const OPERATOR = />=|<=|>|<|=/y;

function matchAt(re: RegExp, input: string, pos: number): RegExpExecArray | null {
  re.lastIndex = pos;
  return re.exec(input);
}

/**
 * Splits a query into chunks. Never throws: every character of the input ends
 * up in exactly one chunk or in the whitespace between chunks.
 */
export function scan(input: string, options: ScanOptions): Chunk[] {
  const chunks: Chunk[] = [];
  const len = input.length;
  let pos = 0;
  let depth = 0;

  /** Does `ch` end a bare run of characters? */
  const ends = (ch: string | undefined, commas: boolean): boolean =>
    ch === undefined ||
    isSpace(ch) ||
    ch === '"' ||
    (commas && ch === ',') ||
    (options.operators && depth > 0 && ch === ')');

  const readItem = (commas: boolean): Item => {
    const start = pos;
    let value = '';
    let current = '';
    const parts: string[] = [];
    let quoted = false;
    let unterminated = false;
    for (;;) {
      const ch = input[pos];
      if (ch === '"') {
        quoted = true;
        pos++;
        let closed = false;
        while (pos < len) {
          const c = input[pos]!;
          if (c === '\\' && (input[pos + 1] === '"' || input[pos + 1] === '\\')) {
            value += input[pos + 1];
            current += input[pos + 1];
            pos += 2;
          } else if (c === '"') {
            pos++;
            closed = true;
            break;
          } else {
            value += c;
            current += c;
            pos++;
          }
        }
        if (!closed) {
          unterminated = true;
          break;
        }
        continue;
      }
      if (ends(ch, commas)) break;
      if (ch === '*') {
        parts.push(current);
        current = '';
      } else {
        current += ch;
      }
      value += ch;
      pos++;
    }
    parts.push(current);
    return { start, end: pos, value, parts, quoted, unterminated };
  };

  while (pos < len) {
    const ch = input[pos]!;
    if (isSpace(ch)) {
      pos++;
      continue;
    }

    if (options.operators) {
      // Beyond MAX_DEPTH a `(` is ordinary text, so recursion stays bounded.
      if (ch === '(' && depth < MAX_DEPTH) {
        chunks.push({ kind: 'lparen', start: pos, end: pos + 1 });
        depth++;
        pos++;
        continue;
      }
      if (ch === ')') {
        if (depth > 0) {
          chunks.push({ kind: 'rparen', start: pos, end: pos + 1 });
          depth--;
          pos++;
          continue;
        }
        if (ends(input[pos + 1], false)) {
          chunks.push({ kind: 'stray', start: pos, end: pos + 1 });
          pos++;
          continue;
        }
        // `)foo` at top level: an ordinary word that happens to start with `)`.
      }
      const kw = matchAt(KEYWORD, input, pos);
      if (kw) {
        chunks.push({ kind: 'keyword', value: kw[1] as 'AND' | 'OR' | 'NOT', start: pos, end: pos + kw[0].length });
        pos += kw[0].length;
        continue;
      }
    }

    if (options.negation && (ch === '-' || ch === '!')) {
      const next = input[pos + 1];
      const attached =
        next !== undefined &&
        !isSpace(next) &&
        !(options.operators && next === ')' && depth > 0);
      chunks.push({ kind: 'neg', attached, start: pos, end: pos + 1 });
      pos++;
      if (attached && options.operators && next === '(') continue;
      if (!attached) continue;
    }

    // A word: `key:items` or free text.
    const start = pos;
    const key = matchAt(KEY, input, pos);
    if (key) {
      const name = key[0].slice(0, -1);
      const chunk: WordChunk = {
        kind: 'word',
        start,
        end: start,
        key: { name, start, end: start + name.length },
        colon: start + name.length,
        items: [],
        commas: [],
      };
      pos += key[0].length;
      const op = matchAt(OPERATOR, input, pos);
      if (op) {
        chunk.op = { value: op[0] as Operator, start: pos, end: pos + op[0].length };
        pos += op[0].length;
      }
      for (;;) {
        const item = readItem(true);
        if (item.end > item.start) chunk.items.push(item);
        if (input[pos] === ',' && !item.unterminated) {
          chunk.commas.push(pos);
          pos++;
          continue;
        }
        break;
      }
      chunk.end = pos;
      chunks.push(chunk);
      continue;
    }

    const item = readItem(false);
    if (item.end === item.start) {
      // Defensive: never stall on a character no rule consumed.
      pos++;
      item.end = pos;
      item.value = input.slice(item.start, pos);
      item.parts = [item.value];
    }
    chunks.push({ kind: 'word', start, end: item.end, items: [item], commas: [] });
  }

  return chunks;
}
