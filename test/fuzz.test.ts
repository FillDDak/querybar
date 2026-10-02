import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createQuerybar, type Node } from '../src/index';
import { formatText, formatValue } from '../src/text';
import { issues, search } from './fixtures';

const RUNS = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.FUZZ_RUNS ?? 1500);

const pieces = [
  'is:open', 'is:closed', 'IS:Draft', 'is:', 'is:opne', 'label:bug', 'label:ui', 'label:"good first issue"',
  'label:bug,ui', 'label:*', 'label:', 'label:,', 'by:alice', 'author:al*', 'author:"al*"', 'author:zoe',
  'title:login', 'stars:>5', 'stars:<=12', 'stars:1..3', 'stars:..10', 'stars:abc', 'stars:-1', 'stars:1e1',
  'created:2024', 'created:2024-03', 'created:>=2024-01-10', 'created:7d', 'created:yesterday', 'created:2024..2023',
  'created:30d..2d', 'archived:yes', 'archived:false', 'sort:stars', 'foo:bar', 'http://x.io', 'a', 'b', 'login',
  'café', 'cafe', '한글', '하', 'OR', 'AND', 'NOT', 'or', '-', '!', '(', ')', '"', '\\', ',', '*', ':', '..', '>',
  '=', ' ', ' ', '  ', '\t', '\n', ' ', '"a b"', '"x\\"y"', '()', '-(', 'e-mail', '12:30', '\u{1F600}',
  'label:a)b', 'stars:5)', ')x', 'label:"x\\', 'label:x"', 'is:open"', '"\\', 'label:a*)', 'author:*',
];

const queryArb = fc.oneof(
  { weight: 4, arbitrary: fc.array(fc.constantFrom(...pieces), { maxLength: 14 }).map((a) => a.join('')) },
  { weight: 4, arbitrary: fc.array(fc.constantFrom(...pieces), { maxLength: 10 }).map((a) => a.join(' ')) },
  { weight: 1, arbitrary: fc.string({ maxLength: 40 }) },
  { weight: 1, arbitrary: fc.string({ unit: 'binary', maxLength: 30 }) },
);

const visit = (node: Node | null, fn: (n: Node) => void): void => {
  if (!node) return;
  fn(node);
  if (node.type === 'not') visit(node.child, fn);
  if (node.type === 'and' || node.type === 'or') node.children.forEach((c) => visit(c, fn));
};

const ids = (q: string): number[] => search.filter(issues, q).map((i) => i.id);

describe('fuzz: parser invariants', () => {
  it('never throws and produces consistent spans', () => {
    fc.assert(
      fc.property(queryArb, (q) => {
        const r = search.parse(q);
        expect(r.input).toBe(q);
        for (const d of r.diagnostics) {
          expect(d.start).toBeGreaterThanOrEqual(0);
          expect(d.end).toBeLessThanOrEqual(q.length);
          expect(d.start).toBeLessThanOrEqual(d.end);
          expect(typeof d.message).toBe('string');
        }
        visit(r.ast, (n) => {
          expect(n.start).toBeGreaterThanOrEqual(0);
          expect(n.end).toBeLessThanOrEqual(q.length);
          expect(n.start).toBeLessThanOrEqual(n.end);
          if (n.type === 'term') {
            expect(q.slice(n.start, n.end)).toBe(n.raw);
            for (const v of n.values) expect(q.slice(v.start, v.end)).toBe(v.raw);
          }
          if (n.type === 'and' || n.type === 'or') expect(n.children.length).toBeGreaterThan(1);
        });
        expect(r.valid).toBe(!r.diagnostics.some((d) => d.severity === 'error'));
      }),
      { numRuns: RUNS },
    );
  });

  it('tokens always cover the input exactly', () => {
    fc.assert(
      fc.property(queryArb, (q) => {
        const tokens = search.tokenize(q);
        expect(tokens.map((t) => t.text).join('')).toBe(q);
        let pos = 0;
        for (const t of tokens) {
          expect(t.start).toBe(pos);
          expect(t.end).toBeGreaterThan(t.start);
          if (t.type === 'whitespace') expect(t.text.trim()).toBe('');
          pos = t.end;
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('format is idempotent', () => {
    fc.assert(
      fc.property(queryArb, (q) => {
        const once = search.format(q);
        expect(search.format(once)).toBe(once);
      }),
      { numRuns: RUNS },
    );
  });

  it('format preserves meaning', () => {
    fc.assert(
      fc.property(queryArb, (q) => {
        expect(ids(search.format(q))).toEqual(ids(q));
      }),
      { numRuns: RUNS },
    );
  });

  it('formatting never introduces problems', () => {
    fc.assert(
      fc.property(queryArb, (q) => {
        const before = search.parse(q);
        const after = search.parse(search.format(q));
        // Same validity, and never more invalid terms than before.
        expect(after.valid).toBe(before.valid);
        expect(after.terms.filter((t) => !t.valid).length).toBe(before.terms.filter((t) => !t.valid).length);
        // Structural problems are repaired, never introduced.
        const structural = ['unterminated-quote', 'unmatched-paren', 'unclosed-paren', 'empty-group', 'dangling-operator'];
        expect(after.diagnostics.filter((d) => structural.indexOf(d.code) !== -1)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  it('suggest never throws at any cursor position', () => {
    fc.assert(
      fc.property(queryArb, fc.nat(), (q, n) => {
        const cursor = q.length === 0 ? 0 : n % (q.length + 1);
        const r = search.suggest(q, cursor);
        expect(r.from).toBeGreaterThanOrEqual(0);
        expect(r.to).toBeLessThanOrEqual(q.length);
        expect(r.from).toBeLessThanOrEqual(r.to);
        for (const item of r.items) {
          const applied = search.applySuggestion(q, r, item);
          expect(applied.cursor).toBeLessThanOrEqual(applied.text.length);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('accepted values always parse back to themselves', () => {
    const s = createQuerybar({ fields: { f: { type: 'string' } } });
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), (value) => {
        const term = s.parse('f:' + formatValue(value, true)).terms[0]!;
        expect(term.values).toHaveLength(1);
        expect(term.values[0]).toMatchObject({ kind: 'string', value, wildcard: false });
        const text = s.parse(formatText(value, false));
        if (value === '') return;
        expect(text.text.map((t) => t.value)).toEqual([value]);
        expect(text.terms).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });
});

describe('fuzz: other configurations', () => {
  const configs = [
    createQuerybar({ fields: { is: { type: 'enum', values: ['open', 'closed'] }, label: { type: 'string' } }, operators: false }),
    createQuerybar({ fields: { is: { type: 'enum', values: ['open', 'closed'] }, label: { type: 'string' } }, negation: false }),
    createQuerybar({
      fields: { is: { type: 'enum', values: ['open', 'closed'] }, label: { type: 'string' } },
      operators: false,
      negation: false,
      unknownFields: 'error',
    }),
  ];
  const rows = [
    { is: 'open', label: ['bug'], title: 'a (b)' },
    { is: 'closed', label: ['ui', 'bug'], title: 'OR -x' },
    { is: 'open', label: [], title: '!y "z"' },
  ];

  it('keep every invariant', () => {
    fc.assert(
      fc.property(queryArb, fc.constantFrom(0, 1, 2), fc.constantFrom('open', 'closed'), (q, k, value) => {
        const s = configs[k]!;
        const f = (query: string) => s.filter(rows, query);
        expect(s.tokenize(q).map((t) => t.text).join('')).toBe(q);
        const formatted = s.format(q);
        expect(s.format(formatted)).toBe(formatted);
        expect(f(formatted)).toEqual(f(q));
        const added = s.addFilter(q, 'is', value);
        expect(s.hasFilter(added, 'is', value)).toBe(true);
        expect(f(added)).toEqual(f(q).filter((r) => r.is === value));
        const removed = s.removeFilter(added, 'is');
        expect(s.hasFilter(removed, 'is')).toBe(false);
        expect(s.hasFilter(s.setFilter(q, 'label', 'x y'), 'label', 'x y')).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });
});

describe('fuzz: editing helpers', () => {
  const fieldValue = fc.constantFrom<[string, string | number | boolean]>(
    ['is', 'open'],
    ['is', 'closed'],
    ['label', 'bug'],
    ['label', 'ui'],
    ['label', 'good first issue'],
    ['label', 'a,b'],
    ['label', 'OR'],
    ['label', '"q"'],
    ['label', ')'],
    ['author', 'alice'],
    ['stars', 5],
    ['stars', -1.5],
    ['archived', true],
    ['created', '2024-03'],
  );

  const intersect = (a: number[], b: number[]) => a.filter((x) => b.indexOf(x) !== -1);
  const termIds = (field: string, value: unknown, negated = false) =>
    ids(search.addFilter('', field, value as string, { negated }));

  it('addFilter means "AND the new term" and keeps the query parseable', () => {
    fc.assert(
      fc.property(queryArb, fieldValue, fc.boolean(), (q, [field, value], negated) => {
        const out = search.addFilter(q, field, value, { negated });
        expect(search.hasFilter(out, field, value, { negated })).toBe(true);
        expect(ids(out)).toEqual(intersect(ids(q), termIds(field, value, negated)));
      }),
      { numRuns: RUNS },
    );
  });

  it('removeFilter removes every top-level occurrence and nothing else', () => {
    fc.assert(
      fc.property(queryArb, fieldValue, (q, [field, value]) => {
        const all = search.removeFilter(q, field);
        expect(search.hasFilter(all, field)).toBe(false);
        expect(search.hasFilter(all, field, undefined, { negated: true })).toBe(false);
        const one = search.removeFilter(q, field, value);
        expect(search.hasFilter(one, field, value)).toBe(false);
        expect(search.hasFilter(one, field, value, { negated: true })).toBe(false);
        // Other fields' top-level terms are untouched.
        for (const other of ['is', 'label', 'stars']) {
          if (other === field) continue;
          expect(search.getValues(one, other).map((v) => v.raw)).toEqual(search.getValues(q, other).map((v) => v.raw));
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('setFilter leaves exactly the requested value', () => {
    fc.assert(
      fc.property(queryArb, fieldValue, (q, [field, value]) => {
        const out = search.setFilter(q, field, value);
        const values = search.getValues(out, field);
        expect(values).toHaveLength(1);
        expect(search.hasFilter(out, field, value)).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it('toggling twice restores the meaning of a query without the value', () => {
    fc.assert(
      fc.property(queryArb, fieldValue, (q, [field, value]) => {
        const base = search.removeFilter(q, field, value);
        const twice = search.toggleFilter(search.toggleFilter(base, field, value), field, value);
        expect(ids(twice)).toEqual(ids(base));
        expect(search.hasFilter(twice, field, value)).toBe(false);
      }),
      { numRuns: RUNS },
    );
  });
});
