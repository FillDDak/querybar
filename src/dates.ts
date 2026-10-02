export interface DateContext {
  now: number;
  utc: boolean;
}

export interface Interval {
  start: number;
  end: number;
}

interface Parts {
  y: number;
  mo: number; // 0-based
  d: number;
  h: number;
  mi: number;
  s: number;
  ms: number;
}

/** Builds a timestamp from calendar parts; out-of-range parts roll over. */
function make(p: Parts, utc: boolean): number {
  const date = new Date(0);
  if (utc) {
    date.setUTCFullYear(p.y, p.mo, p.d);
    date.setUTCHours(p.h, p.mi, p.s, p.ms);
  } else {
    // `new Date(y, ...)` maps years 0-99 to 1900-1999, so set the year explicitly.
    date.setFullYear(p.y, p.mo, p.d);
    date.setHours(p.h, p.mi, p.s, p.ms);
  }
  return date.getTime();
}

function parts(time: number, utc: boolean): Parts {
  const d = new Date(time);
  return utc
    ? {
        y: d.getUTCFullYear(),
        mo: d.getUTCMonth(),
        d: d.getUTCDate(),
        h: d.getUTCHours(),
        mi: d.getUTCMinutes(),
        s: d.getUTCSeconds(),
        ms: d.getUTCMilliseconds(),
      }
    : {
        y: d.getFullYear(),
        mo: d.getMonth(),
        d: d.getDate(),
        h: d.getHours(),
        mi: d.getMinutes(),
        s: d.getSeconds(),
        ms: d.getMilliseconds(),
      };
}

function daysInMonth(y: number, mo: number): number {
  // Day 0 of the next month is the last day of this one (UTC: no DST issues).
  const date = new Date(0);
  date.setUTCFullYear(y, mo + 1, 0);
  return date.getUTCDate();
}

function startOfDay(time: number, utc: boolean, offsetDays: number): number {
  const p = parts(time, utc);
  return make({ y: p.y, mo: p.mo, d: p.d + offsetDays, h: 0, mi: 0, s: 0, ms: 0 }, utc);
}

/** Moves `time` back by whole calendar months, clamping the day (Mar 31 → Feb 29). */
function subtractMonths(time: number, months: number, utc: boolean): number {
  const p = parts(time, utc);
  const total = p.y * 12 + p.mo - months;
  const y = Math.floor(total / 12);
  const mo = total - y * 12;
  const d = Math.min(p.d, daysInMonth(y, mo));
  return make({ ...p, y, mo, d }, utc);
}

function subtractDays(time: number, days: number, utc: boolean): number {
  const p = parts(time, utc);
  return make({ ...p, d: p.d - days }, utc);
}

const ABSOLUTE =
  /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?)?)?$/i;
const RELATIVE = /^(\d{1,6})(min|h|d|w|mo|y)$/i;

/**
 * Parses a date expression into an interval `[start, end)`:
 * `2024`, `2024-05`, `2024-05-17`, `2024-05-17T10:30`, `...:15.250Z`,
 * `today`, `yesterday`, `tomorrow`, `now`, and relative points such as `7d`.
 * Returns `null` if the expression is not a valid date.
 */
export function parseDate(raw: string, ctx: DateContext): Interval | null {
  const text = raw.trim();
  const lower = text.toLowerCase();
  const { now, utc } = ctx;

  if (lower === 'now') return { start: now, end: now };
  if (lower === 'today' || lower === 'yesterday' || lower === 'tomorrow') {
    const offset = lower === 'today' ? 0 : lower === 'yesterday' ? -1 : 1;
    return { start: startOfDay(now, utc, offset), end: startOfDay(now, utc, offset + 1) };
  }

  const rel = RELATIVE.exec(text);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2]!.toLowerCase();
    let point: number;
    switch (unit) {
      case 'min':
        point = now - n * 60000;
        break;
      case 'h':
        point = now - n * 3600000;
        break;
      case 'd':
        point = subtractDays(now, n, utc);
        break;
      case 'w':
        point = subtractDays(now, n * 7, utc);
        break;
      case 'mo':
        point = subtractMonths(now, n, utc);
        break;
      default:
        point = subtractMonths(now, n * 12, utc);
    }
    return Number.isFinite(point) ? { start: point, end: point } : null;
  }

  const m = ABSOLUTE.exec(text);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = m[2] !== undefined ? Number(m[2]) - 1 : 0;
  const d = m[3] !== undefined ? Number(m[3]) : 1;
  const h = m[4] !== undefined ? Number(m[4]) : 0;
  const mi = m[5] !== undefined ? Number(m[5]) : 0;
  const s = m[6] !== undefined ? Number(m[6]) : 0;
  const frac = m[7];
  const ms = frac !== undefined ? Number((frac + '00').slice(0, 3)) : 0;
  const zone = m[8];

  if (mo < 0 || mo > 11) return null;
  if (d < 1 || d > daysInMonth(y, mo)) return null;
  if (h > 23 || mi > 59 || s > 59) return null;

  let offset: number | null = null;
  if (zone !== undefined) {
    if (zone.toUpperCase() === 'Z') {
      offset = 0;
    } else {
      const sign = zone[0] === '-' ? -1 : 1;
      const digits = zone.slice(1).replace(':', '');
      const oh = Number(digits.slice(0, 2));
      const om = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
      if (oh > 23 || om > 59) return null;
      offset = sign * (oh * 60 + om) * 60000;
    }
  }

  const p: Parts = { y, mo, d, h, mi, s, ms };
  const zoned = offset !== null;
  const useUtc = zoned || utc;
  const start = make(p, useUtc) - (offset ?? 0);

  let end: number;
  if (m[2] === undefined) end = make({ ...p, y: y + 1 }, useUtc) - (offset ?? 0);
  else if (m[3] === undefined) end = make({ ...p, mo: mo + 1 }, useUtc) - (offset ?? 0);
  else if (m[4] === undefined) end = make({ ...p, d: d + 1 }, useUtc) - (offset ?? 0);
  else if (m[6] === undefined) end = start + 60000;
  else if (frac === undefined) end = start + 1000;
  else end = start + Math.max(1, Math.pow(10, 3 - Math.min(3, frac.length)));

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end };
}

/** Converts an item value (Date, epoch ms or date string) to epoch ms. */
export function toTime(value: unknown): number | null {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

