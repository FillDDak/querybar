import { describe, expect, it } from 'vitest';
import { createQuerybar, stringify, type Node } from '../src/index';
import { search } from './fixtures';

describe('format / stringify', () => {
  it.each([
    ['', ''],
    ['  a   b  ', 'a b'],
    ['IS:open BY:alice', 'is:open author:alice'],
    ['a AND b', 'a b'],
    ['a OR b c', 'a OR b c'],
    ['(a OR b) c', '(a OR b) c'],
    ['((a OR b))', 'a OR b'],
    ['a OR (b OR c)', 'a OR b OR c'],
    ['NOT a', '-a'],
    ['!a', '-a'],
    ['-(a b)', '-(a b)'],
    ['NOT NOT a', '-(-a)'],
    ['-(a OR b) c', '-(a OR b) c'],
    ['"hello world"', '"hello world"'],
    ['"OR"', '"OR"'],
    ['label:"good first issue",bug', 'label:"good first issue",bug'],
    ['stars:>=10', 'stars:>=10'],
    ['created:2024-01..2024-03', 'created:2024-01..2024-03'],
    ['stars:abc', 'stars:abc'],
    ['label:', 'label:'],
    ['"unterminated', '"unterminated"'],
    ['(a OR b', 'a OR b'],
    ['a ) b', 'a b'],
    ['foo:bar', '"foo:bar"'],
    ['"-x"', '"-x"'],
    ['"a\\"b"', '"a\\"b"'],
  ])('format(%j) = %j', (input, output) => {
    expect(search.format(input)).toBe(output);
  });

  it('format is idempotent and preserves meaning on tricky inputs', () => {
    for (const q of ['a OR b c', '-(a OR -b)', 'x (y OR (z -w))', 'label:a,"b c" -is:open OR stars:1..2']) {
      const once = search.format(q);
      expect(search.format(once)).toBe(once);
    }
  });

  it('stringifies hand-built trees', () => {
    const term: Node = {
      type: 'term',
      field: 'label',
      key: 'label',
      op: '=',
      values: [
        { kind: 'string', value: 'needs review', wildcard: false, parts: ['needs review'], raw: '', start: 0, end: 0 },
        { kind: 'string', value: '', wildcard: true, parts: ['a', ''], raw: '', start: 0, end: 0 },
        { kind: 'exists', raw: '', start: 0, end: 0 },
      ],
      valid: true,
      raw: '',
      start: 0,
      end: 0,
    };
    expect(stringify(term)).toBe('label:"needs review",a*,*');
    const numeric: Node = {
      type: 'term',
      field: 'stars',
      key: 'stars',
      op: '>=',
      values: [{ kind: 'number', value: 5, raw: '', start: 0, end: 0 }],
      valid: true,
      raw: '',
      start: 0,
      end: 0,
    };
    expect(stringify(numeric)).toBe('stars:>=5');
    const dates: Node = {
      type: 'term',
      field: 'created',
      key: 'created',
      op: '=',
      values: [
        { kind: 'date-range', from: Date.UTC(2024, 0, 1), to: Date.UTC(2024, 1, 1), raw: '', start: 0, end: 0 },
        { kind: 'number-range', min: null, max: 3, raw: '', start: 0, end: 0 },
      ],
      valid: true,
      raw: '',
      start: 0,
      end: 0,
    };
    expect(stringify(dates)).toBe('created:2024-01-01T00:00:00.000Z..2024-01-31T23:59:59.999Z,*..3');
    const r = search.parse(stringify(dates));
    const v = r.terms[0]!.values[0]!;
    expect(v.kind === 'date-range' && [v.from, v.to]).toEqual([Date.UTC(2024, 0, 1), Date.UTC(2024, 1, 1)]);
    expect(stringify(null)).toBe('');
    expect(search.stringify({ type: 'text', value: 'is:x', quoted: false, start: 0, end: 0 })).toBe('"is:x"');
  });
});

describe('tokenize', () => {
  const types = (q: string) => search.tokenize(q).map((t) => `${t.type}:${t.text}`);

  it('covers the whole input', () => {
    const q = '  is:open -label:bug,"ui x" (a OR NOT b) stars:>=5 ) "x';
    const tokens = search.tokenize(q);
    expect(tokens.map((t) => t.text).join('')).toBe(q);
    let pos = 0;
    for (const t of tokens) {
      expect(t.start).toBe(pos);
      pos = t.end;
    }
    expect(pos).toBe(q.length);
  });

  it('labels each part', () => {
    expect(types('-is:open,closed')).toEqual([
      'negation:-',
      'field:is',
      'colon::',
      'value:open',
      'separator:,',
      'value:closed',
    ]);
    expect(types('stars:>=5')).toEqual(['field:stars', 'colon::', 'operator:>=', 'value:5']);
    expect(types('(a OR b)')).toEqual(['paren:(', 'text:a', 'whitespace: ', 'keyword:OR', 'whitespace: ', 'text:b', 'paren:)']);
    expect(types('a )')).toEqual(['text:a', 'whitespace: ', 'error:)']);
    expect(types('foo:bar')).toEqual(['text:foo:bar']);
    expect(types('label:,')).toEqual(['field:label', 'colon::', 'separator:,']);
  });

  it('marks tokens covered by errors as invalid and names fields', () => {
    const tokens = search.tokenize('by:x stars:abc is:open');
    expect(tokens.find((t) => t.text === 'by')).toMatchObject({ field: 'author' });
    expect(tokens.find((t) => t.text === 'abc')).toMatchObject({ invalid: true, field: 'stars' });
    expect(tokens.find((t) => t.text === 'open')!.invalid).toBeUndefined();
  });

  it('flags unknown fields when they are errors', () => {
    const s = createQuerybar({ fields: {}, unknownFields: 'error' });
    expect(s.tokenize('foo:bar').map((t) => [t.type, t.invalid])).toEqual([
      ['field', true],
      ['colon', undefined],
      ['value', undefined],
    ]);
  });

  it('handles empty input', () => {
    expect(search.tokenize('')).toEqual([]);
    expect(search.tokenize('   ')).toEqual([{ type: 'whitespace', text: '   ', start: 0, end: 3 }]);
  });
});

describe('suggest', () => {
  const labels = (q: string, cursor?: number) => search.suggest(q, cursor).items.map((i) => i.label);

  it('suggests fields at an empty position', () => {
    const r = search.suggest('');
    expect(r.context).toBe('field');
    expect(r.items.map((i) => i.label)).toEqual(Object.keys(search.fields));
    expect(r.items[0]).toMatchObject({ insert: 'is:', kind: 'field', description: 'Issue state' });
    expect(search.suggest('is:open ').context).toBe('field');
  });

  it('filters fields by prefix, including aliases, prefix matches first', () => {
    expect(labels('st')).toEqual(['stars']);
    // `by` is an alias of author (prefix match); "label" merely contains a "b".
    expect(labels('b')).toEqual(['author', 'label']);
    expect(labels('a')).toEqual(['author', 'archived', 'label', 'stars', 'created']);
    expect(labels('-la')).toEqual(['label']);
    expect(search.suggest('-la')).toMatchObject({ from: 1, to: 3, prefix: 'la' });
  });

  it('offers uppercase keywords', () => {
    expect(search.suggest('a O').items.map((i) => i.label)).toEqual(['OR', 'author', 'comments', 'sort']);
    expect(search.suggest('a N').items[0]).toEqual({ label: 'NOT', insert: 'NOT', kind: 'keyword' });
    expect(search.suggest('a o').items.map((i) => i.kind)).not.toContain('keyword');
    const s = createQuerybar({ fields: {}, operators: false });
    expect(s.suggest('O').items).toEqual([]);
  });

  it('suggests values for enum, boolean, date and string fields', () => {
    expect(labels('is:')).toEqual(['open', 'closed', 'draft']);
    expect(labels('is:c')).toEqual(['closed']);
    expect(labels('archived:')).toEqual(['true', 'false']);
    expect(labels('created:')).toContain('today');
    expect(labels('label:g')).toEqual(['good first issue', 'bug']);
    expect(labels('label:go')).toEqual(['good first issue']);
    expect(labels('author:zo')).toEqual(['Zoë']);
    expect(labels('stars:')).toEqual([]);
    expect(labels('title:')).toEqual([]);
  });

  it('ranks substring matches after prefix matches', () => {
    expect(labels('label:u')).toEqual(['ui', 'bug', 'feature', 'good first issue']);
  });

  it('quotes values that need it', () => {
    const r = search.suggest('label:goo');
    expect(r.items[0]).toMatchObject({ label: 'good first issue', insert: '"good first issue"' });
    expect(search.suggest('label:"good f').items[0]!.label).toBe('good first issue');
  });

  it('works inside lists and skips values already listed', () => {
    const r = search.suggest('is:open,');
    expect(r).toMatchObject({ context: 'value', field: 'is', from: 8, to: 8 });
    expect(r.items.map((i) => i.label)).toEqual(['closed', 'draft']);
    const mid = search.suggest('is:open,cl,draft', 10);
    expect(mid).toMatchObject({ from: 8, to: 10, prefix: 'cl' });
    expect(mid.items.map((i) => i.label)).toEqual(['closed']);
  });

  it('replaces the whole key when the cursor is inside it', () => {
    const r = search.suggest('lab:bug', 2);
    expect(r).toMatchObject({ context: 'field', from: 0, to: 4, prefix: 'la' });
    expect(search.applySuggestion('lab:bug', r, r.items[0]!)).toEqual({ text: 'label:bug', cursor: 6 });
  });

  it('handles operators and unknown fields', () => {
    expect(search.suggest('stars:>')).toMatchObject({ context: 'value', field: 'stars', from: 7 });
    expect(search.suggest('stars:>=', 7)).toMatchObject({ context: 'value', from: 8 });
    expect(search.suggest('nope:x').context).toBe('none');
    expect(search.suggest('"quoted').context).toBe('none');
  });

  it('clamps the cursor and respects the limit', () => {
    expect(search.suggest('is:', 999).field).toBe('is');
    expect(search.suggest('is:', -5).context).toBe('field');
    expect(search.suggest('is:', NaN).context).toBe('field');
    expect(search.suggest('', 0, { limit: 2 }).items).toHaveLength(2);
    expect(search.suggest('', 0, { limit: 0 }).items).toHaveLength(0);
  });

  it('calls suggestion functions with the typed prefix', () => {
    const seen: string[] = [];
    const s = createQuerybar({
      fields: {
        user: {
          type: 'string',
          suggestions: (prefix) => {
            seen.push(prefix);
            return ['ann', 'anna', 'bob'];
          },
        },
      },
    });
    expect(s.suggest('user:an').items.map((i) => i.label)).toEqual(['ann', 'anna']);
    expect(seen).toEqual(['an']);
  });

  it('applies suggestions', () => {
    const q = 'is:o';
    const r = search.suggest(q);
    expect(search.applySuggestion(q, r, r.items[0]!)).toEqual({ text: 'is:open ', cursor: 8 });
    const f = search.suggest('la');
    expect(search.applySuggestion('la', f, f.items[0]!)).toEqual({ text: 'label:', cursor: 6 });
    const mid = search.suggest('is:o foo', 4);
    expect(search.applySuggestion('is:o foo', mid, mid.items[0]!)).toEqual({ text: 'is:open foo', cursor: 7 });
  });
});
