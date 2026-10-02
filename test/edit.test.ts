import { describe, expect, it } from 'vitest';
import { createQuerybar } from '../src/index';
import { search } from './fixtures';

describe('hasFilter', () => {
  it('checks top-level positive terms', () => {
    expect(search.hasFilter('is:open', 'is')).toBe(true);
    expect(search.hasFilter('is:open', 'is', 'open')).toBe(true);
    expect(search.hasFilter('is:open', 'is', 'OPEN')).toBe(true);
    expect(search.hasFilter('is:open', 'is', 'closed')).toBe(false);
    expect(search.hasFilter('label:bug,ui', 'label', 'ui')).toBe(true);
    expect(search.hasFilter('by:alice', 'author', 'alice')).toBe(true);
    expect(search.hasFilter('author:alice', 'by', 'Alice')).toBe(true);
    expect(search.hasFilter('author:Zoë', 'author', 'zoe')).toBe(true);
  });

  it('distinguishes negated terms', () => {
    expect(search.hasFilter('-label:bug', 'label', 'bug')).toBe(false);
    expect(search.hasFilter('-label:bug', 'label', 'bug', { negated: true })).toBe(true);
  });

  it('ignores terms nested in OR groups or invalid terms', () => {
    expect(search.hasFilter('label:bug OR x', 'label', 'bug')).toBe(false);
    expect(search.hasFilter('(label:bug OR x) y', 'label', 'bug')).toBe(false);
    expect(search.hasFilter('(label:bug) y', 'label', 'bug')).toBe(true);
    expect(search.hasFilter('stars:abc', 'stars')).toBe(false);
  });

  it('compares typed values', () => {
    expect(search.hasFilter('stars:10', 'stars', 10)).toBe(true);
    expect(search.hasFilter('stars:10.0', 'stars', 10)).toBe(true);
    expect(search.hasFilter('archived:yes', 'archived', true)).toBe(true);
    expect(search.hasFilter('created:2024-05-01', 'created', '2024-05-01')).toBe(true);
    expect(search.hasFilter('stars:1..5', 'stars', '1..5')).toBe(true);
    expect(search.hasFilter('stars:10', 'stars', 'nope')).toBe(false);
  });

  it('respects the operator when a value is given', () => {
    expect(search.hasFilter('stars:>5', 'stars', 5)).toBe(false);
    expect(search.hasFilter('stars:>5', 'stars', 5, { op: '>' })).toBe(true);
    expect(search.hasFilter('stars:>5', 'stars')).toBe(true);
    expect(search.removeFilter('stars:>5 stars:5', 'stars', 5)).toBe('stars:>5');
    expect(search.removeFilter('stars:>5 stars:5', 'stars', 5, { op: '>' })).toBe('stars:5');
    expect(search.removeFilter('stars:>5 stars:5', 'stars')).toBe('');
    expect(search.toggleFilter('stars:>5', 'stars', 5, { op: '>' })).toBe('');
    expect(search.toggleFilter('stars:>5', 'stars', 5)).toBe('stars:>5 stars:5');
  });

  it('throws for unknown fields', () => {
    expect(() => search.hasFilter('', 'nope')).toThrow(/unknown field "nope"/);
  });
});

describe('relative dates in edits', () => {
  it('uses one clock reading per operation', () => {
    let tick = Date.UTC(2024, 0, 1);
    const s = createQuerybar({ fields: { created: { type: 'date' } }, now: () => tick++ });
    expect(s.hasFilter('created:7d', 'created', '7d')).toBe(true);
    expect(s.addFilter('created:7d', 'created', '7d')).toBe('created:7d');
    expect(s.removeFilter('created:7d x', 'created', '7d')).toBe('x');
    expect(s.toggleFilter('created:7d', 'created', '7d')).toBe('');
    expect(s.setFilter('created:7d', 'created', '7d')).toBe('created:7d');
  });
});

describe('getValues', () => {
  it('returns typed values of top-level positive terms', () => {
    const v = search.getValues('sort:stars is:open is:closed -is:draft (is:x OR y)', 'is');
    expect(v.map((x) => x.kind === 'enum' && x.value)).toEqual(['open', 'closed']);
    const sort = search.getValues('sort:stars', 'sort')[0];
    expect(sort?.kind === 'enum' && sort.value).toBe('stars');
    expect(search.getValues('', 'sort')).toEqual([]);
    expect(search.getValues('stars:>5 stars:3', 'stars').map((x) => x.raw)).toEqual(['3']);
  });
});

describe('addFilter', () => {
  it.each([
    ['', 'is', 'open', 'is:open'],
    ['   ', 'is', 'open', 'is:open'],
    ['bug', 'is', 'open', 'bug is:open'],
    ['bug ', 'is', 'open', 'bug is:open'],
    ['bug', 'label', 'good first issue', 'bug label:"good first issue"'],
    ['bug', 'label', 'a*', 'bug label:"a*"'],
    ['bug', 'label', '>x', 'bug label:">x"'],
    ['bug', 'label', '', 'bug label:""'],
    ['bug', 'stars', 5, 'bug stars:5'],
    ['bug', 'archived', true, 'bug archived:true'],
    ['bug', 'by', 'alice', 'bug author:alice'],
  ])('addFilter(%j, %j, %j) = %j', (input, field, value, out) => {
    expect(search.addFilter(input, field, value)).toBe(out);
  });

  it('does not duplicate existing filters', () => {
    expect(search.addFilter('is:open', 'is', 'open')).toBe('is:open');
    expect(search.addFilter('IS:OPEN', 'is', 'open')).toBe('IS:OPEN');
    expect(search.addFilter('label:a,b', 'label', ['b', 'a'])).toBe('label:a,b');
    expect(search.addFilter('label:b x', 'label', 'B')).toBe('label:b x');
    // Being one alternative of a list is not the same filter: adding narrows.
    expect(search.addFilter('label:a,b', 'label', 'b')).toBe('label:a,b label:b');
    expect(search.addFilter('-label:a', 'label', 'a')).toBe('-label:a label:a');
    expect(search.addFilter('stars:>5', 'stars', 5)).toBe('stars:>5 stars:5');
  });

  it('supports negation, operators and raw values', () => {
    expect(search.addFilter('x', 'label', 'bug', { negated: true })).toBe('x -label:bug');
    expect(search.addFilter('x', 'stars', 10, { op: '>=' })).toBe('x stars:>=10');
    expect(search.addFilter('x', 'author', 'al*', { raw: true })).toBe('x author:al*');
    expect(search.addFilter('x', 'stars', '10..20')).toBe('x stars:10..20');
    expect(search.addFilter('x', 'label', ['a', 'b c'])).toBe('x label:a,"b c"');
    expect(search.addFilter('x', 'created', new Date(Date.UTC(2024, 0, 2)))).toBe(
      'x created:2024-01-02T00:00:00.000Z',
    );
  });

  it('keeps OR queries intact by wrapping them', () => {
    expect(search.addFilter('a OR b', 'is', 'open')).toBe('(a OR b) is:open');
    expect(search.addFilter('(a OR b) c', 'is', 'open')).toBe('(a OR b) c is:open');
  });

  it('closes open quotes and parentheses first', () => {
    expect(search.addFilter('"abc', 'is', 'open')).toBe('"abc" is:open');
    expect(search.addFilter('(a b', 'is', 'open')).toBe('(a b) is:open');
    expect(search.addFilter('(a OR b', 'is', 'open')).toBe('(a OR b) is:open');
    expect(search.addFilter('((a', 'is', 'open')).toBe('((a)) is:open');
  });

  it('never lets a trailing operator capture the new term', () => {
    const cases = ['a OR', 'a NOT', 'a AND', 'a -', 'NOT', 'x )', 'x )y'];
    for (const q of cases) {
      const out = search.addFilter(q, 'is', 'open');
      expect(search.hasFilter(out, 'is', 'open'), `${q} -> ${out}`).toBe(true);
      const top = search.parse(out).ast!;
      const children = top.type === 'and' ? top.children : [top];
      expect(children[children.length - 1]).toMatchObject({ type: 'term', field: 'is' });
    }
  });

  it('can extend an existing list with combine: "or"', () => {
    expect(search.addFilter('label:bug x', 'label', 'ui', { combine: 'or' })).toBe('label:bug,ui x');
    expect(search.addFilter('by:bob', 'author', 'alice', { combine: 'or' })).toBe('by:bob,alice');
    expect(search.addFilter('x', 'label', 'ui', { combine: 'or' })).toBe('x label:ui');
    expect(search.addFilter('-label:a', 'label', 'b', { combine: 'or', negated: true })).toBe('-label:a,b');
    expect(search.addFilter('label:a', 'label', ['a', 'b'], { combine: 'or' })).toBe('label:a,b');
  });

  it('rejects values the field cannot accept', () => {
    expect(() => search.addFilter('', 'stars', 'abc')).toThrow(RangeError);
    expect(() => search.addFilter('', 'is', 'nope')).toThrow(/Expected one of/);
    expect(() => search.addFilter('', 'stars', NaN)).toThrow(RangeError);
    expect(() => search.addFilter('', 'created', new Date(NaN))).toThrow(RangeError);
    expect(() => search.addFilter('', 'label', [])).toThrow();
    expect(() => search.addFilter('', 'nope', 'x')).toThrow(/unknown field/);
  });
});

describe('removeFilter', () => {
  it.each([
    ['is:open', 'is', undefined, ''],
    ['is:open bug', 'is', undefined, 'bug'],
    ['bug is:open', 'is', undefined, 'bug'],
    ['a is:open b', 'is', undefined, 'a b'],
    ['a  is:open  b', 'is', undefined, 'a  b'],
    ['is:open is:closed x', 'is', undefined, 'x'],
    ['-is:open x', 'is', undefined, 'x'],
    ['(is:open) x', 'is', undefined, 'x'],
    ['x (is:open)', 'is', undefined, 'x'],
    ['(x is:open)', 'is', undefined, '(x)'],
    ['label:a,b,c', 'label', 'b', 'label:a,c'],
    ['label:a,b,c', 'label', 'a', 'label:b,c'],
    ['label:a,b,c', 'label', 'c', 'label:a,b'],
    ['label:a,"b c",d', 'label', 'b c', 'label:a,d'],
    ['label:a x', 'label', 'a', 'x'],
    ['label:a label:b', 'label', 'b', 'label:a'],
    ['label:a,a', 'label', 'a', ''],
    ['by:alice', 'author', 'ALICE', ''],
    ['is:open', 'is', 'closed', 'is:open'],
    ['', 'is', undefined, ''],
    ['label:x OR is:open', 'is', undefined, 'label:x OR is:open'],
  ])('removeFilter(%j, %j, %j) = %j', (input, field, value, out) => {
    expect(search.removeFilter(input, field, value)).toBe(out);
  });

  it('respects the negated option', () => {
    expect(search.removeFilter('label:a -label:b', 'label', undefined, { negated: true })).toBe('label:a');
    expect(search.removeFilter('label:a -label:b', 'label', undefined, { negated: false })).toBe('-label:b');
    expect(search.removeFilter('label:a -label:b', 'label')).toBe('');
    expect(search.removeFilter('-label:a,b', 'label', 'a')).toBe('-label:b');
  });

  it('keeps invalid alternatives when removing a value from a list', () => {
    expect(search.removeFilter('stars:1,x,2', 'stars', 1)).toBe('stars:x,2');
  });

  it('removes several values at once', () => {
    expect(search.removeFilter('label:a,b,c', 'label', ['a', 'c'])).toBe('label:b');
  });

  it('removes negated groups like -(is:open)', () => {
    expect(search.removeFilter('x -(is:open)', 'is')).toBe('x');
  });
});

describe('setFilter', () => {
  it.each([
    ['', 'is', 'open', 'is:open'],
    ['x', 'is', 'open', 'x is:open'],
    ['is:closed x', 'is', 'open', 'is:open x'],
    ['a is:closed b is:draft c', 'is', 'open', 'a is:open b c'],
    ['is:open', 'is', 'open', 'is:open'],
    ['sort:stars', 'sort', 'created-desc', 'sort:created-desc'],
    ['label:x', 'label', ['a', 'b'], 'label:a,b'],
    ['is:open x', 'is', null, 'x'],
    ['is:open x', 'is', [], 'x'],
    ['-is:open', 'is', 'closed', '-is:open is:closed'],
  ])('setFilter(%j, %j, %j) = %j', (input, field, value, out) => {
    expect(search.setFilter(input, field, value as never)).toBe(out);
  });

  it('supports operators and negation', () => {
    expect(search.setFilter('stars:>1 x', 'stars', 10, { op: '>=' })).toBe('stars:>=10 x');
    expect(search.setFilter('-label:a x', 'label', 'b', { negated: true })).toBe('-label:b x');
    expect(search.setFilter('x', 'label', 'b', { negated: true })).toBe('x -label:b');
  });

  it('replaces terms wrapped in parentheses', () => {
    expect(search.setFilter('(is:closed) x', 'is', 'open')).toBe('is:open x');
  });
});

describe('toggleFilter', () => {
  it('adds then removes', () => {
    let q = 'bug';
    q = search.toggleFilter(q, 'label', 'ui');
    expect(q).toBe('bug label:ui');
    q = search.toggleFilter(q, 'label', 'ui');
    expect(q).toBe('bug');
  });

  it('removes a single value from a list', () => {
    expect(search.toggleFilter('label:bug,ui', 'label', 'bug')).toBe('label:ui');
  });

  it('extends lists with combine: "or"', () => {
    expect(search.toggleFilter('label:bug', 'label', 'ui', { combine: 'or' })).toBe('label:bug,ui');
  });

  it('handles negated toggles', () => {
    expect(search.toggleFilter('x', 'label', 'wontfix', { negated: true })).toBe('x -label:wontfix');
    expect(search.toggleFilter('x -label:wontfix', 'label', 'wontfix', { negated: true })).toBe('x');
  });
});
