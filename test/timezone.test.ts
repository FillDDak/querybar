import { describe, expect, it } from 'vitest';
import { createQuerybar } from '../src/index';

/**
 * These tests hold in any time zone. `npm run test:tz` runs the suite under
 * zones with DST, half-hour/45-minute offsets and midnight DST transitions.
 */
const localMidnight = (y: number, m: number, d: number): number => {
  const date = new Date(0);
  date.setFullYear(y, m, d);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const local = createQuerybar({ fields: { d: { type: 'date' } }, timeZone: 'local' });
const utc = createQuerybar({ fields: { d: { type: 'date' } } });

const interval = (s: typeof local, q: string): [number, number] => {
  const v = s.parse(q).terms[0]!.values[0]!;
  if (v.kind !== 'date') throw new Error(q);
  return [v.from, v.to];
};

const pad = (n: number) => String(n).padStart(2, '0');

describe('local time zone', () => {
  it('maps every day of a year to local midnight..next local midnight', () => {
    for (let day = 0; day < 366; day++) {
      const date = new Date(Date.UTC(2024, 0, 1 + day));
      const y = date.getUTCFullYear();
      const m = date.getUTCMonth();
      const d = date.getUTCDate();
      const q = `d:${y}-${pad(m + 1)}-${pad(d)}`;
      expect(interval(local, q), q).toEqual([localMidnight(y, m, d), localMidnight(y, m, d + 1)]);
    }
  });

  it('maps months and years to local calendar boundaries', () => {
    for (let m = 0; m < 12; m++) {
      expect(interval(local, `d:2024-${pad(m + 1)}`)).toEqual([localMidnight(2024, m, 1), localMidnight(2024, m + 1, 1)]);
    }
    expect(interval(local, 'd:2024')).toEqual([localMidnight(2024, 0, 1), localMidnight(2025, 0, 1)]);
  });

  it('computes today and relative days on the local calendar', () => {
    for (let h = 0; h < 24 * 8; h += 5) {
      const now = Date.UTC(2024, 2, 7) + h * 3600000; // spans many DST switch dates
      const s = createQuerybar({ fields: { d: { type: 'date' } }, timeZone: 'local', now: () => now });
      const n = new Date(now);
      const [from, to] = interval(s, 'd:today');
      expect(from).toBe(localMidnight(n.getFullYear(), n.getMonth(), n.getDate()));
      expect(to).toBe(localMidnight(n.getFullYear(), n.getMonth(), n.getDate() + 1));
      expect(from).toBeLessThanOrEqual(now);
      expect(to).toBeGreaterThan(now);
      const [weekAgo] = interval(s, 'd:7d');
      const expected = new Date(now);
      expected.setDate(expected.getDate() - 7);
      expect(weekAgo).toBe(expected.getTime());
    }
  });

  it('keeps explicit offsets independent of the time zone', () => {
    expect(interval(local, 'd:2024-05-17T10:30+09:00')[0]).toBe(Date.UTC(2024, 4, 17, 1, 30));
    expect(interval(local, 'd:2024-05-17T10:30Z')[0]).toBe(Date.UTC(2024, 4, 17, 10, 30));
  });

  it('UTC mode ignores the machine time zone entirely', () => {
    expect(interval(utc, 'd:2024-03-10')).toEqual([Date.UTC(2024, 2, 10), Date.UTC(2024, 2, 11)]);
    const s = createQuerybar({ fields: { d: { type: 'date' } }, now: () => Date.UTC(2024, 2, 10, 23, 30) });
    expect(interval(s, 'd:today')).toEqual([Date.UTC(2024, 2, 10), Date.UTC(2024, 2, 11)]);
  });
});
