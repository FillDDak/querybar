// Exercises the published ESM build (through the package's exports map) on
// whatever Node version runs it. No test framework, so it also runs on old Node.
import assert from 'node:assert/strict';
import { createQuerybar, stringify } from 'querybar';

const NOW = Date.UTC(2024, 5, 15, 12);
const search = createQuerybar({
  fields: {
    is: { type: 'enum', values: ['open', 'closed', 'draft'] },
    author: { type: 'string', aliases: ['by'], suggestions: ['alice', 'bob'] },
    label: { type: 'string' },
    stars: { type: 'number' },
    created: { type: 'date' },
    archived: { type: 'boolean' },
  },
  now: () => NOW,
});

const rows = [
  { id: 1, title: 'Login fails on Safari', author: 'alice', label: ['bug', 'ui'], is: 'open', stars: 12, created: '2024-01-10T09:00:00Z' },
  { id: 2, title: 'Dark mode', author: 'bob', label: ['feature'], is: 'closed', stars: 40, created: new Date(Date.UTC(2024, 2, 5)), archived: true },
  { id: 3, title: 'Crash with a café photo', author: 'Zoë', label: ['bug'], is: 'open', stars: 3, created: Date.UTC(2024, 5, 14, 8) },
  { id: 4, title: '한글 검색 지원', author: 'minji', label: [], is: 'draft', stars: 0, created: '2023-12-31T23:59:59Z' },
];
const ids = (q) => search.filter(rows, q).map((r) => r.id);

// Filtering
assert.deepEqual(ids('is:open label:bug'), [1, 3]);
assert.deepEqual(ids('stars:>10 OR -label:*'), [1, 2, 4]);
assert.deepEqual(ids('created:2024-01..2024-03'), [1, 2]);
assert.deepEqual(ids('created:7d'), [3]);
assert.deepEqual(ids('author:zoe cafe'), [3]);
assert.deepEqual(ids('검색'), [4]);
assert.deepEqual(ids('하'), []);
assert.deepEqual(ids('archived:true'), [2]);
assert.deepEqual(ids('-(is:open OR is:draft)'), [2]);
assert.deepEqual(ids('author:al*'), [1]);

// Diagnostics, highlighting, suggestions
assert.equal(search.parse('is:opne').diagnostics[0].suggestion, 'open');
const q = 'is:open -label:bug,"a b" (x OR y) stars:>=5 ) "z';
assert.equal(search.tokenize(q).map((t) => t.text).join(''), q);
assert.deepEqual(search.suggest('is:c').items.map((i) => i.label), ['closed']);
assert.deepEqual(search.suggest('b').items[0].label, 'author');

// Formatting and editing
assert.equal(search.format('IS:open  AND  by:alice'), 'is:open author:alice');
assert.equal(stringify(search.parse('(a OR b) c').ast), '(a OR b) c');
assert.equal(search.addFilter('a OR b', 'is', 'open'), '(a OR b) is:open');
assert.equal(search.removeFilter('label:a,b,c x', 'label', 'b'), 'label:a,c x');
assert.equal(search.setFilter('is:closed x is:draft', 'is', 'open'), 'is:open x');
assert.equal(search.toggleFilter('label:bug,ui', 'label', 'bug'), 'label:ui');

// Local time zone
const local = createQuerybar({ fields: { d: { type: 'date' } }, timeZone: 'local' });
const v = local.parse('d:2024-03-10').terms[0].values[0];
assert.equal(v.from, new Date(2024, 2, 10).getTime());
assert.equal(v.to, new Date(2024, 2, 11).getTime());

// Seeded mini-fuzz: invariants hold for thousands of random queries.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pieces = ['is:open', 'is:', 'label:bug,ui', 'label:"a b"', '-', '(', ')', 'OR', 'NOT', '"', ' ', 'stars:>5',
  'stars:1..3', 'stars:x', 'created:7d', 'created:2024', 'foo:bar', 'a', 'é', '한', ',', '*', '\\', 'label:a)b'];
for (let n = 0; n < 3000; n++) {
  let query = '';
  const len = Math.floor(rand() * 12);
  for (let k = 0; k < len; k++) query += pieces[Math.floor(rand() * pieces.length)] + (rand() < 0.5 ? ' ' : '');
  const tokens = search.tokenize(query);
  assert.equal(tokens.map((t) => t.text).join(''), query, query);
  const formatted = search.format(query);
  assert.equal(search.format(formatted), formatted, query);
  assert.deepEqual(ids(formatted), ids(query), query);
  search.suggest(query, Math.floor(rand() * (query.length + 1)));
  const added = search.addFilter(query, 'is', 'open');
  assert.ok(search.hasFilter(added, 'is', 'open'), query);
}

console.log(`ESM build OK (Node ${process.versions.node})`);
