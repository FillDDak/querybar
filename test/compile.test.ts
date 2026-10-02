import { describe, expect, it } from 'vitest';
import { createQuerybar } from '../src/index';
import { NOW, ids, issues, search } from './fixtures';

describe('filtering', () => {
  it('matches everything for an empty or fully invalid query', () => {
    expect(ids('')).toEqual([1, 2, 3, 4, 5]);
    expect(ids('   ')).toEqual([1, 2, 3, 4, 5]);
    expect(ids('stars:abc')).toEqual([1, 2, 3, 4, 5]);
    expect(ids('()')).toEqual([1, 2, 3, 4, 5]);
  });

  it('filters by enum', () => {
    expect(ids('is:open')).toEqual([1, 3, 5]);
    expect(ids('is:closed,draft')).toEqual([2, 4]);
    expect(ids('-is:open')).toEqual([2, 4]);
    const s = createQuerybar({ fields: { level: { type: 'enum', values: ['1', '2', 'HIGH'] } } });
    expect(s.filter([{ level: 1 }, { level: '2' }, { level: 'high' }, { level: null }], 'level:1,high')).toEqual([
      { level: 1 },
      { level: 'high' },
    ]);
  });

  it('filters by exact string, case- and accent-insensitively', () => {
    expect(ids('author:ALICE')).toEqual([1]);
    expect(ids('author:zoe')).toEqual([3]);
    expect(ids('author:ali')).toEqual([]);
    expect(ids('by:bob')).toEqual([2]);
  });

  it('filters by wildcard', () => {
    expect(ids('author:ali*')).toEqual([1]);
    expect(ids('author:*bot')).toEqual([4]);
    expect(ids('author:d*n*t')).toEqual([4]);
    expect(ids('author:*')).toEqual([1, 2, 3, 4, 5]);
  });

  it('respects string modes', () => {
    expect(ids('title:login')).toEqual([1]);
    expect(ids('title:CAFE')).toEqual([3]);
    const s = createQuerybar({ fields: { title: { type: 'string', mode: 'startsWith' } } });
    expect(s.filter(issues, 'title:add').map((i) => i.id)).toEqual([2]);
  });

  it('can be case-sensitive', () => {
    const s = createQuerybar({ fields: { author: { type: 'string', caseSensitive: true } } });
    expect(s.filter(issues, 'author:Zoë').map((i) => i.id)).toEqual([3]);
    expect(s.filter(issues, 'author:zoë').map((i) => i.id)).toEqual([]);
  });

  it('can keep diacritics significant', () => {
    const s = createQuerybar({ fields: { author: { type: 'string' } }, ignoreDiacritics: false });
    expect(s.filter(issues, 'author:zoe')).toEqual([]);
    expect(s.filter(issues, 'author:zoë').map((i) => i.id)).toEqual([3]);
  });

  it('matches any element of array values', () => {
    expect(ids('label:bug')).toEqual([1, 3]);
    expect(ids('label:bug label:ui')).toEqual([1]);
    expect(ids('label:bug,feature')).toEqual([1, 2, 3, 5]);
    expect(ids('-label:ui')).toEqual([3, 4, 5]);
    expect(ids('label:"good first issue"')).toEqual([3]);
  });

  it('treats field:* as "has a value" and -field:* as "is empty"', () => {
    expect(ids('label:*')).toEqual([1, 2, 3, 5]);
    expect(ids('-label:*')).toEqual([4]);
    expect(ids('archived:*')).toEqual([2]);
  });

  it('compares numbers', () => {
    expect(ids('stars:12')).toEqual([1]);
    expect(ids('stars:>10')).toEqual([1, 2]);
    expect(ids('stars:>=12')).toEqual([1, 2]);
    expect(ids('stars:<3')).toEqual([4]);
    expect(ids('stars:<=3')).toEqual([3, 4]);
    expect(ids('stars:3..12')).toEqual([1, 3, 5]);
    expect(ids('stars:10..')).toEqual([1, 2]);
    expect(ids('stars:..3')).toEqual([3, 4]);
    expect(ids('stars:0,40')).toEqual([2, 4]);
  });

  it('coerces numeric strings and ignores non-numbers', () => {
    const s = createQuerybar({ fields: { n: { type: 'number' } } });
    const rows = [{ n: '5' }, { n: 'x' }, { n: null }, { n: 5 }, { n: NaN }, {}, { n: ' ' }];
    expect(s.filter(rows, 'n:5')).toEqual([{ n: '5' }, { n: 5 }]);
    expect(s.filter(rows, 'n:*')).toEqual([{ n: '5' }, { n: 'x' }, { n: 5 }, { n: ' ' }]);
  });

  it('compares dates of any representation', () => {
    expect(ids('created:2024')).toEqual([1, 2, 3, 5]);
    expect(ids('created:2023')).toEqual([4]);
    expect(ids('created:2024-03')).toEqual([2]);
    expect(ids('created:2024-03-05')).toEqual([2]);
    expect(ids('created:>2024-03-05')).toEqual([3, 5]);
    expect(ids('created:>=2024-03-05')).toEqual([2, 3, 5]);
    expect(ids('created:<2024-01-10')).toEqual([4]);
    expect(ids('created:<=2024-01-10')).toEqual([1, 4]);
    expect(ids('created:2024-01..2024-03')).toEqual([1, 2]);
    expect(ids('created:*..2023')).toEqual([4]);
  });

  it('treats a bare relative date as "since then"', () => {
    expect(ids('created:7d')).toEqual([3, 5]);
    expect(ids('created:>=7d')).toEqual([3, 5]);
    expect(ids('created:>7d')).toEqual([3, 5]);
    expect(ids('created:<7d')).toEqual([1, 2, 4]);
    expect(ids('created:<=7d')).toEqual([1, 2, 4]);
    expect(ids('created:today')).toEqual([]);
    expect(ids('created:yesterday')).toEqual([3]);
    expect(ids('created:30d..2d')).toEqual([5]);
  });

  it('handles point comparisons exactly at the boundary', () => {
    const s = createQuerybar({ fields: { d: { type: 'date' } }, now: () => NOW });
    const at = [{ d: NOW }];
    expect(s.filter(at, 'd:now')).toHaveLength(1);
    expect(s.filter(at, 'd:>=now')).toHaveLength(1);
    expect(s.filter(at, 'd:<=now')).toHaveLength(1);
    expect(s.filter(at, 'd:>now')).toHaveLength(0);
    expect(s.filter(at, 'd:<now')).toHaveLength(0);
    expect(s.filter(at, 'd:now..now')).toHaveLength(1);
  });

  it('ignores invalid dates in the data', () => {
    const s = createQuerybar({ fields: { d: { type: 'date' } } });
    const rows = [{ d: 'not a date' }, { d: new Date(NaN) }, { d: null }, { d: {} }, { d: '' }];
    expect(s.filter(rows, 'd:>2000')).toEqual([]);
    expect(s.filter(rows, '-d:>2000')).toHaveLength(5);
  });

  it('compares booleans, treating missing as false', () => {
    expect(ids('archived:true')).toEqual([2]);
    expect(ids('archived:false')).toEqual([1, 3, 4, 5]);
    const s = createQuerybar({ fields: { b: { type: 'boolean' } } });
    const rows = [{ b: 'yes' }, { b: 1 }, { b: 0 }, { b: 'nope' }, { b: [true] }];
    expect(s.filter(rows, 'b:true')).toEqual([{ b: 'yes' }, { b: 1 }, { b: [true] }]);
    expect(s.filter(rows, 'b:false')).toEqual([{ b: 0 }]);
  });

  it('ignores filter:false fields (pure qualifiers)', () => {
    expect(ids('sort:stars')).toEqual([1, 2, 3, 4, 5]);
    expect(ids('is:open sort:stars')).toEqual([1, 3, 5]);
    expect(ids('-sort:stars')).toEqual([1, 2, 3, 4, 5]);
    expect(ids('sort:stars OR is:closed')).toEqual([2]);
  });

  it('supports custom filter functions', () => {
    const s = createQuerybar({
      fields: {
        mine: {
          type: 'boolean',
          filter: (item: { author: string }, term) => {
            const wanted = term.values[0]!.kind === 'boolean' && term.values[0]!.value;
            return (item.author === 'alice') === wanted;
          },
        },
      },
    });
    expect(s.filter(issues, 'mine:yes').map((i) => i.id)).toEqual([1]);
    expect(s.filter(issues, 'mine:no').map((i) => i.id)).toEqual([2, 3, 4, 5]);
  });

  it('supports custom getters and paths', () => {
    const rows = [
      { user: { name: 'Ann', 'first.last': 'x' }, tags: new Set(['a', 'b']) },
      { user: { name: 'Ben' }, tags: new Set<string>() },
      { user: null, tags: undefined },
    ];
    const s = createQuerybar({
      fields: {
        user: { type: 'string', path: 'user.name' },
        initial: { type: 'string', get: (r: (typeof rows)[number]) => r.user?.name?.[0] },
        tag: { type: 'string', path: 'tags' },
        weird: { type: 'string', path: 'user.first.last' },
      },
    });
    expect(s.filter(rows, 'user:ann')).toEqual([rows[0]]);
    expect(s.filter(rows, 'initial:b')).toEqual([rows[1]]);
    expect(s.filter(rows, 'tag:b')).toEqual([rows[0]]);
    expect(s.filter(rows, '-tag:*')).toEqual([rows[1], rows[2]]);
    expect(s.filter(rows, 'weird:*')).toEqual([]);
    const literal = createQuerybar({ fields: { k: { type: 'string', path: 'a.b' } } });
    expect(literal.filter([{ 'a.b': 'yes' }], 'k:yes')).toHaveLength(1);
  });

  it('never throws on odd items', () => {
    const odd = [null, undefined, 0, 'str', [], { is: 5 }, Object.create(null), { label: [[['bug']]] }];
    expect(() => search.filter(odd, 'is:open label:bug stars:>1 created:2024 archived:true hello')).not.toThrow();
    expect(search.filter(odd, 'label:bug')).toEqual([{ label: [[['bug']]] }]);
  });
});

describe('free text', () => {
  it('searches all top-level string and number values by default', () => {
    expect(ids('login')).toEqual([1]);
    expect(ids('LOGIN safari')).toEqual([1]);
    expect(ids('"login button"')).toEqual([1]);
    expect(ids('"button login"')).toEqual([]);
    expect(ids('stack')).toEqual([3]);
    expect(ids('40')).toEqual([2]);
    // `created` strings are searched as text too: "2023-12-31…" contains "12".
    expect(ids('12')).toEqual([1, 4]);
    expect(ids('ui')).toEqual([1, 2]);
    expect(ids('-ui')).toEqual([3, 4, 5]);
  });

  it('ignores diacritics but never matches partial Hangul syllables', () => {
    expect(ids('cafe')).toEqual([3]);
    expect(ids('검색')).toEqual([5]);
    expect(ids('한국어')).toEqual([5]);
    // "하" is a prefix of "한" in decomposed (NFD) form; it must not match.
    expect(ids('하')).toEqual([]);
    expect(ids('필요합니다')).toEqual([5]);
  });

  it('can be limited to specific paths', () => {
    const s = createQuerybar({ fields: {}, text: ['title'] });
    expect(s.filter(issues, 'stack')).toEqual([]);
    expect(s.filter(issues, 'crash').map((i) => i.id)).toEqual([3]);
  });

  it('can use a custom extractor', () => {
    const s = createQuerybar({ fields: {}, text: (i: { author: string }) => i.author });
    expect(s.filter(issues, 'bob').map((i) => i.id)).toEqual([2]);
    expect(s.filter(issues, 'dark')).toEqual([]);
  });

  it('can be disabled', () => {
    const s = createQuerybar({ fields: { is: { type: 'string' } }, text: false });
    expect(s.filter(issues, 'zzz is:open').map((i) => i.id)).toEqual([1, 3, 5]);
  });

  it('works on string items', () => {
    const s = createQuerybar({ fields: {} });
    expect(s.filter(['apple', 'banana', 'cherry'], 'an')).toEqual(['banana']);
    expect(s.filter(['apple', 'banana', 'cherry'], '-a')).toEqual(['cherry']);
  });

  it('turns unknown qualifiers into text', () => {
    const s = createQuerybar({ fields: {} });
    expect(s.filter(['see http://x.io', 'nothing'], 'http://x.io')).toEqual(['see http://x.io']);
  });

  it('ignores an empty phrase', () => {
    expect(ids('""')).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('boolean logic', () => {
  it('combines with OR, AND, NOT and groups', () => {
    expect(ids('author:alice OR author:bob')).toEqual([1, 2]);
    expect(ids('is:open (label:ui OR stars:<5)')).toEqual([1, 3]);
    expect(ids('is:open label:ui OR stars:<5')).toEqual([1, 3, 4]);
    expect(ids('-(is:open OR is:draft)')).toEqual([2]);
    expect(ids('NOT label:bug NOT label:feature')).toEqual([4]);
    expect(ids('is:open AND NOT label:bug')).toEqual([5]);
  });

  it('drops invalid parts and keeps the rest', () => {
    expect(ids('is:open stars:abc')).toEqual([1, 3, 5]);
    expect(ids('is:nope OR author:bob')).toEqual([2]);
    expect(ids('-stars:abc')).toEqual([1, 2, 3, 4, 5]);
  });

  it('accepts a ParseResult and reuses it', () => {
    const r = search.parse('is:open');
    const test = search.compile<(typeof issues)[number]>(r);
    expect(issues.filter(test).map((i) => i.id)).toEqual([1, 3, 5]);
  });

  it('filters any iterable', () => {
    const set = new Set(issues);
    expect(search.filter(set, 'is:closed').map((i) => i.id)).toEqual([2]);
    function* gen() {
      yield* issues;
    }
    expect(search.filter(gen(), 'is:draft').map((i) => i.id)).toEqual([4]);
  });

  it('evaluates text only once per item even with many words', () => {
    let calls = 0;
    const s = createQuerybar({
      fields: {},
      text: (i: { title: string }) => {
        calls++;
        return i.title;
      },
    });
    s.filter(issues, 'a b c d e OR f');
    expect(calls).toBe(issues.length);
  });
});

describe('wildcard performance', () => {
  it('does not backtrack catastrophically', () => {
    const s = createQuerybar({ fields: { v: { type: 'string' } } });
    const pattern = 'v:' + 'a*'.repeat(40) + 'b';
    const rows = [{ v: 'a'.repeat(20000) }];
    const t = Date.now();
    expect(s.filter(rows, pattern)).toEqual([]);
    expect(Date.now() - t).toBeLessThan(500);
  });
});
