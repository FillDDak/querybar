import { describe, expect, it } from 'vitest';
import { createQuerybar, stringify, type Node, type TermValue } from '../src/index';
import { closest, editDistance, globMatch, safeRaw } from '../src/text';

const term = (field: string, op: '=' | '>', values: TermValue[]): Node => ({
  type: 'term',
  field,
  key: field,
  op,
  values,
  valid: true,
  raw: '',
  start: 0,
  end: 0,
});
const base = { raw: '', start: 0, end: 0 };

describe('stringify of hand-built values (no raw text)', () => {
  it('formats every value kind', () => {
    expect(stringify(term('s', '=', [{ kind: 'enum', value: 'in progress', ...base }]))).toBe('s:"in progress"');
    expect(stringify(term('b', '=', [{ kind: 'boolean', value: false, ...base }]))).toBe('b:false');
    expect(stringify(term('n', '>', [{ kind: 'number', value: -2.5, ...base }]))).toBe('n:>-2.5');
    expect(stringify(term('d', '=', [{ kind: 'date', from: Date.UTC(2024, 0, 2, 3), to: Date.UTC(2024, 0, 2, 3), ...base }]))).toBe(
      'd:2024-01-02T03:00:00.000Z',
    );
    expect(stringify(term('d', '=', [{ kind: 'date-range', from: null, to: Date.UTC(2024, 0, 1), ...base }]))).toBe(
      'd:*..2023-12-31T23:59:59.999Z',
    );
    expect(stringify(term('n', '=', [{ kind: 'number-range', min: 1, max: null, ...base }]))).toBe('n:1..*');
    expect(stringify(term('s', '=', [{ kind: 'string', value: '>x', wildcard: false, parts: ['>x'], ...base }]))).toBe(
      's:">x"',
    );
    expect(stringify(term('s', '=', [{ kind: 'string', value: '', wildcard: true, parts: ['', 'a b', ''], ...base }]))).toBe(
      's:*"a b"*',
    );
  });

  it('round-trips hand-built values through the parser', () => {
    const s = createQuerybar({ fields: { s: { type: 'string' } } });
    const text = stringify(term('s', '=', [{ kind: 'string', value: '', wildcard: true, parts: ['', 'a b', ''], ...base }]));
    expect(s.filter([{ s: 'xa by' }, { s: 'ab' }], text)).toEqual([{ s: 'xa by' }]);
  });

  it('formats years outside 0000-9999 in extended ISO form', () => {
    const far = Date.UTC(10000, 0, 1);
    expect(stringify(term('d', '=', [{ kind: 'date', from: far, to: far, ...base }]))).toBe('d:+010000-01-01T00:00:00.000Z');
  });
});

describe('value coercion', () => {
  it('matches bigint and Date values in number fields', () => {
    const s = createQuerybar({ fields: { n: { type: 'number' } } });
    expect(s.filter([{ n: BigInt(5) }, { n: new Date(5) }, { n: new Date(NaN) }, { n: true }], 'n:5')).toEqual([
      { n: BigInt(5) },
      { n: new Date(5) },
    ]);
  });

  it('searches Date, boolean and bigint values returned by a text extractor', () => {
    const s = createQuerybar({ fields: {}, text: (r: { d: Date; b: boolean; n: bigint; x: object }) => [r.d, r.b, r.n, r.x] });
    const row = { d: new Date(Date.UTC(2024, 0, 2)), b: true, n: BigInt(77), x: {} };
    expect(s.filter([row], '2024-01-02')).toHaveLength(1);
    expect(s.filter([row], 'true 77')).toHaveLength(1);
    expect(s.filter([row], 'object')).toHaveLength(0);
  });

  it('compares strings against numbers and booleans as text', () => {
    const s = createQuerybar({ fields: { v: { type: 'string' } } });
    expect(s.filter([{ v: 42 }, { v: true }, { v: {} }], 'v:42')).toEqual([{ v: 42 }]);
    expect(s.filter([{ v: 42 }, { v: true }], 'v:tr*')).toEqual([{ v: true }]);
  });
});

describe('text helpers', () => {
  it('globMatch handles overlapping prefix and suffix', () => {
    expect(globMatch(['a', 'a'], 'a')).toBe(false);
    expect(globMatch(['a', 'a'], 'aa')).toBe(true);
    expect(globMatch(['ab', 'b', 'bc'], 'abbc')).toBe(false);
    expect(globMatch(['ab', 'b', 'bc'], 'abxbxbc')).toBe(true);
    expect(globMatch(['', '', ''], '')).toBe(true);
    expect(globMatch(['x'], 'x')).toBe(true);
  });

  it('editDistance and closest', () => {
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('abc', '')).toBe(3);
    expect(editDistance('abc', 'abc')).toBe(0);
    expect(editDistance('ca', 'ac')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(closest('', ['a'])).toBe('a');
    expect(closest('zzzz', ['a'])).toBeUndefined();
    expect(closest('x', [])).toBeUndefined();
  });

  it('safeRaw closes quotes and protects parentheses without changing meaning', () => {
    expect(safeRaw('abc')).toBe('abc');
    expect(safeRaw('"abc')).toBe('"abc"');
    expect(safeRaw('"abc\\')).toBe('"abc\\\\"');
    expect(safeRaw('"a\\"b')).toBe('"a\\"b"');
    expect(safeRaw('a)b')).toBe('a")"b');
    expect(safeRaw('"a)b"')).toBe('"a)b"');
    const s = createQuerybar({ fields: { f: { type: 'string' } } });
    for (const raw of ['"abc\\', 'a)b', '"x\\\\', 'a*)']) {
      const before = s.parse('f:' + raw).terms[0]!.values[0];
      const after = s.parse('(f:' + safeRaw(raw) + ')').terms[0]!.values[0];
      expect(after && 'value' in after && after.value).toBe(before && 'value' in before && before.value);
    }
  });
});
