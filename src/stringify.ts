import { safeRaw, formatText, formatValue } from './text';
import type { Node, TermNode, TermValue } from './types';

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

function formatInstant(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  if (y < 0 || y > 9999) return d.toISOString();
  return (
    `${pad(y, 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}Z`
  );
}

/**
 * Formats a value. Parsed values keep their original spelling (`raw`), so
 * `created:2024-05` stays `2024-05` rather than becoming a timestamp.
 */
export function formatTermValue(value: TermValue): string {
  if (typeof value.raw === 'string' && value.raw !== '') return safeRaw(value.raw);
  switch (value.kind) {
    case 'exists':
      return '*';
    case 'string':
      return value.wildcard
        ? value.parts.map((p) => (p === '' ? '' : formatValue(p, true))).join('*')
        : formatValue(value.value, true);
    case 'enum':
      return formatValue(value.value, true);
    case 'boolean':
      return String(value.value);
    case 'number':
      return String(value.value);
    case 'number-range':
      return `${value.min === null ? '*' : value.min}..${value.max === null ? '*' : value.max}`;
    case 'date':
      return formatInstant(value.from);
    case 'date-range':
      // `to` is exclusive; the last included millisecond is to - 1.
      return `${value.from === null ? '*' : formatInstant(value.from)}..${
        value.to === null ? '*' : formatInstant(value.to - 1)
      }`;
  }
}

export function formatTerm(node: TermNode): string {
  if (!node.valid && node.raw) return safeRaw(node.raw);
  const body = node.values.map(formatTermValue).join(',');
  // A value such as `>` (from `label:,>`) would otherwise be read as an operator.
  const op = node.op !== '=' ? node.op : /^[<>=]/.test(body) ? '=' : '';
  return `${node.field}:${op}${body}`;
}

export interface StringifyOptions {
  /** Write negation as `-x` (default). When `false`, `NOT x` is written instead. */
  negation?: boolean;
}

/** Turns a syntax tree back into query text. */
export function stringify(node: Node | null, options: StringifyOptions = {}): string {
  if (!node) return '';
  const dash = options.negation !== false;
  const str = (n: Node): string => stringify(n, options);
  switch (node.type) {
    case 'term':
      return formatTerm(node);
    case 'text':
      return formatText(node.value, node.quoted);
    case 'not': {
      const child = node.child;
      const simple = child.type === 'term' || child.type === 'text';
      if (dash) return simple ? '-' + str(child) : '-(' + str(child) + ')';
      // With `-` disabled (`negation: false`) only the NOT keyword negates.
      return simple || child.type === 'not' ? 'NOT ' + str(child) : 'NOT (' + str(child) + ')';
    }
    case 'and':
      return node.children
        .map((c) => (c.type === 'or' ? '(' + str(c) + ')' : str(c)))
        .filter((s) => s !== '')
        .join(' ');
    case 'or':
      return node.children
        .map((c) => (c.type === 'or' ? '(' + str(c) + ')' : str(c)))
        .filter((s) => s !== '')
        .join(' OR ');
  }
}
