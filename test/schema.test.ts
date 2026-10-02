import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  createQuerybar,
  type DateRangeValue,
  type DateValue,
  type EnumValue,
  type ExistsValue,
  type NumberRangeValue,
  type NumberValue,
  type ParseResult,
  type Querybar,
  type StringValue,
} from '../src/index';
import * as api from '../src/index';
import { search } from './fixtures';

describe('schema validation', () => {
  it('requires options and fields', () => {
    expect(() => createQuerybar(undefined as never)).toThrow(TypeError);
    expect(() => createQuerybar({} as never)).toThrow(/fields/);
    expect(() => createQuerybar({ fields: null } as never)).toThrow(/fields/);
  });

  it('requires a known type', () => {
    expect(() => createQuerybar({ fields: { a: {} } } as never)).toThrow(/needs a type/);
    expect(() => createQuerybar({ fields: { a: { type: 'text' } } } as never)).toThrow(/needs a type/);
    expect(() => createQuerybar({ fields: { a: null } } as never)).toThrow(/needs a type/);
  });

  it('validates enum values', () => {
    expect(() => createQuerybar({ fields: { a: { type: 'enum', values: [] } } })).toThrow(/non-empty/);
    expect(() => createQuerybar({ fields: { a: { type: 'enum', values: [''] } } })).toThrow(/non-empty/);
    expect(() => createQuerybar({ fields: { a: { type: 'enum' } } } as never)).toThrow(/non-empty/);
  });

  it('validates names and aliases', () => {
    for (const bad of ['', '1abc', 'a b', 'a:b', '-a', 'a"b', '(a)']) {
      expect(() => createQuerybar({ fields: { [bad]: { type: 'string' } } }), bad).toThrow(/can't be used/);
      expect(() => createQuerybar({ fields: { ok: { type: 'string', aliases: [bad] } } }), bad).toThrow(/can't be used/);
    }
    for (const good of ['a', '_a', 'a1', 'a.b', 'a-b', 'a_b', 'é', '작성자', 'Ünïcode']) {
      expect(() => createQuerybar({ fields: { [good]: { type: 'string' } } }), good).not.toThrow();
    }
  });

  it('rejects clashing names and aliases case-insensitively', () => {
    expect(() =>
      createQuerybar({ fields: { a: { type: 'string', aliases: ['b'] }, B: { type: 'string' } } }),
    ).toThrow(/clashes/);
    expect(() => createQuerybar({ fields: { a: { type: 'string', aliases: ['A'] } } })).toThrow(/clashes/);
  });

  it('supports an empty schema (free text only)', () => {
    const s = createQuerybar({ fields: {} });
    expect(s.filter(['x', 'y'], 'x')).toEqual(['x']);
    expect(s.suggest('').items).toEqual([]);
  });

  it('ignores inherited properties of the fields object', () => {
    const proto = { inherited: { type: 'string' } };
    const fields = Object.create(proto) as Record<string, never>;
    const s = createQuerybar({ fields });
    expect(s.parse('inherited:x').terms).toEqual([]);
    expect(s.parse('constructor:x __proto__:x').terms).toEqual([]);
  });
});

describe('public API surface', () => {
  it('exports exactly the documented runtime values', () => {
    expect(Object.keys(api).sort()).toEqual(['createQuerybar', 'stringify']);
  });

  it('exposes the schema', () => {
    expect(search.fields.is.type).toBe('enum');
  });

  it('returns plain, JSON-serialisable parse results', () => {
    const r = search.parse('is:open (label:bug OR -stars:>5) created:2024 "x"');
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it('instances are independent', () => {
    const a = createQuerybar({ fields: { x: { type: 'number' } } });
    const b = createQuerybar({ fields: { x: { type: 'string' } } });
    expect(a.parse('x:abc').valid).toBe(false);
    expect(b.parse('x:abc').valid).toBe(true);
  });

  it('accepts non-string input everywhere without throwing', () => {
    const odd = [undefined, null, 5, {}] as never[];
    for (const v of odd) {
      expect(() => search.parse(v)).not.toThrow();
      expect(() => search.tokenize(v)).not.toThrow();
      expect(() => search.suggest(v)).not.toThrow();
      expect(() => search.format(v)).not.toThrow();
      expect(() => search.filter([], v)).not.toThrow();
      expect(() => search.addFilter(v, 'is', 'open')).not.toThrow();
      expect(() => search.removeFilter(v, 'is')).not.toThrow();
    }
  });
});

describe('types', () => {
  it('infers field names and value types from the schema', () => {
    expectTypeOf(search).toEqualTypeOf<Querybar<typeof search.fields>>();
    expectTypeOf(search.parse('')).toEqualTypeOf<ParseResult>();

    const is = search.getValues('', 'is');
    expectTypeOf(is).toEqualTypeOf<Array<(Omit<EnumValue, 'value'> & { value: 'open' | 'closed' | 'draft' }) | ExistsValue>>();
    expectTypeOf(search.getValues('', 'stars')).toEqualTypeOf<Array<NumberValue | NumberRangeValue | ExistsValue>>();
    expectTypeOf(search.getValues('', 'created')).toEqualTypeOf<Array<DateValue | DateRangeValue | ExistsValue>>();
    expectTypeOf(search.getValues('', 'author')).toEqualTypeOf<Array<StringValue | ExistsValue>>();

    const s = createQuerybar({ fields: { state: { type: 'enum', values: ['a', 'b'] } } });
    const v = s.getValues('', 'state')[0];
    if (v && v.kind === 'enum') expectTypeOf(v.value).toEqualTypeOf<'a' | 'b'>();

    const test = search.compile<{ id: number }>('x');
    expectTypeOf(test).toEqualTypeOf<(item: { id: number }) => boolean>();
    expectTypeOf(search.filter([{ id: 1 }], 'x')).toEqualTypeOf<{ id: number }[]>();
  });

  it('rejects invalid schemas at compile time', () => {
    // @ts-expect-error unknown type
    expect(() => createQuerybar({ fields: { a: { type: 'nope' } } })).toThrow();
    // @ts-expect-error enum without values
    expect(() => createQuerybar({ fields: { a: { type: 'enum' } } })).toThrow();
  });
});
