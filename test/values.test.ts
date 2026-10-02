import { describe, expect, it } from 'vitest';
import { createQuerybar, type TermValue } from '../src/index';
import { NOW, search } from './fixtures';

const values = (q: string): TermValue[] => search.parse(q).terms[0]!.values;
const first = (q: string) => values(q)[0]!;
const errors = (q: string) => search.parse(q).diagnostics.filter((d) => d.severity === 'error');

describe('string values', () => {
  it('keeps the literal value', () => {
    expect(first('author:alice')).toMatchObject({ kind: 'string', value: 'alice', wildcard: false, parts: ['alice'] });
  });

  it('parses unquoted * as wildcards', () => {
    expect(first('author:al*')).toMatchObject({ wildcard: true, parts: ['al', ''] });
    expect(first('author:*ce')).toMatchObject({ wildcard: true, parts: ['', 'ce'] });
    expect(first('author:a*c*e')).toMatchObject({ wildcard: true, parts: ['a', 'c', 'e'] });
  });

  it('treats quoted * literally', () => {
    expect(first('author:"al*"')).toMatchObject({ wildcard: false, value: 'al*' });
    expect(first('author:"a"*')).toMatchObject({ wildcard: true, parts: ['a', ''] });
  });

  it('parses a lone * as "has any value"', () => {
    expect(first('label:*')).toMatchObject({ kind: 'exists' });
    expect(first('label:"*"')).toMatchObject({ kind: 'string', value: '*' });
    expect(first('stars:*').kind).toBe('exists');
    expect(first('created:*').kind).toBe('exists');
    expect(errors('stars:>*')[0]!.code).toBe('invalid-operator');
  });

  it('rejects comparison operators', () => {
    expect(errors('author:>alice')[0]).toMatchObject({ code: 'invalid-operator', start: 7, end: 13 });
  });

  it('keeps raw text and offsets', () => {
    const v = first('label:"good first"');
    expect(v.raw).toBe('"good first"');
    expect([v.start, v.end]).toEqual([6, 18]);
  });
});

describe('number values', () => {
  it.each([
    ['1', 1],
    ['-5', -5],
    ['+5', 5],
    ['1.5', 1.5],
    ['.5', 0.5],
    ['5.', 5],
    ['1e3', 1000],
    ['1E-2', 0.01],
    ['0', 0],
  ])('parses %s', (text, n) => {
    expect(first(`stars:${text}`)).toMatchObject({ kind: 'number', value: n });
  });

  it.each(['abc', '1,5x', '0x10', '1_000', 'Infinity', 'NaN', '1e999', '--1', '1..2..3', '.', '-'])(
    'rejects %s',
    (text) => {
      expect(search.parse(`stars:${text}`).valid).toBe(false);
    },
  );

  it('parses ranges', () => {
    expect(first('stars:10..20')).toMatchObject({ kind: 'number-range', min: 10, max: 20 });
    expect(first('stars:10..*')).toMatchObject({ min: 10, max: null });
    expect(first('stars:*..20')).toMatchObject({ min: null, max: 20 });
    expect(first('stars:10..')).toMatchObject({ min: 10, max: null });
    expect(first('stars:..20')).toMatchObject({ min: null, max: 20 });
    expect(first('stars:-5..-1')).toMatchObject({ min: -5, max: -1 });
    expect(first('stars:1.5..2.5')).toMatchObject({ min: 1.5, max: 2.5 });
    expect(first('stars:5..5')).toMatchObject({ min: 5, max: 5 });
  });

  it('rejects bad ranges', () => {
    expect(errors('stars:20..10')[0]!.code).toBe('invalid-range');
    expect(errors('stars:..')[0]!.code).toBe('invalid-range');
    expect(errors('stars:*..*')[0]!.code).toBe('invalid-range');
    expect(errors('stars:>1..2')[0]!.code).toBe('invalid-operator');
    expect(errors('stars:"1..2"')[0]!.code).toBe('invalid-value');
  });

  it('accepts lists of numbers and ranges', () => {
    expect(values('stars:1,5..10,20').map((v) => v.kind)).toEqual(['number', 'number-range', 'number']);
  });

  it('rejects comparisons combined with lists', () => {
    expect(errors('stars:>1,2').map((e) => e.code)).toContain('invalid-operator');
  });

  it('enforces integer / min / max', () => {
    expect(errors('comments:1.5')[0]!.message).toMatch(/whole number/);
    expect(errors('comments:-1')[0]!.message).toMatch(/at least 0/);
    const s = createQuerybar({ fields: { n: { type: 'number', max: 10 } } });
    expect(s.parse('n:11').valid).toBe(false);
    expect(s.parse('n:10').valid).toBe(true);
  });

  it('keeps valid alternatives when one alternative is invalid, but marks the term invalid', () => {
    const r = search.parse('stars:1,x');
    expect(r.terms[0]!.values).toHaveLength(1);
    expect(r.terms[0]!.valid).toBe(false);
  });
});

describe('boolean values', () => {
  it.each(['true', 'TRUE', 'yes', 'on', '1'])('%s is true', (t) => {
    expect(first(`archived:${t}`)).toMatchObject({ kind: 'boolean', value: true });
  });
  it.each(['false', 'No', 'off', '0'])('%s is false', (t) => {
    expect(first(`archived:${t}`)).toMatchObject({ kind: 'boolean', value: false });
  });
  it('rejects anything else with a suggestion', () => {
    expect(errors('archived:ture')[0]).toMatchObject({ code: 'invalid-value', suggestion: 'true' });
    expect(errors('archived:>true')[0]!.code).toBe('invalid-operator');
  });
});

describe('enum values', () => {
  it('matches case-insensitively and returns the canonical value', () => {
    expect(first('is:OPEN')).toMatchObject({ kind: 'enum', value: 'open' });
  });
  it('suggests close values, including transpositions', () => {
    expect(errors('is:opne')[0]).toMatchObject({ suggestion: 'open' });
    expect(errors('is:clsoed')[0]).toMatchObject({ suggestion: 'closed' });
    expect(errors('is:xyzzy')[0]!.suggestion).toBeUndefined();
    expect(errors('is:xyzzy')[0]!.message).toMatch(/open, closed, draft/);
  });
  it('accepts values with spaces when quoted', () => {
    const s = createQuerybar({ fields: { status: { type: 'enum', values: ['in progress', 'done'] } } });
    expect(s.parse('status:"In Progress"').terms[0]!.values[0]).toMatchObject({ value: 'in progress' });
  });
});

describe('date values', () => {
  const iso = (ms: number) => new Date(ms).toISOString();
  const date = (q: string) => {
    const v = first(q);
    if (v.kind !== 'date') throw new Error(`expected date, got ${v.kind}`);
    return [iso(v.from), iso(v.to)];
  };

  it('parses calendar dates as whole periods (UTC by default)', () => {
    expect(date('created:2024')).toEqual(['2024-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z']);
    expect(date('created:2024-02')).toEqual(['2024-02-01T00:00:00.000Z', '2024-03-01T00:00:00.000Z']);
    expect(date('created:2024-12')).toEqual(['2024-12-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z']);
    expect(date('created:2024-02-29')).toEqual(['2024-02-29T00:00:00.000Z', '2024-03-01T00:00:00.000Z']);
    expect(date('created:2024-05-17T10:30')).toEqual(['2024-05-17T10:30:00.000Z', '2024-05-17T10:31:00.000Z']);
    expect(date('created:2024-05-17T10:30:15')).toEqual(['2024-05-17T10:30:15.000Z', '2024-05-17T10:30:16.000Z']);
    expect(date('created:2024-05-17T10:30:15.5')).toEqual(['2024-05-17T10:30:15.500Z', '2024-05-17T10:30:15.600Z']);
    expect(date('created:2024-05-17T10:30:15.123456')).toEqual([
      '2024-05-17T10:30:15.123Z',
      '2024-05-17T10:30:15.124Z',
    ]);
    expect(date('created:"2024-05-17 10:30"')).toEqual(['2024-05-17T10:30:00.000Z', '2024-05-17T10:31:00.000Z']);
  });

  it('honours explicit offsets', () => {
    expect(date('created:2024-05-17T10:30Z')[0]).toBe('2024-05-17T10:30:00.000Z');
    expect(date('created:2024-05-17T10:30+09:00')[0]).toBe('2024-05-17T01:30:00.000Z');
    expect(date('created:2024-05-17T10:30+0900')[0]).toBe('2024-05-17T01:30:00.000Z');
    expect(date('created:2024-05-17T10:30-05')[0]).toBe('2024-05-17T15:30:00.000Z');
    expect(date('created:2024-05-17T10:30z')[0]).toBe('2024-05-17T10:30:00.000Z');
  });

  it('handles years below 100 without the 1900 offset', () => {
    expect(date('created:0099')).toEqual(['0099-01-01T00:00:00.000Z', '0100-01-01T00:00:00.000Z']);
    expect(date('created:0000-01-01')[0]).toBe('0000-01-01T00:00:00.000Z');
  });

  it.each([
    '2024-13',
    '2024-00',
    '2023-02-29',
    '2024-04-31',
    '2024-01-00',
    '2024-01-01T24:00',
    '2024-01-01T23:60',
    '2024-01-01T23:59:60',
    '2024-01-01T10:00+24:00',
    '2024-1-1',
    '24-01-01',
    '20240101',
    'last week',
    '2024-01-01Z',
    '7x',
    'soon',
  ])('rejects %s', (text) => {
    expect(search.parse(`created:"${text}"`).valid).toBe(false);
  });

  it('parses today / yesterday / tomorrow / now', () => {
    expect(date('created:today')).toEqual(['2024-06-15T00:00:00.000Z', '2024-06-16T00:00:00.000Z']);
    expect(date('created:yesterday')).toEqual(['2024-06-14T00:00:00.000Z', '2024-06-15T00:00:00.000Z']);
    expect(date('created:tomorrow')).toEqual(['2024-06-16T00:00:00.000Z', '2024-06-17T00:00:00.000Z']);
    expect(date('created:TODAY')[0]).toBe('2024-06-15T00:00:00.000Z');
    expect(date('created:now')).toEqual([iso(NOW), iso(NOW)]);
  });

  it('parses relative durations as points in the past', () => {
    expect(date('created:30min')[0]).toBe('2024-06-15T11:30:00.000Z');
    expect(date('created:12h')[0]).toBe('2024-06-15T00:00:00.000Z');
    expect(date('created:7d')[0]).toBe('2024-06-08T12:00:00.000Z');
    expect(date('created:2w')[0]).toBe('2024-06-01T12:00:00.000Z');
    expect(date('created:1mo')[0]).toBe('2024-05-15T12:00:00.000Z');
    expect(date('created:1y')[0]).toBe('2023-06-15T12:00:00.000Z');
    expect(date('created:0d')[0]).toBe(iso(NOW));
  });

  it('clamps month arithmetic to the end of the month', () => {
    const s = createQuerybar({ fields: { d: { type: 'date' } }, now: () => Date.UTC(2024, 2, 31, 6) });
    const v = s.parse('d:1mo').terms[0]!.values[0]!;
    expect(v.kind === 'date' && iso(v.from)).toBe('2024-02-29T06:00:00.000Z');
    const y = s.parse('d:1y').terms[0]!.values[0]!;
    expect(y.kind === 'date' && iso(y.from)).toBe('2023-03-31T06:00:00.000Z');
    const s2 = createQuerybar({ fields: { d: { type: 'date' } }, now: () => Date.UTC(2024, 1, 29) });
    const leap = s2.parse('d:1y').terms[0]!.values[0]!;
    expect(leap.kind === 'date' && iso(leap.from)).toBe('2023-02-28T00:00:00.000Z');
  });

  it('parses date ranges with inclusive whole periods', () => {
    const v = first('created:2024-01..2024-03');
    expect(v.kind).toBe('date-range');
    if (v.kind !== 'date-range') return;
    expect(iso(v.from!)).toBe('2024-01-01T00:00:00.000Z');
    expect(iso(v.to!)).toBe('2024-04-01T00:00:00.000Z');
    const open = first('created:2024-01-01..*');
    expect(open.kind === 'date-range' && open.to).toBeNull();
    const rel = first('created:30d..7d');
    expect(rel.kind === 'date-range' && iso(rel.to! - 1)).toBe('2024-06-08T12:00:00.000Z');
  });

  it('rejects empty or inverted date ranges', () => {
    expect(errors('created:2024-03..2024-01')[0]!.code).toBe('invalid-range');
    expect(errors('created:7d..30d')[0]!.code).toBe('invalid-range');
    expect(errors('created:..')[0]!.code).toBe('invalid-range');
    expect(errors('created:2024..nope')[0]!.code).toBe('invalid-value');
  });

  it('uses the local time zone when asked', () => {
    const s = createQuerybar({ fields: { d: { type: 'date' } }, timeZone: 'local' });
    const v = s.parse('d:2024-05-17').terms[0]!.values[0]!;
    expect(v.kind).toBe('date');
    if (v.kind !== 'date') return;
    expect(v.from).toBe(new Date(2024, 4, 17).getTime());
    expect(v.to).toBe(new Date(2024, 4, 18).getTime());
  });

  it('accepts Date objects and numbers from the clock, ignoring broken clocks', () => {
    const a = createQuerybar({ fields: { d: { type: 'date' } }, now: () => new Date(NOW) });
    const b = createQuerybar({ fields: { d: { type: 'date' } }, now: () => NaN });
    const c = createQuerybar({
      fields: { d: { type: 'date' } },
      now: () => {
        throw new Error('clock broke');
      },
    });
    expect(c.parse('d:7d').valid).toBe(true);
    const va = a.parse('d:now').terms[0]!.values[0]!;
    expect(va.kind === 'date' && va.from).toBe(NOW);
    const vb = b.parse('d:now').terms[0]!.values[0]!;
    expect(vb.kind === 'date' && Math.abs(vb.from - Date.now()) < 5000).toBe(true);
  });
});
