import { describe, expect, it } from 'vitest';
import { createQuerybar, type Node } from '../src/index';
import { search } from './fixtures';

/** Compact, span-free rendering of a tree for readable assertions. */
function shape(node: Node | null): unknown {
  if (!node) return null;
  switch (node.type) {
    case 'term':
      return `${node.field}${node.op === '=' ? ':' : ':' + node.op}${node.values
        .map((v) => ('value' in v ? String(v.value) : v.kind === 'exists' ? '*' : v.raw))
        .join('|')}${node.valid ? '' : '!'}`;
    case 'text':
      return node.quoted ? `"${node.value}"` : node.value;
    case 'not':
      return { not: shape(node.child) };
    case 'and':
      return { and: node.children.map(shape) };
    case 'or':
      return { or: node.children.map(shape) };
  }
}

const p = (q: string) => shape(search.parse(q).ast);
const codes = (q: string) => search.parse(q).diagnostics.map((d) => d.code);

describe('parse: basics', () => {
  it('returns null ast for empty and whitespace-only input', () => {
    for (const q of ['', ' ', '\t\n  ', '\u00a0']) {
      const r = search.parse(q);
      expect(r.ast).toBeNull();
      expect(r.diagnostics).toEqual([]);
      expect(r.valid).toBe(true);
      expect(r.conjunctive).toBe(true);
    }
  });

  it('never throws on non-string input', () => {
    expect(search.parse(undefined as never).ast).toBeNull();
    expect(search.parse(null as never).ast).toBeNull();
    expect(p(42 as never)).toBe('42');
  });

  it('parses free text words and phrases', () => {
    expect(p('hello')).toBe('hello');
    expect(p('hello world')).toEqual({ and: ['hello', 'world'] });
    expect(p('"hello world"')).toBe('"hello world"');
    expect(p('say "hi there" now')).toEqual({ and: ['say', '"hi there"', 'now'] });
  });

  it('parses qualifiers with canonical field names, aliases and any key casing', () => {
    expect(p('is:open')).toBe('is:open');
    expect(p('IS:OPEN')).toBe('is:open');
    expect(p('by:alice')).toBe('author:alice');
    expect(p('By:alice')).toBe('author:alice');
    const term = search.parse('By:alice').terms[0]!;
    expect(term.key).toBe('By');
    expect(term.field).toBe('author');
    expect(term.raw).toBe('By:alice');
  });

  it('parses comma lists as alternatives', () => {
    expect(p('label:bug,ui')).toBe('label:bug|ui');
    expect(p('label:bug,"good first issue"')).toBe('label:bug|good first issue');
  });

  it('treats quoted text inside a value as one value', () => {
    expect(p('label:"a, b"')).toBe('label:a, b');
    expect(p('label:"a (b)"')).toBe('label:a (b)');
    expect(p('author:"O\'Brien"')).toBe("author:O'Brien");
  });

  it('concatenates adjacent quoted and bare segments', () => {
    expect(p('label:"good "first')).toBe('label:good first');
    expect(p('"foo"bar')).toBe('"foobar"');
  });

  it('handles escapes inside quotes', () => {
    expect(p('"say \\"hi\\""')).toBe('"say "hi""');
    expect(p('"back\\\\slash"')).toBe('"back\\slash"');
    // A backslash before anything else is literal (Windows paths survive).
    expect(p('"C:\\path\\file"')).toBe('"C:\\path\\file"');
    expect(p('C:\\path')).toBe('C:\\path');
  });

  it('parses comparison operators', () => {
    expect(p('stars:>10')).toBe('stars:>10');
    expect(p('stars:>=10')).toBe('stars:>=10');
    expect(p('stars:<10')).toBe('stars:<10');
    expect(p('stars:<=10')).toBe('stars:<=10');
    expect(p('stars:=10')).toBe('stars:10');
  });

  it('records exact spans', () => {
    const r = search.parse('  is:open  -label:bug ');
    const [a, b] = (r.ast as { children: Node[] }).children;
    expect([a!.start, a!.end]).toEqual([2, 9]);
    expect([b!.start, b!.end]).toEqual([11, 21]);
    const term = r.terms[1]!;
    expect(r.input.slice(term.start, term.end)).toBe('label:bug');
    expect(r.input.slice(term.values[0]!.start, term.values[0]!.end)).toBe('bug');
  });

  it('collects terms and text in source order', () => {
    const r = search.parse('a is:open (b OR label:x) -c');
    expect(r.terms.map((t) => t.field)).toEqual(['is', 'label']);
    expect(r.text.map((t) => t.value)).toEqual(['a', 'b', 'c']);
  });

  it('keeps unicode keys and values', () => {
    const s = createQuerybar({ fields: { 작성자: { type: 'string' }, état: { type: 'string' } } });
    expect(shape(s.parse('작성자:홍길동 état:ouvert').ast)).toEqual({ and: ['작성자:홍길동', 'état:ouvert'] });
  });
});

describe('parse: boolean structure', () => {
  it('uses implicit AND', () => {
    expect(p('a b c')).toEqual({ and: ['a', 'b', 'c'] });
    expect(p('a AND b')).toEqual({ and: ['a', 'b'] });
  });

  it('gives AND precedence over OR', () => {
    expect(p('a b OR c')).toEqual({ or: [{ and: ['a', 'b'] }, 'c'] });
    expect(p('a OR b c')).toEqual({ or: ['a', { and: ['b', 'c'] }] });
    expect(p('a OR b OR c')).toEqual({ or: ['a', 'b', 'c'] });
  });

  it('supports parentheses', () => {
    expect(p('(a OR b) c')).toEqual({ and: [{ or: ['a', 'b'] }, 'c'] });
    expect(p('((a))')).toBe('a');
    expect(p('(a b) c')).toEqual({ and: ['a', 'b', 'c'] });
    expect(p('a (b OR (c d))')).toEqual({ and: ['a', { or: ['b', { and: ['c', 'd'] }] }] });
  });

  it('supports negation with -, ! and NOT', () => {
    expect(p('-a')).toEqual({ not: 'a' });
    expect(p('!a')).toEqual({ not: 'a' });
    expect(p('NOT a')).toEqual({ not: 'a' });
    expect(p('-label:bug')).toEqual({ not: 'label:bug' });
    expect(p('-(a OR b)')).toEqual({ not: { or: ['a', 'b'] } });
    expect(p('NOT (a b)')).toEqual({ not: { and: ['a', 'b'] } });
    expect(p('NOT NOT a')).toEqual({ not: { not: 'a' } });
    expect(p('a NOT b')).toEqual({ and: ['a', { not: 'b' }] });
  });

  it('does not treat a dash inside a word or value as negation', () => {
    expect(p('e-mail')).toBe('e-mail');
    expect(p('stars:-5')).toBe('stars:-5');
    expect(p('--a')).toEqual({ not: '-a' });
  });

  it('only treats uppercase AND/OR/NOT as keywords', () => {
    expect(p('a or b')).toEqual({ and: ['a', 'or', 'b'] });
    expect(p('a and b')).toEqual({ and: ['a', 'and', 'b'] });
    expect(p('"OR"')).toBe('"OR"');
    expect(p('ORANGE')).toBe('ORANGE');
    expect(p('-OR')).toEqual({ not: 'OR' });
  });

  it('reports conjunctive queries', () => {
    expect(search.parse('a -b is:open').conjunctive).toBe(true);
    expect(search.parse('a OR b').conjunctive).toBe(false);
    expect(search.parse('a (b OR c)').conjunctive).toBe(false);
    expect(search.parse('-(a b)').conjunctive).toBe(false);
    expect(search.parse('(a b) c').conjunctive).toBe(true);
  });

  it('can disable operators', () => {
    const s = createQuerybar({ fields: {}, operators: false });
    expect(shape(s.parse('a OR (b)').ast)).toEqual({ and: ['a', 'OR', '(b)'] });
    expect(shape(s.parse('-x').ast)).toEqual({ not: 'x' });
  });

  it('can disable negation', () => {
    const s = createQuerybar({ fields: { is: { type: 'string' } }, negation: false });
    expect(shape(s.parse('-x !y').ast)).toEqual({ and: ['-x', '!y'] });
    // Formatting then writes NOT, because `-` is plain text in this syntax.
    expect(s.format('NOT is:open')).toBe('NOT is:open');
    expect(s.format('NOT (a OR b)')).toBe('NOT (a OR b)');
    expect(s.format('NOT NOT a')).toBe('NOT NOT a');
    expect(s.format('-x')).toBe('"-x"');
    expect(s.addFilter('NOT a', 'is', 'open')).toBe('NOT a is:open');
  });
});

describe('parse: error recovery', () => {
  it('recovers from an unterminated quote', () => {
    expect(p('label:"good first')).toBe('label:good first');
    expect(p('"hello wor')).toBe('"hello wor"');
    expect(codes('"hello wor')).toEqual(['unterminated-quote']);
    expect(search.parse('"abc').valid).toBe(true);
  });

  it('recovers from unbalanced parentheses', () => {
    expect(p('(a OR b')).toEqual({ or: ['a', 'b'] });
    expect(codes('(a OR b')).toEqual(['unclosed-paren']);
    expect(p('a) b')).toEqual({ and: ['a)', 'b'] });
    expect(p('a ) b')).toEqual({ and: ['a', 'b'] });
    expect(codes('a ) b')).toEqual(['unmatched-paren']);
    expect(p('(a)) b')).toEqual({ and: ['a', 'b'] });
    expect(codes('(a)) b')).toEqual(['unmatched-paren']);
  });

  it('ignores empty groups', () => {
    expect(p('()')).toBeNull();
    expect(p('a () b')).toEqual({ and: ['a', 'b'] });
    expect(codes('a () b')).toEqual(['empty-group']);
  });

  it('ignores dangling operators', () => {
    expect(p('OR')).toBeNull();
    expect(p('a OR')).toBe('a');
    expect(p('OR a')).toBe('a');
    expect(p('a OR OR b')).toEqual({ or: ['a', 'b'] });
    expect(p('a AND')).toBe('a');
    expect(p('AND a')).toBe('a');
    expect(p('NOT')).toBeNull();
    expect(p('a NOT')).toBe('a');
    expect(p('a - b')).toEqual({ and: ['a', 'b'] });
    expect(p('a -')).toBe('a');
    expect(p('(NOT)')).toBeNull();
    for (const q of ['a OR', 'OR a', 'a AND', 'NOT', 'a -', '-']) {
      expect(codes(q)).toContain('dangling-operator');
      expect(search.parse(q).valid).toBe(true);
    }
  });

  it('reports a missing value as an error but keeps the term', () => {
    const r = search.parse('label:');
    expect(r.diagnostics.map((d) => d.code)).toEqual(['missing-value']);
    expect(r.valid).toBe(false);
    expect(r.terms[0]!.valid).toBe(false);
    expect(codes('label:,')).toEqual(['missing-value']);
  });

  it('handles unknown fields as text by default', () => {
    expect(p('foo:bar')).toBe('foo:bar');
    expect(p('http://example.com')).toBe('http://example.com');
    // URLs are text without a warning; `unknownFields: 'error'` doesn't apply to them either.
    expect(codes('see https://example.com/a,b')).toEqual([]);
    const strict = createQuerybar({ fields: {}, unknownFields: 'error' });
    expect(strict.parse('https://x.io').valid).toBe(true);
    expect(strict.tokenize('https://x.io').map((t) => t.type)).toEqual(['text']);
    const r = search.parse('lable:bug');
    expect(r.diagnostics[0]).toMatchObject({ code: 'unknown-field', severity: 'warning', suggestion: 'label' });
    expect(r.valid).toBe(true);
  });

  it('can report unknown fields as errors', () => {
    const s = createQuerybar({ fields: { label: { type: 'string' } }, unknownFields: 'error' });
    const r = s.parse('lable:bug');
    expect(r.valid).toBe(false);
    expect(r.diagnostics[0]).toMatchObject({ code: 'unknown-field', severity: 'error', start: 0, end: 5 });
    expect(r.terms[0]!.valid).toBe(false);
  });

  it('does not treat times or non-keys as qualifiers', () => {
    expect(p('12:30')).toBe('12:30');
    expect(p(':foo')).toBe(':foo');
    expect(p('a:')).toBe('a:');
  });

  it('sorts diagnostics by position', () => {
    const d = search.parse('stars:x (a is:nope').diagnostics;
    const starts = d.map((x) => x.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });
});
