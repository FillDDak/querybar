import type { DateContext } from './dates';
import { parse, resolveField, type ParserConfig } from './parser';
import { scan } from './scanner';
import { stringify } from './stringify';
import { safeRaw, fold, formatValue, isSpace } from './text';
import type {
  EditOptions,
  FieldDef,
  InputValue,
  MatchOptions,
  Node,
  ParseResult,
  RemoveOptions,
  TermNode,
  TermValue,
} from './types';

export interface EditConfig extends ParserConfig {
  ignoreDiacritics: boolean;
}

interface Conjunct {
  /** Index in the top-level list. */
  index: number;
  term: TermNode;
  negated: boolean;
  /** Removal extent, including a leading `-` and wrapping parentheses. */
  start: number;
  end: number;
}

function topLevel(ast: Node | null): Node[] {
  if (!ast) return [];
  return ast.type === 'and' ? ast.children : [ast];
}

/** Expands `start..end` over parentheses that wrap exactly this range. */
function expandParens(input: string, start: number, end: number): [number, number] {
  for (;;) {
    let s = start - 1;
    while (s >= 0 && isSpace(input[s])) s--;
    let e = end;
    while (e < input.length && isSpace(input[e])) e++;
    if (s >= 0 && input[s] === '(' && input[e] === ')') {
      start = s;
      end = e + 1;
    } else {
      return [start, end];
    }
  }
}

function conjuncts(result: ParseResult, field: string): Conjunct[] {
  const out: Conjunct[] = [];
  topLevel(result.ast).forEach((node, index) => {
    let term: TermNode | undefined;
    let negated = false;
    if (node.type === 'term') term = node;
    else if (node.type === 'not' && node.child.type === 'term') {
      term = node.child;
      negated = true;
    }
    if (!term || term.field !== field) return;
    const [start, end] = expandParens(result.input, negated ? node.start : term.start, negated ? node.end : term.end);
    out.push({ index, term, negated, start, end });
  });
  return out;
}

function rebuild(list: Node[], str: (node: Node | null) => string): string {
  if (list.length === 0) return '';
  if (list.length === 1) return str(list[0]!);
  return str({ type: 'and', children: list, start: 0, end: 0 });
}

/** Removes `start..end` and tidies the whitespace around it. */
function cut(input: string, start: number, end: number): string {
  let e = end;
  while (e < input.length && isSpace(input[e])) e++;
  // At the very start, or followed by whitespace and more content: drop the
  // whitespace after the removed text.
  if (start === 0 || (e > end && e < input.length)) return input.slice(0, start) + input.slice(e);
  // Otherwise (followed by `)` or the end of input) drop the whitespace before it.
  let s = start;
  while (s > 0 && isSpace(input[s - 1])) s--;
  return input.slice(0, s) + input.slice(e);
}

function sameValue(a: TermValue, b: TermValue, field: FieldDef, diacritics: boolean): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'exists':
      return true;
    case 'string': {
      const other = b as typeof a;
      const cs = field.type === 'string' && field.caseSensitive === true;
      const f = (s: string): string => fold(s, cs, diacritics);
      if (a.wildcard !== other.wildcard) return false;
      if (a.wildcard) return a.parts.length === other.parts.length && a.parts.every((p, i) => f(p) === f(other.parts[i]!));
      return f(a.value) === f(other.value);
    }
    case 'enum':
    case 'boolean':
    case 'number':
      return a.value === (b as typeof a).value;
    case 'number-range': {
      const other = b as typeof a;
      return a.min === other.min && a.max === other.max;
    }
    case 'date':
    case 'date-range': {
      const other = b as typeof a;
      return a.from === other.from && a.to === other.to;
    }
  }
}

export class Editor {
  private frozen: DateContext | undefined;
  private readonly parseConfig: ParserConfig;

  constructor(private readonly config: EditConfig) {
    this.parseConfig = { ...config, dates: () => this.frozen ?? config.dates() };
  }

  /**
   * Runs an operation with a single clock reading, so that relative dates
   * (`7d`) parsed at different moments of the same edit compare equal.
   */
  run<T>(fn: () => T): T {
    if (this.frozen) return fn();
    this.frozen = this.config.dates();
    try {
      return fn();
    } finally {
      this.frozen = undefined;
    }
  }

  private str(node: Node | null): string {
    return stringify(node, { negation: this.config.negation });
  }

  private parse(input: string): ParseResult {
    return parse(input, this.parseConfig);
  }

  private field(field: string): [string, FieldDef] {
    const name = resolveField(this.config, String(field));
    if (name === undefined) throw new Error(`querybar: unknown field "${field}".`);
    return [name, this.config.fields[name]!];
  }

  private formatInput(value: InputValue, def: FieldDef, raw: boolean): string {
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) throw new RangeError('querybar: invalid Date.');
      return value.toISOString();
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new RangeError(`querybar: ${value} is not a finite number.`);
      return String(value);
    }
    if (typeof value === 'boolean') return String(value);
    const text = String(value);
    if (raw) return text;
    return formatValue(text, def.type === 'string' || def.type === 'enum');
  }

  private termText(name: string, def: FieldDef, values: InputValue[], options: EditOptions): string {
    if (values.length === 0) throw new Error('querybar: at least one value is required.');
    const op = options.op && options.op !== '=' ? options.op : '';
    const body = values.map((v) => this.formatInput(v, def, options.raw === true)).join(',');
    return (options.negated ? '-' : '') + name + ':' + op + body;
  }

  /** Parses a standalone term written by us; returns its (possibly negated) node. */
  private termNode(text: string): Node {
    const result = this.parse(text);
    const error = result.diagnostics.find((d) => d.severity === 'error');
    if (error) throw new RangeError(`querybar: ${error.message}`);
    if (!result.ast) throw new Error(`querybar: could not build a term from "${text}".`);
    return result.ast;
  }

  private targets(name: string, def: FieldDef, values: InputValue[], raw: boolean): TermValue[] {
    const text = name + ':' + values.map((v) => this.formatInput(v, def, raw)).join(',');
    const ast = this.parse(text).ast;
    return ast && ast.type === 'term' ? ast.values : [];
  }

  /**
   * Returns `candidate` if it parses to the same query as `expected`;
   * otherwise the canonical text of `expected` (always well-formed).
   */
  private settle(candidate: string, expected: string): string {
    const actual = this.str(this.parse(candidate).ast);
    return actual === expected ? candidate : expected;
  }

  has(input: string, field: string, value: InputValue | undefined, options: MatchOptions): boolean {
    const [name, def] = this.field(field);
    const result = this.parse(input);
    const negated = options.negated === true;
    const op = options.op ?? '=';
    const list = conjuncts(result, name).filter(
      (c) => c.negated === negated && c.term.valid && (value === undefined || c.term.op === op),
    );
    if (value === undefined) return list.length > 0;
    const targets = this.targets(name, def, [value], false);
    if (targets.length === 0) return false;
    return list.some((c) => c.term.values.some((v) => targets.some((t) => sameValue(v, t, def, this.config.ignoreDiacritics))));
  }

  values(input: string, field: string): TermValue[] {
    const [name] = this.field(field);
    const result = this.parse(input);
    const out: TermValue[] = [];
    for (const c of conjuncts(result, name)) {
      if (!c.negated && c.term.valid && c.term.op === '=') out.push(...c.term.values);
    }
    return out;
  }

  add(input: string, field: string, value: InputValue | InputValue[], options: EditOptions & { combine?: 'and' | 'or' }): string {
    const [name, def] = this.field(field);
    const values = Array.isArray(value) ? value : [value];
    // Builds and validates the new term up front (throws on bad values).
    const text = this.termText(name, def, values, options);
    const node = this.termNode(text);
    const result = this.parse(input);
    const negated = options.negated === true;
    const targets = this.targets(name, def, values, options.raw === true);
    const op = options.op ?? '=';

    const same = (a: TermValue, b: TermValue): boolean => sameValue(a, b, def, this.config.ignoreDiacritics);
    const existing = conjuncts(result, name).filter((c) => c.negated === negated && c.term.valid && c.term.op === op);
    const list = topLevel(result.ast);

    if (options.combine === 'or' && op === '=' && existing.length > 0) {
      // Extend the existing list: `label:a` → `label:a,b`.
      const target = existing[existing.length - 1]!;
      const missing = values.filter((_, i) => !target.term.values.some((v) => same(v, targets[i]!)));
      if (missing.length === 0) return input;
      const extra = missing.map((v) => this.formatInput(v, def, options.raw === true)).join(',');
      const newTermText = safeRaw(target.term.raw) + ',' + extra;
      const candidate = input.slice(0, target.term.start) + newTermText + input.slice(target.term.end);
      const replaced = this.termNode(newTermText);
      const node = negated ? ({ type: 'not', child: replaced, start: 0, end: 0 } as Node) : replaced;
      const expectedList = list.slice();
      expectedList[target.index] = node;
      return this.settle(candidate, rebuild(expectedList, (n) => this.str(n)));
    }

    // Already present as exactly this term (same values, polarity and operator)?
    // Membership in a wider list (`label:a,b` when adding `label:b`) doesn't
    // count: adding narrows the results.
    const exact = existing.some(
      (c) =>
        c.term.values.every((v) => targets.some((t) => same(v, t))) &&
        targets.every((t) => c.term.values.some((v) => same(v, t))),
    );
    if (exact) return input;

    const expected = rebuild(list.concat([node]), (n) => this.str(n));

    // Textual append, closing anything left open so the new term stays separate.
    let base = input;
    if (result.diagnostics.some((d) => d.code === 'unterminated-quote')) base += '"';
    const unclosed = result.diagnostics.filter((d) => d.code === 'unclosed-paren').length;
    for (let k = 0; k < unclosed; k++) base += ')';
    if (base.trim() === '') return text;
    const join = (left: string): string => left + (isSpace(left[left.length - 1]) ? '' : ' ') + text;
    // Plain append when that already means "<query> AND <term>"; otherwise
    // wrap the query (e.g. `a OR b` → `(a OR b) term`); else canonical text.
    for (const candidate of [join(base), join('(' + base + ')')]) {
      if (this.str(this.parse(candidate).ast) === expected) return candidate;
    }
    return expected;
  }

  remove(input: string, field: string, value: InputValue | InputValue[] | undefined, options: RemoveOptions): string {
    const [name, def] = this.field(field);
    const values = value === undefined ? undefined : Array.isArray(value) ? value : [value];
    const targets = values ? this.targets(name, def, values, false) : undefined;
    if (values && targets!.length === 0) return input;

    let current = input;
    // Edit one conjunct at a time, re-parsing in between, so offsets stay exact.
    for (let guard = 0; guard < 1000; guard++) {
      const result = this.parse(current);
      const list = topLevel(result.ast);
      const op = options.op ?? '=';
      const candidates = conjuncts(result, name).filter(
        (c) =>
          (options.negated === undefined || c.negated === options.negated) && (!targets || c.term.op === op),
      );
      let changed = false;
      for (const c of candidates) {
        if (!targets) {
          const expected = rebuild(list.filter((_, i) => i !== c.index), (n) => this.str(n));
          current = this.settle(cut(current, c.start, c.end), expected);
          changed = true;
          break;
        }
        const matching = c.term.values.filter((v) =>
          targets.some((t) => sameValue(v, t, def, this.config.ignoreDiacritics)),
        );
        if (matching.length === 0) continue;
        const starts = new Set(matching.map((v) => v.start - c.term.start));
        const chunk = scan(c.term.raw, { operators: false, negation: false })[0];
        const items = chunk && chunk.kind === 'word' ? chunk.items : [];
        const kept = items.filter((it) => !starts.has(it.start)).map((it) => c.term.raw.slice(it.start, it.end));
        if (kept.length === 0) {
          const expected = rebuild(list.filter((_, i) => i !== c.index), (n) => this.str(n));
          current = this.settle(cut(current, c.start, c.end), expected);
        } else {
          const head = c.term.raw.slice(0, chunk && chunk.kind === 'word' && chunk.op ? chunk.op.end : c.term.key.length + 1);
          const newTermText = head + kept.join(',');
          // Lenient: invalid alternatives the user typed are kept as they are.
          const replaced = this.parse(newTermText).ast!;
          const expectedList = list.slice();
          expectedList[c.index] = c.negated ? ({ type: 'not', child: replaced, start: 0, end: 0 } as Node) : replaced;
          current = this.settle(
            current.slice(0, c.term.start) + newTermText + current.slice(c.term.end),
            rebuild(expectedList, (n) => this.str(n)),
          );
        }
        changed = true;
        break;
      }
      if (!changed) break;
    }
    return current;
  }

  set(input: string, field: string, value: InputValue | InputValue[] | null | undefined, options: EditOptions): string {
    const [name, def] = this.field(field);
    const negated = options.negated === true;
    if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
      return this.remove(input, field, undefined, { negated });
    }
    const values = Array.isArray(value) ? value : [value];
    const text = this.termText(name, def, values, options);
    const node = this.termNode(text);

    const result = this.parse(input);
    const matches = conjuncts(result, name).filter((c) => c.negated === negated);
    if (matches.length === 0) return this.add(input, field, values, options);

    // Replace the first occurrence in place, drop the others.
    const first = matches[0]!;
    if (this.str(node) === this.str(topLevel(result.ast)[first.index]!) && matches.length === 1) return input;
    let current = input.slice(0, first.start) + text + input.slice(first.end);
    const list = topLevel(result.ast).slice();
    list[first.index] = node;
    const drop = new Set(matches.slice(1).map((m) => m.index));
    const expected = rebuild(list.filter((_, i) => !drop.has(i)), (n) => this.str(n));
    // Remove the remaining duplicates (right to left keeps earlier offsets valid).
    const shift = text.length - (first.end - first.start);
    for (const m of matches.slice(1).reverse()) current = cut(current, m.start + shift, m.end + shift);
    return this.settle(current, expected);
  }

  toggle(input: string, field: string, value: InputValue, options: EditOptions & { combine?: 'and' | 'or' }): string {
    const match = { negated: options.negated === true, op: options.op };
    if (this.has(input, field, value, match)) return this.remove(input, field, value, match);
    return this.add(input, field, value, options);
  }
}

