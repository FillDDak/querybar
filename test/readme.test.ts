/**
 * Every code example and claimed output in README.md, executed.
 * If the README changes, update this file too (and vice versa).
 */
import { describe, expect, it } from 'vitest';
import { createQuerybar, type Diagnostic, type DiagnosticCode, type Node, type TermValue } from '../src/index';

const search = createQuerybar({
  fields: {
    is: { type: 'enum', values: ['open', 'closed', 'draft'], description: 'Issue state' },
    author: { type: 'string', aliases: ['by'], suggestions: ['alice', 'bob'] },
    label: { type: 'string', suggestions: ['bug', 'good first issue'] },
    title: { type: 'string', mode: 'contains' },
    stars: { type: 'number', integer: true, min: 0 },
    created: { type: 'date' },
    archived: { type: 'boolean' },
    sort: { type: 'enum', values: ['newest', 'stars'], filter: false },
  },
  text: ['title', 'body'],
});

describe('README: quick start', () => {
  it('reports diagnostics as documented', () => {
    const { diagnostics } = search.parse('is:opne stars:lots');
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({
      code: 'invalid-value',
      start: 3,
      end: 7,
      suggestion: 'open',
      severity: 'error',
      field: 'is',
    });
    expect(diagnostics[0]!.message.startsWith('"opne" is not a valid value for "is". Did you mean "open"?')).toBe(true);
    expect(diagnostics[1]).toMatchObject({
      code: 'invalid-value',
      message: '"lots" is not a number (field "stars").',
      start: 14,
      end: 18,
    });
  });

  it('reads qualifiers and edits chips', () => {
    expect(search.getValues('is:open sort:stars', 'sort')[0]).toMatchObject({ kind: 'enum', value: 'stars' });
    expect(search.toggleFilter('login is:open', 'label', 'bug')).toBe('login is:open label:bug');
    expect(search.toggleFilter('login label:bug,ui', 'label', 'bug')).toBe('login label:ui');
    expect(search.setFilter('is:closed login', 'is', 'open')).toBe('is:open login');
    expect(search.addFilter('crash OR freeze', 'is', 'open')).toBe('(crash OR freeze) is:open');
  });
});

describe('README: syntax table', () => {
  const rows = [
    { id: 1, title: 'login error on save', body: '', author: 'alice', label: ['bug', 'ui'], stars: 15, is: 'open' },
    { id: 2, title: 'error page', body: 'login later', author: 'dependabot', label: ['bug'], stars: 5, is: 'closed' },
    { id: 3, title: 'Café menu', body: '', author: 'bob', label: [], stars: 20, is: 'open' },
  ];
  const ids = (q: string) => search.filter(rows, q).map((r) => r.id);

  it('behaves as described', () => {
    expect(ids('login error')).toEqual([1, 2]);
    expect(ids('"login error"')).toEqual([1]);
    expect(ids('label:bug,ui')).toEqual([1, 2]);
    expect(ids('label:bug label:ui')).toEqual([1]);
    expect(ids('-label:ui')).toEqual([2, 3]);
    expect(ids('!label:ui')).toEqual([2, 3]);
    expect(ids('NOT label:ui')).toEqual([2, 3]);
    expect(ids('-error')).toEqual([3]);
    expect(ids('cafe OR author:alice')).toEqual([1, 3]);
    expect(ids('(cafe OR author:alice) stars:>15')).toEqual([3]);
    expect(ids('stars:10..20')).toEqual([1, 3]);
    expect(ids('stars:10..')).toEqual([1, 3]);
    expect(ids('stars:*..10')).toEqual([2]);
    expect(ids('author:*bot')).toEqual([2]);
    expect(ids('label:*')).toEqual([1, 2]);
    expect(ids('-label:*')).toEqual([3]);
    expect(ids('a or b')).toEqual([]);
    expect(search.parse('e-mail').ast).toMatchObject({ type: 'text', value: 'e-mail' });
  });
});

describe('README: dates', () => {
  const s = createQuerybar({ fields: { created: { type: 'date' } }, now: () => Date.UTC(2024, 5, 15) });
  const at = (iso: string) => ({ created: iso });
  const may = [at('2024-04-30T23:59:59.999Z'), at('2024-05-10T00:00:00Z'), at('2024-06-01T00:00:00Z')];
  it('treats dates as periods', () => {
    expect(s.filter(may, 'created:2024-05')).toEqual([may[1]]);
    expect(s.filter(may, 'created:>2024-05')).toEqual([may[2]]);
    expect(s.filter(may, 'created:<=2024-05')).toEqual([may[0], may[1]]);
    expect(s.filter(may, 'created:2024-01..2024-05')).toEqual([may[0], may[1]]);
  });
  it('treats bare relative points as "since then"', () => {
    const rows = [at('2024-06-10T00:00:00Z'), at('2024-05-01T00:00:00Z'), at('2024-06-01T00:00:00Z')];
    expect(s.filter(rows, 'created:7d')).toEqual([rows[0]]);
    expect(s.filter(rows, 'created:<30d')).toEqual([rows[1]]);
    expect(s.filter(rows, 'created:30d..7d')).toEqual([rows[2]]);
  });
  it('clamps month arithmetic', () => {
    const t = createQuerybar({ fields: { d: { type: 'date' } }, now: () => Date.UTC(2024, 2, 31) });
    const v = t.parse('d:1mo').terms[0]!.values[0]!;
    expect(v.kind === 'date' && new Date(v.from).toISOString()).toBe('2024-02-29T00:00:00.000Z');
  });
});

describe('README: error recovery table', () => {
  it.each<[string, string, DiagnosticCode, 'error' | 'warning']>([
    ['label:"good first', 'label:"good first"', 'unterminated-quote', 'warning'],
    ['(a OR b', 'a OR b', 'unclosed-paren', 'warning'],
    ['a ) b', 'a b', 'unmatched-paren', 'warning'],
    ['a OR', 'a', 'dangling-operator', 'warning'],
    ['NOT', '', 'dangling-operator', 'warning'],
    ['a -', 'a', 'dangling-operator', 'warning'],
    ['a () b', 'a b', 'empty-group', 'warning'],
    ['lable:bug', '"lable:bug"', 'unknown-field', 'warning'],
    ['label:', 'label:', 'missing-value', 'error'],
    ['stars:lots', 'stars:lots', 'invalid-value', 'error'],
    ['author:>x', 'author:>x', 'invalid-operator', 'error'],
    ['stars:9..1', 'stars:9..1', 'invalid-range', 'error'],
  ])('%s', (input, formatted, code, severity) => {
    const r = search.parse(input);
    expect(r.diagnostics.map((d) => [d.code, d.severity])).toContainEqual([code, severity]);
    expect(search.format(input)).toBe(formatted);
  });

  it('suggests label for lable', () => {
    expect(search.parse('lable:bug').diagnostics[0]!.suggestion).toBe('label');
  });
});

describe('README: suggest', () => {
  it('matches the documented output', () => {
    expect(search.suggest('is:open la')).toEqual({
      context: 'field',
      from: 8,
      to: 10,
      prefix: 'la',
      items: [{ label: 'label', insert: 'label:', kind: 'field' }],
    });
    expect(search.suggest('label:goo')).toEqual({
      context: 'value',
      field: 'label',
      from: 6,
      to: 9,
      prefix: 'goo',
      items: [{ label: 'good first issue', insert: '"good first issue"', kind: 'value' }],
    });
  });
});

describe('README: editing helpers', () => {
  it('produces the documented results', () => {
    expect(search.hasFilter('is:open label:bug,ui', 'label', 'ui')).toBe(true);
    expect(search.hasFilter('stars:>5', 'stars', 5)).toBe(false);
    expect(search.hasFilter('stars:>5', 'stars', 5, { op: '>' })).toBe(true);
    expect(search.addFilter('login', 'label', 'good first issue')).toBe('login label:"good first issue"');
    expect(search.addFilter('login', 'stars', 10, { op: '>=' })).toBe('login stars:>=10');
    expect(search.addFilter('login', 'label', 'wontfix', { negated: true })).toBe('login -label:wontfix');
    expect(search.addFilter('label:bug', 'label', 'ui', { combine: 'or' })).toBe('label:bug,ui');
    expect(search.addFilter('a OR b', 'is', 'open')).toBe('(a OR b) is:open');
    expect(search.addFilter('(a OR b', 'is', 'open')).toBe('(a OR b) is:open');
    expect(search.removeFilter('is:open login', 'is')).toBe('login');
    expect(search.removeFilter('label:a,b,c', 'label', 'b')).toBe('label:a,c');
    expect(search.removeFilter('label:a -label:b', 'label', undefined, { negated: true })).toBe('label:a');
    expect(search.setFilter('is:closed login is:draft', 'is', 'open')).toBe('is:open login');
    expect(search.setFilter('sort:newest', 'sort', 'stars')).toBe('sort:stars');
    expect(search.setFilter('is:open login', 'is', null)).toBe('login');
    expect(search.toggleFilter('login', 'label', 'bug')).toBe('login label:bug');
    expect(search.toggleFilter('login label:bug', 'label', 'bug')).toBe('login');
    expect(search.getValues('sort:stars is:open', 'sort')[0]).toMatchObject({ kind: 'enum', value: 'stars' });
    expect(() => search.addFilter('', 'stars', 'abc')).toThrow(RangeError);
    expect(() => search.addFilter('', 'is', 'nope')).toThrow(RangeError);
    expect(search.addFilter('', 'author', 'al*', { raw: true })).toBe('author:al*');
    expect(search.addFilter('', 'author', 'al*')).toBe('author:"al*"');
    expect(search.addFilter('', 'stars', '10..20')).toBe('stars:10..20');
  });

  it('formats as documented', () => {
    expect(search.format('IS:open  AND  by:alice   created:2024-05')).toBe('is:open author:alice created:2024-05');
  });
});

describe('README: SQL recipe', () => {
  // Copied from the README.
  const columns = { is: 'state', author: 'author', stars: 'stars', created: 'created_at' } as const;
  const like = (s: string) => s.replace(/[\\%_]/g, '\\$&');

  function toSql(node: Node | null, params: unknown[]): string {
    if (!node) return 'TRUE';
    const p = (v: unknown) => `$${params.push(v)}`;
    switch (node.type) {
      case 'and':
        return `(${node.children.map((c) => toSql(c, params)).join(' AND ')})`;
      case 'or':
        return `(${node.children.map((c) => toSql(c, params)).join(' OR ')})`;
      case 'not':
        return `NOT ${toSql(node.child, params)}`;
      case 'text':
        return `title ILIKE ${p(`%${like(node.value)}%`)}`;
      case 'term': {
        const col = columns[node.field as keyof typeof columns];
        if (!col || !node.valid) return 'TRUE';
        const op = node.op;
        const one = (v: TermValue): string => {
          switch (v.kind) {
            case 'exists':
              return `${col} IS NOT NULL`;
            case 'string':
              return `${col} ILIKE ${p(v.wildcard ? v.parts.map(like).join('%') : like(v.value))}`;
            case 'number-range':
            case 'date-range': {
              const lo = v.kind === 'number-range' ? v.min : v.from;
              const hi = v.kind === 'number-range' ? v.max : v.to;
              const hiOp = v.kind === 'number-range' ? '<=' : '<';
              const conv = (x: number) => (v.kind === 'date-range' ? new Date(x) : x);
              const parts = [];
              if (lo !== null) parts.push(`${col} >= ${p(conv(lo))}`);
              if (hi !== null) parts.push(`${col} ${hiOp} ${p(conv(hi))}`);
              return parts.join(' AND ');
            }
            case 'date': {
              // Dates are periods [from, to); relative points (7d) have from === to.
              const from = () => p(new Date(v.from));
              const to = () => p(new Date(v.to));
              const point = v.from === v.to;
              if (op === '=') return point ? `${col} >= ${from()}` : `${col} >= ${from()} AND ${col} < ${to()}`;
              if (op === '>') return point ? `${col} > ${from()}` : `${col} >= ${to()}`;
              if (op === '>=') return `${col} >= ${from()}`;
              if (op === '<') return `${col} < ${from()}`;
              return point ? `${col} <= ${from()}` : `${col} < ${to()}`;
            }
            default:
              return `${col} ${op} ${p(v.value)}`;
          }
        };
        return `(${node.values.map(one).join(' OR ')})`;
      }
    }
  }

  it('produces parameterised SQL', () => {
    const params: unknown[] = [];
    const where = toSql(
      search.parse('is:open,draft -author:*bot stars:10.. created:2024-05 login "100%"').ast,
      params,
    );
    expect(where).toBe(
      '((state = $1 OR state = $2) AND NOT (author ILIKE $3) AND (stars >= $4) AND ' +
        '(created_at >= $5 AND created_at < $6) AND title ILIKE $7 AND title ILIKE $8)',
    );
    expect(params).toEqual([
      'open',
      'draft',
      '%bot',
      10,
      new Date(Date.UTC(2024, 4, 1)),
      new Date(Date.UTC(2024, 5, 1)),
      '%login%',
      '%100\\%%',
    ]);
    expect(toSql(null, [])).toBe('TRUE');

    // The exact example shown in the README.
    const readmeParams: unknown[] = [];
    expect(toSql(search.parse('is:open,draft -author:*bot stars:10.. created:2024-05 login').ast, readmeParams)).toBe(
      '((state = $1 OR state = $2) AND NOT (author ILIKE $3) AND (stars >= $4) ' +
        'AND (created_at >= $5 AND created_at < $6) AND title ILIKE $7)',
    );
  });

  it('handles every operator and value kind', () => {
    const sql = (q: string) => {
      const params: unknown[] = [];
      return [toSql(search.parse(q).ast, params), params] as const;
    };
    expect(sql('created:>2024-05')[0]).toBe('(created_at >= $1)');
    expect(sql('created:<2024-05')[0]).toBe('(created_at < $1)');
    expect(sql('created:<=2024-05')[0]).toBe('(created_at < $1)');
    expect(sql('created:>=7d')[0]).toBe('(created_at >= $1)');
    expect(sql('created:7d')[0]).toBe('(created_at >= $1)');
    expect(sql('created:<=now')[0]).toBe('(created_at <= $1)');
    expect(sql('created:..2024')).toEqual(['(created_at < $1)', [new Date(Date.UTC(2025, 0, 1))]]);
    expect(sql('stars:..5')).toEqual(['(stars <= $1)', [5]]);
    expect(sql('stars:<5')).toEqual(['(stars < $1)', [5]]);
    expect(sql('author:*')).toEqual(['(author IS NOT NULL)', []]);
    expect(sql('author:a_b')).toEqual(['(author ILIKE $1)', ['a\\_b']]);
    expect(sql('nope:1 stars:x')).toEqual(['(title ILIKE $1 AND TRUE)', ['%nope:1%']]);
  });
});

describe('README: localisation and unicode names', () => {
  it('maps codes to messages', () => {
    const messages: Partial<Record<DiagnosticCode, (d: Diagnostic) => string>> = {
      'invalid-value': (d) => `«${d.field}»에 사용할 수 없는 값입니다` + (d.suggestion ? ` (혹시 “${d.suggestion}”?)` : ''),
      'unknown-field': (d) => `알 수 없는 필드: ${d.field}`,
    };
    const text = search.parse('is:opne foo:1').diagnostics.map((d) => messages[d.code]?.(d) ?? d.message);
    expect(text).toEqual(['«is»에 사용할 수 없는 값입니다 (혹시 “open”?)', '알 수 없는 필드: foo']);
  });

  it('accepts Korean aliases', () => {
    const s = createQuerybar({
      fields: {
        author: { type: 'string', aliases: ['작성자'] },
        state: { type: 'enum', values: ['open', 'closed'], aliases: ['상태'] },
      },
    });
    const posts = [
      { author: '홍길동', state: 'open', body: '검색어 테스트' },
      { author: '홍길동', state: 'closed', body: '검색어' },
      { author: '김철수', state: 'open', body: '검색어' },
    ];
    expect(s.filter(posts, '작성자:홍길동 상태:open 검색어')).toEqual([posts[0]]);
  });
});

describe('README translations', () => {
  it('README.ko.md has exactly the same code as README.md (comments aside)', async () => {
    // Loaded dynamically: the test tsconfig has no Node type definitions.
    const fs: { readFileSync(path: URL, encoding: 'utf8'): string } = await import('node:fs' as string);
    const code = (file: string): string[] => {
      const text = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      const blocks: string[] = text.match(/```[a-z]*\n[\s\S]*?```/g) ?? [];
      // Compare code only: `// …` and shell `# …` comments are translated.
      return blocks.map((b) =>
        b
          .split('\n')
          .map((line: string) => line.replace(/\s*\/\/.*$/, '').replace(/\s+# .*$/, '').trimEnd())
          .filter((line: string) => line.trim() !== '')
          .join('\n'),
      );
    };
    expect(code('README.ko.md')).toEqual(code('README.md'));
  });
});
