import { parseDate, type DateContext } from './dates';
import type { Item } from './scanner';
import { closest } from './text';
import type { DiagnosticCode, FieldDef, Operator, TermValue } from './types';

export interface ConvertError {
  code: DiagnosticCode;
  message: string;
  suggestion?: string;
}

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const TRUE_WORDS = ['true', 'yes', 'on', '1'];
const FALSE_WORDS = ['false', 'no', 'off', '0'];

function parseNumber(text: string, field: FieldDef & { type: 'number' }, name: string): number | ConvertError {
  const trimmed = text.trim();
  if (!NUMBER.test(trimmed)) {
    return { code: 'invalid-value', message: `"${text}" is not a number (field "${name}").` };
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    return { code: 'invalid-value', message: `"${text}" is out of range (field "${name}").` };
  }
  if (field.integer && !Number.isInteger(n)) {
    return { code: 'invalid-value', message: `Field "${name}" expects a whole number, got "${text}".` };
  }
  if (field.min !== undefined && n < field.min) {
    return { code: 'invalid-value', message: `Field "${name}" must be at least ${field.min}.` };
  }
  if (field.max !== undefined && n > field.max) {
    return { code: 'invalid-value', message: `Field "${name}" must be at most ${field.max}.` };
  }
  return n;
}

/** Splits `a..b` (only for unquoted items). Returns null when not a range. */
function splitRange(item: Item): [string, string] | null {
  if (item.quoted) return null;
  const at = item.value.indexOf('..');
  if (at === -1) return null;
  return [item.value.slice(0, at), item.value.slice(at + 2)];
}

const isOpen = (side: string): boolean => side === '' || side === '*';

/**
 * Converts one scanned item into a typed value for `field`, or explains why
 * it can't. `listed` is true when the term has several comma-separated items.
 */
export function convertItem(
  item: Item,
  raw: string,
  name: string,
  field: FieldDef,
  op: Operator,
  listed: boolean,
  dates: DateContext,
): TermValue | ConvertError {
  const span = { start: item.start, end: item.end, raw };

  if (!item.quoted && item.value === '*') {
    if (op !== '=') {
      return { code: 'invalid-operator', message: `"*" (any value) can't be combined with "${op}".` };
    }
    return { kind: 'exists', ...span };
  }

  if (op !== '=' && listed) {
    return {
      code: 'invalid-operator',
      message: `A comparison ("${op}") can't be combined with a comma-separated list.`,
    };
  }

  switch (field.type) {
    case 'string': {
      if (op !== '=') {
        return { code: 'invalid-operator', message: `Field "${name}" doesn't support "${op}".` };
      }
      return {
        kind: 'string',
        value: item.value,
        wildcard: item.parts.length > 1,
        parts: item.parts,
        ...span,
      };
    }

    case 'number': {
      const range = splitRange(item);
      if (range) {
        if (op !== '=') {
          return { code: 'invalid-operator', message: `A range can't be combined with "${op}".` };
        }
        const [lo, hi] = range;
        let min: number | null = null;
        let max: number | null = null;
        if (!isOpen(lo)) {
          const n = parseNumber(lo, field, name);
          if (typeof n !== 'number') return n;
          min = n;
        }
        if (!isOpen(hi)) {
          const n = parseNumber(hi, field, name);
          if (typeof n !== 'number') return n;
          max = n;
        }
        if (min === null && max === null) {
          return { code: 'invalid-range', message: `The range "${item.value}" has no bounds.` };
        }
        if (min !== null && max !== null && min > max) {
          return { code: 'invalid-range', message: `The range "${item.value}" is empty (${min} > ${max}).` };
        }
        return { kind: 'number-range', min, max, ...span };
      }
      const n = parseNumber(item.value, field, name);
      if (typeof n !== 'number') return n;
      return { kind: 'number', value: n, ...span };
    }

    case 'date': {
      const range = splitRange(item);
      if (range) {
        if (op !== '=') {
          return { code: 'invalid-operator', message: `A range can't be combined with "${op}".` };
        }
        const [lo, hi] = range;
        let start: number | null = null;
        let end: number | null = null;
        if (!isOpen(lo)) {
          const iv = parseDate(lo, dates);
          if (!iv) return { code: 'invalid-value', message: `"${lo}" is not a valid date (field "${name}").` };
          start = iv.start;
        }
        if (!isOpen(hi)) {
          const iv = parseDate(hi, dates);
          if (!iv) return { code: 'invalid-value', message: `"${hi}" is not a valid date (field "${name}").` };
          // A relative point (7d) is an inclusive bound; anything else covers its whole period.
          end = iv.end === iv.start ? iv.end + 1 : iv.end;
        }
        if (start === null && end === null) {
          return { code: 'invalid-range', message: `The range "${item.value}" has no bounds.` };
        }
        if (start !== null && end !== null && start >= end) {
          return { code: 'invalid-range', message: `The range "${item.value}" is empty.` };
        }
        return { kind: 'date-range', from: start, to: end, ...span };
      }
      const iv = parseDate(item.value, dates);
      if (!iv) {
        return {
          code: 'invalid-value',
          message: `"${item.value}" is not a valid date (field "${name}"). Try 2024-05-17, 2024-05, today or 7d.`,
        };
      }
      return { kind: 'date', from: iv.start, to: iv.end, ...span };
    }

    case 'boolean': {
      if (op !== '=') {
        return { code: 'invalid-operator', message: `Field "${name}" doesn't support "${op}".` };
      }
      const lower = item.value.trim().toLowerCase();
      if (TRUE_WORDS.indexOf(lower) !== -1) return { kind: 'boolean', value: true, ...span };
      if (FALSE_WORDS.indexOf(lower) !== -1) return { kind: 'boolean', value: false, ...span };
      return {
        code: 'invalid-value',
        message: `Field "${name}" expects true or false, got "${item.value}".`,
        suggestion: closest(lower, ['true', 'false']),
      };
    }

    case 'enum': {
      if (op !== '=') {
        return { code: 'invalid-operator', message: `Field "${name}" doesn't support "${op}".` };
      }
      const lower = item.value.toLowerCase();
      for (const v of field.values) {
        if (v.toLowerCase() === lower) return { kind: 'enum', value: v, ...span };
      }
      const suggestion = closest(item.value, field.values);
      return {
        code: 'invalid-value',
        message:
          `"${item.value}" is not a valid value for "${name}".` +
          (suggestion !== undefined ? ` Did you mean "${suggestion}"?` : '') +
          ` Expected one of: ${field.values.join(', ')}.`,
        suggestion,
      };
    }
  }
}

export function isConvertError(value: TermValue | ConvertError): value is ConvertError {
  return (value as ConvertError).code !== undefined;
}
