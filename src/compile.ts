import { toTime } from './dates';
import { fold, globMatch } from './text';
import type { FieldDef, Node, Operator, StringField, TermValue } from './types';

export interface CompileConfig {
  fields: Record<string, FieldDef>;
  text: boolean | readonly string[] | ((item: any) => unknown);
  ignoreDiacritics: boolean;
}

type Test = (item: any, ctx: EvalContext) => boolean;

interface EvalContext {
  haystack?: string[];
}

export function getPath(item: unknown, path: string): unknown {
  if (item == null) return undefined;
  if (typeof item === 'object' && path in (item as object)) return (item as Record<string, unknown>)[path];
  let cur: unknown = item;
  for (const key of path.split('.')) {
    if (cur == null || (typeof cur !== 'object' && typeof cur !== 'function')) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function fieldGetter(name: string, field: FieldDef): (item: any) => unknown {
  if (field.get) return field.get;
  const path = field.path ?? name;
  return (item) => getPath(item, path);
}

/** Flattens arrays (one level deep is enough for most data; recurse anyway). */
function eachValue(value: unknown, fn: (v: unknown) => boolean): boolean {
  if (Array.isArray(value)) {
    for (const v of value) if (eachValue(v, fn)) return true;
    return false;
  }
  if (value instanceof Set) {
    for (const v of value) if (eachValue(v, fn)) return true;
    return false;
  }
  return fn(value);
}

function isEmpty(value: unknown): boolean {
  if (value == null || value === '') return true;
  if (typeof value === 'number' && Number.isNaN(value)) return true;
  if (value instanceof Date) return Number.isNaN(value.getTime());
  if (Array.isArray(value)) return value.every(isEmpty);
  if (value instanceof Set) return value.size === 0;
  return false;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  }
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value == null) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (['true', 'yes', 'on', '1'].indexOf(lower) !== -1) return true;
    if (['false', 'no', 'off', '0', ''].indexOf(lower) !== -1) return false;
  }
  return null;
}

function compare(x: number, op: Operator, v: number): boolean {
  switch (op) {
    case '=':
      return x === v;
    case '>':
      return x > v;
    case '>=':
      return x >= v;
    case '<':
      return x < v;
    case '<=':
      return x <= v;
  }
}

function compareInterval(x: number, op: Operator, start: number, end: number): boolean {
  const point = start === end;
  switch (op) {
    case '=':
      // A bare relative point (`updated:7d`) means "since then".
      return point ? x >= start : x >= start && x < end;
    case '>':
      return point ? x > start : x >= end;
    case '>=':
      return x >= start;
    case '<':
      return x < start;
    case '<=':
      return point ? x <= start : x < end;
  }
}

function stringTest(field: StringField, value: TermValue & { kind: 'string' }, diacritics: boolean): (v: unknown) => boolean {
  const cs = field.caseSensitive === true;
  const f = (s: string): string => fold(s, cs, diacritics);
  const asString = (v: unknown): string | null =>
    typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint' ? String(v) : null;
  if (value.wildcard) {
    const parts = value.parts.map(f);
    return (v) => {
      const s = asString(v);
      return s !== null && globMatch(parts, f(s));
    };
  }
  const needle = f(value.value);
  const mode = field.mode ?? 'exact';
  return (v) => {
    const s = asString(v);
    if (s === null) return false;
    const hay = f(s);
    return mode === 'contains' ? hay.indexOf(needle) !== -1 : mode === 'startsWith' ? hay.startsWith(needle) : hay === needle;
  };
}

function valueTest(field: FieldDef, op: Operator, value: TermValue, diacritics: boolean): (v: unknown) => boolean {
  switch (value.kind) {
    case 'exists':
      return (v) => !isEmpty(v);
    case 'string':
      return stringTest(field as StringField, value, diacritics);
    case 'enum': {
      const needle = value.value.toLowerCase();
      return (v) =>
        (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') && String(v).toLowerCase() === needle;
    }
    case 'boolean':
      return (v) => toBoolean(v) === value.value;
    case 'number':
      return (v) => {
        const n = toNumber(v);
        return n !== null && compare(n, op, value.value);
      };
    case 'number-range':
      return (v) => {
        const n = toNumber(v);
        return n !== null && (value.min === null || n >= value.min) && (value.max === null || n <= value.max);
      };
    case 'date':
      return (v) => {
        const t = toTime(v);
        return t !== null && compareInterval(t, op, value.from, value.to);
      };
    case 'date-range':
      return (v) => {
        const t = toTime(v);
        return t !== null && (value.from === null || t >= value.from) && (value.to === null || t < value.to);
      };
  }
}

function defaultText(item: unknown): unknown {
  if (item == null) return [];
  if (typeof item !== 'object') return item;
  const out: unknown[] = [];
  for (const key of Object.keys(item as object)) {
    const v = (item as Record<string, unknown>)[key];
    if (typeof v === 'string' || typeof v === 'number') out.push(v);
    else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string' || typeof x === 'number') out.push(x);
  }
  return out;
}

function collectStrings(value: unknown, out: string[]): void {
  if (value == null) return;
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
  } else if (typeof value === 'string') {
    out.push(value);
  } else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    out.push(String(value));
  } else if (value instanceof Date && !Number.isNaN(value.getTime())) {
    out.push(value.toISOString());
  }
}

export function compile(ast: Node | null, config: CompileConfig): (item: any) => boolean {
  const diacritics = config.ignoreDiacritics;
  const textSource = config.text;
  const extractText: ((item: any) => unknown) | null =
    textSource === false
      ? null
      : textSource === true
        ? defaultText
        : typeof textSource === 'function'
          ? textSource
          : (item) => textSource.map((path) => getPath(item, path));

  const haystack = (item: any, ctx: EvalContext): string[] => {
    if (!ctx.haystack) {
      const strings: string[] = [];
      collectStrings(extractText!(item), strings);
      ctx.haystack = strings.map((s) => fold(s, false, diacritics));
    }
    return ctx.haystack;
  };

  const build = (node: Node): Test | null => {
    switch (node.type) {
      case 'text': {
        if (!extractText) return null;
        const needle = fold(node.value, false, diacritics);
        if (needle === '') return null;
        return (item, ctx) => haystack(item, ctx).some((h) => h.indexOf(needle) !== -1);
      }
      case 'term': {
        if (!node.valid || node.values.length === 0) return null;
        const field = config.fields[node.field];
        if (!field || field.filter === false) return null;
        if (typeof field.filter === 'function') {
          const custom = field.filter;
          const t = node;
          return (item) => custom(item, t);
        }
        const get = fieldGetter(node.field, field);
        const tests = node.values.map((v) => valueTest(field, node.op, v, diacritics));
        return (item) => {
          const value = get(item);
          for (const test of tests) if (eachValue(value, test)) return true;
          return false;
        };
      }
      case 'not': {
        const inner = build(node.child);
        return inner ? (item, ctx) => !inner(item, ctx) : null;
      }
      case 'and': {
        const parts = node.children.map(build).filter((t): t is Test => t !== null);
        if (parts.length === 0) return null;
        if (parts.length === 1) return parts[0]!;
        return (item, ctx) => parts.every((t) => t(item, ctx));
      }
      case 'or': {
        const parts = node.children.map(build).filter((t): t is Test => t !== null);
        if (parts.length === 0) return null;
        if (parts.length === 1) return parts[0]!;
        return (item, ctx) => parts.some((t) => t(item, ctx));
      }
    }
  };

  const root = ast ? build(ast) : null;
  if (!root) return () => true;
  return (item) => root(item, {});
}
