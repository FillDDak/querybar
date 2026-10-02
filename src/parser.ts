import type { DateContext } from './dates';
import { scan, type Chunk, type WordChunk } from './scanner';
import { closest } from './text';
import type { Diagnostic, FieldDef, Node, ParseResult, Span, TermNode, TermValue, TextNode } from './types';
import { convertItem, isConvertError } from './values';

export interface ParserConfig {
  fields: Record<string, FieldDef>;
  /** Lower-cased name or alias → canonical field name. */
  lookup: Map<string, string>;
  /** Field names and aliases as declared (for "did you mean"). */
  names: string[];
  unknownFields: 'text' | 'error';
  operators: boolean;
  negation: boolean;
  dates: () => DateContext;
}

export function resolveField(config: ParserConfig, key: string): string | undefined {
  return config.lookup.get(key.toLowerCase());
}

/** `scheme://…` after an unknown key is a URL rather than a qualifier. */
export function isUrl(input: string, key: Span): boolean {
  return input.startsWith('//', key.end + 1);
}

interface Parsed {
  node: Node;
  start: number;
  end: number;
}

export function parse(rawInput: unknown, config: ParserConfig): ParseResult {
  const input = typeof rawInput === 'string' ? rawInput : rawInput == null ? '' : String(rawInput);
  const chunks = scan(input, { operators: config.operators, negation: config.negation });
  const diagnostics: Diagnostic[] = [];
  let dates: DateContext | undefined;
  let i = 0;

  const peek = (): Chunk | undefined => chunks[i];
  const isKeyword = (c: Chunk | undefined, value: string): boolean =>
    c !== undefined && c.kind === 'keyword' && c.value === value;
  const isNegation = (c: Chunk | undefined): boolean =>
    c !== undefined && ((c.kind === 'keyword' && c.value === 'NOT') || (c.kind === 'neg' && c.attached));
  /** Tokens that end an AND sequence. */
  const endsAnd = (c: Chunk | undefined): boolean => c === undefined || c.kind === 'rparen' || isKeyword(c, 'OR');

  const report = (d: Diagnostic): void => {
    diagnostics.push(d);
  };

  const term = (chunk: WordChunk): Node | null => {
    const key = chunk.key!;
    const name = resolveField(config, key.name);
    const op = chunk.op?.value ?? '=';
    const base = { start: chunk.start, end: chunk.end, raw: input.slice(chunk.start, chunk.end) };

    if (name === undefined) {
      const value = key.name + ':' + (chunk.op ? chunk.op.value : '') + chunk.items.map((it) => it.value).join(',');
      const quoted = chunk.items.some((it) => it.quoted);
      // `https://…`, `ftp://…`: a URL, not a mistyped field.
      if (isUrl(input, key)) return { type: 'text', value, quoted, start: chunk.start, end: chunk.end };
      const suggestion = closest(key.name, config.names);
      if (config.unknownFields === 'error') {
        report({
          code: 'unknown-field',
          severity: 'error',
          message: `Unknown field "${key.name}".` + (suggestion ? ` Did you mean "${suggestion}"?` : ''),
          start: key.start,
          end: key.end,
          field: key.name,
          suggestion,
        });
        return { type: 'term', field: key.name, key: key.name, op, values: [], valid: false, ...base };
      }
      report({
        code: 'unknown-field',
        severity: 'warning',
        message:
          `Unknown field "${key.name}"; searching it as text.` + (suggestion ? ` Did you mean "${suggestion}"?` : ''),
        start: key.start,
        end: key.end,
        field: key.name,
        suggestion,
      });
      return { type: 'text', value, quoted, start: chunk.start, end: chunk.end };
    }

    const field = config.fields[name]!;
    const node: TermNode = { type: 'term', field: name, key: key.name, op, values: [], valid: true, ...base };

    for (const item of chunk.items) {
      if (item.unterminated) {
        report({
          code: 'unterminated-quote',
          severity: 'warning',
          message: 'Missing closing quote.',
          start: item.start,
          end: item.end,
          field: name,
        });
      }
    }

    if (chunk.items.length === 0) {
      node.valid = false;
      report({
        code: 'missing-value',
        severity: 'error',
        message: `Field "${name}" needs a value.`,
        start: chunk.start,
        end: chunk.end,
        field: name,
      });
      return node;
    }

    dates = dates ?? config.dates();
    const listed = chunk.items.length > 1;
    for (const item of chunk.items) {
      const raw = input.slice(item.start, item.end);
      const converted = convertItem(item, raw, name, field, op, listed, dates);
      if (isConvertError(converted)) {
        node.valid = false;
        report({
          code: converted.code,
          severity: 'error',
          message: converted.message,
          start: converted.code === 'invalid-operator' && chunk.op && !listed ? chunk.op.start : item.start,
          end: item.end,
          field: name,
          suggestion: converted.suggestion,
        });
      } else {
        node.values.push(converted as TermValue);
      }
    }
    return node;
  };

  const word = (chunk: WordChunk): Node | null => {
    if (chunk.key) return term(chunk);
    const item = chunk.items[0]!;
    if (item.unterminated) {
      report({
        code: 'unterminated-quote',
        severity: 'warning',
        message: 'Missing closing quote.',
        start: item.start,
        end: item.end,
      });
    }
    const node: TextNode = { type: 'text', value: item.value, quoted: item.quoted, start: chunk.start, end: chunk.end };
    return node;
  };

  const combine = (type: 'and' | 'or', items: Parsed[]): Parsed | null => {
    if (items.length === 0) return null;
    if (items.length === 1) return items[0]!;
    const children: Node[] = [];
    for (const it of items) {
      if (it.node.type === type) children.push(...(it.node as { children: Node[] }).children);
      else children.push(it.node);
    }
    const start = items[0]!.start;
    const end = items[items.length - 1]!.end;
    return { node: { type, children, start, end } as Node, start, end };
  };

  const dangling = (c: Chunk, what: string): void => {
    report({
      code: 'dangling-operator',
      severity: 'warning',
      message: `"${what}" is missing an operand and was ignored.`,
      start: c.start,
      end: c.end,
    });
  };

  function parseUnary(): Parsed | null {
    const c = peek();
    if (c === undefined || c.kind === 'rparen' || (c.kind === 'keyword' && c.value !== 'NOT')) return null;

    if (isNegation(c)) {
      // Collect the whole chain iteratively (`NOT NOT -x`) so that long chains
      // can't exhaust the stack.
      const chain: Chunk[] = [];
      while (isNegation(peek())) chain.push(chunks[i++]!);
      const operand = parseUnary();
      if (!operand) {
        const last = chain[chain.length - 1]!;
        dangling(last, last.kind === 'neg' ? input.slice(last.start, last.end) : 'NOT');
        // The rest of the chain negates nothing either; it's simply dropped.
        return null;
      }
      // More than two negations only matter by parity.
      const count = chain.length <= 2 ? chain.length : 2 - (chain.length % 2);
      let result: Parsed = operand;
      for (let k = chain.length - 1; k >= chain.length - count; k--) {
        const start = chain[k]!.start;
        result = { node: { type: 'not', child: result.node, start, end: operand.end }, start, end: operand.end };
      }
      // Keep the span of the full chain.
      result.node.start = result.start = chain[0]!.start;
      return result;
    }

    if (c.kind === 'neg') {
      i++;
      dangling(c, input.slice(c.start, c.end));
      return null;
    }

    if (c.kind === 'stray') {
      i++;
      report({
        code: 'unmatched-paren',
        severity: 'warning',
        message: 'Unmatched ")" was ignored.',
        start: c.start,
        end: c.end,
      });
      return null;
    }

    if (c.kind === 'lparen') {
      i++;
      const inner = parseOr();
      const close = peek();
      let end: number;
      if (close && close.kind === 'rparen') {
        i++;
        end = close.end;
      } else {
        end = inner ? inner.end : c.end;
        report({
          code: 'unclosed-paren',
          severity: 'warning',
          message: 'Missing closing ")".',
          start: c.start,
          end: c.end,
        });
      }
      if (!inner) {
        report({
          code: 'empty-group',
          severity: 'warning',
          message: 'Empty group "()" was ignored.',
          start: c.start,
          end,
        });
        return null;
      }
      // Node spans cover content only; the parenthesised extent travels separately
      // so that enclosing `not` / `and` / `or` spans include the parentheses.
      return { node: inner.node, start: c.start, end };
    }

    i++;
    if (c.kind !== 'word') return null;
    const node = word(c);
    return node ? { node, start: node.start, end: node.end } : null;
  }

  function parseAnd(): Parsed | null {
    const items: Parsed[] = [];
    for (;;) {
      const c = peek();
      if (endsAnd(c)) break;
      if (isKeyword(c, 'AND')) {
        i++;
        const next = peek();
        if (items.length === 0 || endsAnd(next) || isKeyword(next, 'AND')) dangling(c!, 'AND');
        continue;
      }
      const before = i;
      const parsed = parseUnary();
      if (parsed) items.push(parsed);
      if (i === before) i++; // Defensive: always make progress.
    }
    return combine('and', items);
  }

  function parseOr(): Parsed | null {
    const items: Parsed[] = [];
    const first = parseAnd();
    if (first) items.push(first);
    while (isKeyword(peek(), 'OR')) {
      const orChunk = peek()!;
      i++;
      const next = parseAnd();
      if (!next || items.length === 0) dangling(orChunk, 'OR');
      if (next) items.push(next);
    }
    return combine('or', items);
  }

  const root = parseOr();
  // Anything left over can only be unmatched closing parens; parseUnary reports them.
  while (i < chunks.length) {
    const before = i;
    parseUnary();
    if (i === before) i++;
  }

  const ast = root ? root.node : null;
  const terms: TermNode[] = [];
  const text: TextNode[] = [];
  let conjunctive = true;
  const walk = (node: Node): void => {
    switch (node.type) {
      case 'term':
        terms.push(node);
        break;
      case 'text':
        text.push(node);
        break;
      case 'not':
        walk(node.child);
        break;
      case 'or':
        conjunctive = false;
        node.children.forEach(walk);
        break;
      case 'and':
        node.children.forEach(walk);
        break;
    }
  };
  if (ast) walk(ast);
  // `-(a b)` is a NAND — not a plain conjunction either.
  const plain = (node: Node | null, negated: boolean): boolean => {
    if (!node) return true;
    if (node.type === 'and') return !negated && node.children.every((c) => plain(c, false));
    if (node.type === 'not') return !negated && plain(node.child, true);
    if (node.type === 'or') return false;
    return true;
  };
  conjunctive = conjunctive && plain(ast, false);

  diagnostics.sort((a, b) => a.start - b.start || a.end - b.end);
  return {
    input,
    ast,
    diagnostics,
    valid: !diagnostics.some((d) => d.severity === 'error'),
    terms,
    text,
    conjunctive,
  };
}
