import { describe, expect, it } from 'vitest';
import { issues, search } from './fixtures';

const time = (fn: () => void): number => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};

describe('stress', () => {
  it('survives very deep parenthesis nesting', () => {
    const q = '('.repeat(50000) + 'is:open' + ')'.repeat(50000);
    expect(() => search.parse(q)).not.toThrow();
    expect(() => search.filter(issues, q)).not.toThrow();
    expect(() => search.format(q)).not.toThrow();
    expect(() => search.tokenize(q)).not.toThrow();
    expect(() => search.suggest(q, 50003)).not.toThrow();
    expect(() => search.addFilter(q, 'label', 'x')).not.toThrow();
  });

  it('keeps moderate nesting fully structured', () => {
    const q = '('.repeat(90) + 'is:open OR is:draft' + ')'.repeat(90);
    expect(search.filter(issues, q).map((i) => i.id)).toEqual([1, 3, 4, 5]);
    expect(search.parse(q).diagnostics).toEqual([]);
  });

  it('survives very long negation chains, keeping parity', () => {
    const odd = 'NOT '.repeat(50001) + 'is:open';
    const even = 'NOT '.repeat(50000) + 'is:open';
    expect(search.filter(issues, odd).map((i) => i.id)).toEqual([2, 4]);
    expect(search.filter(issues, even).map((i) => i.id)).toEqual([1, 3, 5]);
    expect(search.format(odd)).toBe('-is:open');
    expect(search.format(even)).toBe('-(-is:open)');
    const nested = '-('.repeat(5000) + 'a' + ')'.repeat(5000);
    expect(() => search.filter(issues, nested)).not.toThrow();
    const tail = 'NOT '.repeat(10000);
    expect(search.parse(tail).ast).toBeNull();
  });

  it('handles long inputs in roughly linear time', () => {
    const words = Array.from({ length: 20000 }, (_, k) =>
      ['is:open', 'label:bug,ui', '-stars:<3', 'created:2024', 'hello', '"a b"', 'OR', 'stars:x', '(', ')'][k % 10],
    ).join(' ');
    const big = words + ' ' + words;
    let small = 0;
    let large = 0;
    small = time(() => {
      search.parse(words);
      search.tokenize(words);
    });
    large = time(() => {
      search.parse(big);
      search.tokenize(big);
    });
    // Generous bound: doubling the input must not take anywhere near 4x longer.
    expect(large).toBeLessThan(Math.max(small * 3.5, 250));
    expect(time(() => search.filter(issues, big))).toBeLessThan(2000);
  });

  it('handles huge single tokens and many errors quickly', () => {
    const q = 'label:' + 'x'.repeat(200000) + ' ' + 'stars:x '.repeat(20000);
    expect(time(() => search.tokenize(q))).toBeLessThan(2000);
    expect(time(() => search.suggest(q, 100))).toBeLessThan(2000);
  });

  it('handles lone surrogates and control characters', () => {
    const q = '\ud800 is:open \udfff \u0000 \u001f label:"\ud83d"';
    expect(() => search.parse(q)).not.toThrow();
    expect(search.tokenize(q).map((t) => t.text).join('')).toBe(q);
    expect(search.filter(issues, q)).toEqual([]);
    expect(search.parse(search.format(q)).valid).toBe(true);
  });
});
