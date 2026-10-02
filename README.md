# querybar

**English** | [한국어](./README.ko.md)

**GitHub-style search syntax for any app.** Describe your fields once and get a forgiving parser, an in-memory filter, syntax highlighting, autocomplete, "did you mean" hints and query-editing helpers for filter chips. Zero dependencies, about 11 kB gzipped, fully typed.

```
is:open label:bug,"good first issue" -author:*bot stars:>=10 created:2024-01..2024-03 (crash OR freeze)
```

```ts
import { createQuerybar } from 'querybar';

const search = createQuerybar({
  fields: {
    is: { type: 'enum', values: ['open', 'closed', 'draft'] },
    author: { type: 'string', aliases: ['by'] },
    label: { type: 'string' },
    stars: { type: 'number' },
    created: { type: 'date' },
  },
});

search.filter(issues, 'is:open label:bug -author:*bot stars:>=10 login');
```

## Why

Admin panels, dashboards, issue trackers, log viewers and data tables all end up needing a "smart" search box. Teams usually rebuild one by hand: a regex here, a `split(' ')` there, and a list of edge cases nobody handles (quotes, negation, typos, half-typed queries, highlighting, chips that must edit the text without breaking it).

querybar is that whole search box minus the UI:

| | |
|---|---|
| **Parse** | `parse(query)` turns text into a typed syntax tree. It **never throws**: half-typed input, unbalanced quotes or parentheses and typos come back as diagnostics with exact positions. |
| **Filter** | `filter(items, query)` / `compile(query)` gives you working in-memory search: AND / OR / NOT, groups, lists, ranges, wildcards, relative dates, plus accent- and case-insensitive free text. |
| **Highlight** | `tokenize(query)` returns tokens that cover every character, so rendering a highlighted input takes a single `map`. |
| **Autocomplete** | `suggest(query, cursor)` knows whether the cursor is on a field or a value, and offers fields, enum values, booleans, dates and your own suggestions. |
| **Fix typos** | `is:opne` → *"Did you mean "open"?"*, with the exact span to replace. |
| **Edit** | `addFilter`, `setFilter`, `removeFilter` and `toggleFilter` change one filter and keep the rest of the user's text as typed. Every edit is checked: the result always means "the old query, with this one change". |
| **Serialize** | `format(query)` gives a canonical form. The tree is plain JSON, so it is easy to turn into SQL, Prisma, Mongo or an API call (see the [recipes](#recipes)). |

## Install

```sh
npm install querybar
```

ESM and CommonJS builds and TypeScript types are included. Runs in Node.js 16+ and every modern browser (ES2018). It uses no platform-specific APIs, so other JavaScript runtimes work too.

## Quick start

```ts
import { createQuerybar } from 'querybar';

const search = createQuerybar({
  fields: {
    is: { type: 'enum', values: ['open', 'closed', 'draft'], description: 'Issue state' },
    author: { type: 'string', aliases: ['by'], suggestions: ['alice', 'bob'] },
    label: { type: 'string' },
    title: { type: 'string', mode: 'contains' },
    stars: { type: 'number', integer: true, min: 0 },
    created: { type: 'date' },
    archived: { type: 'boolean' },
    sort: { type: 'enum', values: ['newest', 'stars'], filter: false }, // a qualifier, not a filter
  },
  text: ['title', 'body'], // where free text is searched
});

// 1. Filter
const results = search.filter(issues, 'is:open label:bug,ui -label:wontfix stars:>=10 login');

// 2. Validate and explain
const { diagnostics } = search.parse('is:opne stars:lots');
// [ { code: 'invalid-value', message: '"opne" is not a valid value for "is". Did you mean "open"? ...',
//     start: 3, end: 7, suggestion: 'open', severity: 'error', field: 'is' },
//   { code: 'invalid-value', message: '"lots" is not a number (field "stars").', start: 14, end: 18, ... } ]

// 3. Read qualifiers that are not filters
const [sort] = search.getValues('is:open sort:stars', 'sort'); // { kind: 'enum', value: 'stars', ... }

// 4. Drive filter chips without breaking the user's text
search.toggleFilter('login is:open', 'label', 'bug'); // 'login is:open label:bug'
search.toggleFilter('login label:bug,ui', 'label', 'bug'); // 'login label:ui'
search.setFilter('is:closed login', 'is', 'open'); // 'is:open login'
search.addFilter('crash OR freeze', 'is', 'open'); // '(crash OR freeze) is:open'
```

Try the interactive playground: `npm run playground` (from a clone of this repo).

## Query syntax

| Syntax | Meaning |
|---|---|
| `login error` | Free text. **Every** word must appear (case- and accent-insensitive). |
| `"login error"` | Exact phrase. |
| `field:value` | Qualifier. Field names are case-insensitive and may have aliases. |
| `field:a,b,c` | Any of the values (OR). |
| `field:a field:b` | Both (AND). For array fields: has both. |
| `-field:value` `!field:value` `NOT field:value` | Negation. Works on text too: `-wontfix`. |
| `a OR b` | Either side. `AND` is implicit (`a b` = `a AND b`) and binds tighter than `OR`. |
| `(a OR b) c` | Grouping. `-(a OR b)` negates a group. |
| `field:>10` `>=` `<` `<=` | Comparisons (number and date fields). |
| `field:10..20` | Inclusive range. Open ends: `10..`, `..20`, `10..*`, `*..20`. |
| `field:al*` `field:*bot` `field:a*b` | Wildcards (string fields). Quote them to search for a literal `*`: `field:"a*"`. |
| `field:*` / `-field:*` | Has any value / is empty or missing. |
| `field:"with spaces, commas (and parens)"` | Quoting. Inside quotes, `\"` is a quote and `\\` a backslash; other backslashes are literal. |

Only uppercase `AND`, `OR` and `NOT` are keywords, so `or` and `and` are ordinary words. `e-mail` and `stars:-5` are not negations; only a leading `-` is.

### Field types

| Type | Accepts | Operators | Matches item values that are… |
|---|---|---|---|
| `string` | any text, wildcards | `=` | strings (also numbers and booleans, compared as text). `mode`: `'exact'` (default), `'contains'`, `'startsWith'`. Case-insensitive unless `caseSensitive: true`. |
| `enum` | one of `values` (case-insensitive) | `=` | equal strings, case-insensitive (numbers and booleans are compared as text) |
| `number` | `42`, `-1.5`, `.5`, `1e3`; ranges | `= > >= < <=`, `a..b` | numbers or numeric strings |
| `date` | see below; ranges | `= > >= < <=`, `a..b` | `Date` objects, epoch milliseconds or date strings (`Date.parse`) |
| `boolean` | `true/false`, `yes/no`, `on/off`, `1/0` | `=` | booleans, `1/0`, `"true"/"false"`. A missing value counts as `false`. |

When the item value is an **array** (or a `Set`), the term matches if **any** element matches, so `label:bug` finds items whose `label` array contains `"bug"`.

### Dates

Dates are periods, so you can say what you mean:

| Value | Means |
|---|---|
| `2024` / `2024-05` / `2024-05-17` | that whole year / month / day |
| `2024-05-17T10:30`, `…T10:30:15`, `…T10:30:15.250` | that minute / second / millisecond |
| `…T10:30Z`, `…T10:30+09:00` | with an explicit offset |
| `"2024-05-17 10:30"` | a space instead of `T` (quote it) |
| `today`, `yesterday`, `tomorrow` | that calendar day |
| `now`, `30min`, `12h`, `7d`, `2w`, `3mo`, `1y` | a point in time: now, or that long ago |

* `created:2024-05` → during May. `created:>2024-05` → after May (June 1 onwards). `created:<=2024-05` → up to and including May.
* `created:2024-01..2024-03` → January 1 to the end of March.
* A bare relative point means "since then": `updated:7d` = in the last 7 days. `updated:<30d` = older than 30 days. `created:30d..7d` = between 30 and 7 days ago.
* Calendar dates use **UTC** by default. Pass `timeZone: 'local'` to use the user's time zone, e.g. in a browser. Month and year arithmetic clamps to the end of the month (Mar 31 − 1mo = Feb 29).

## API

### `createQuerybar(options)`

```ts
const search = createQuerybar({
  fields,                 // required, see "Field options"
  text: true,             // where free text is searched (see below)
  unknownFields: 'text',  // 'text' | 'error'
  operators: true,        // AND / OR / NOT and parentheses
  negation: true,         // -term and !term
  timeZone: 'utc',        // 'utc' | 'local'
  now: () => Date.now(),  // clock for today / 7d / now (Date or epoch ms)
  ignoreDiacritics: true, // cafe matches café
});
```

The schema is checked when you create the instance, and invalid schemas throw a `TypeError` (unknown types, empty enums, invalid names, two fields or aliases with the same case-insensitive name).

**`text`** sets what free text searches:

* `true` (default): every top-level string or number property of an item (and arrays of them), or the item itself if it is a string;
* an array of property paths: `['title', 'author.name']`;
* a function: `(item) => string | string[]`;
* `false`: free text never filters (it is still parsed, so you can use it yourself).

**`unknownFields`**: with `'text'` (default), `foo:bar` for an unknown `foo` is searched as the text `foo:bar` and produces an `unknown-field` warning. With `'error'` it is an error and the term is ignored. Either way, URLs (`https://…`) are always plain text with no diagnostic.

#### Field options

| Option | Types | Description |
|---|---|---|
| `type` | all | `'string' \| 'number' \| 'date' \| 'boolean' \| 'enum'` (required) |
| `aliases` | all | Other accepted names, e.g. `['by']` |
| `description` | all | Shown in autocomplete suggestions |
| `path` | all | Dot path to the item value (default: the field name). A literal key containing dots wins. |
| `get` | all | `(item) => value`. Overrides `path`. |
| `filter` | all | `false` makes it a pure qualifier the predicate ignores (e.g. `sort:`). A function `(item, term) => boolean` replaces matching. |
| `values` | enum | Accepted values (required) |
| `mode` | string | `'exact'` (default), `'contains'` or `'startsWith'` |
| `caseSensitive` | string | Default `false` |
| `suggestions` | string | `string[]` or `(prefix) => string[]` for autocomplete |
| `integer`, `min`, `max` | number | Validation (out-of-range values produce an `invalid-value` error) |

### `search.parse(query) → ParseResult`

```ts
interface ParseResult {
  input: string;
  ast: Node | null;          // null for an empty query
  diagnostics: Diagnostic[]; // sorted by position
  valid: boolean;            // no error diagnostics (warnings are fine)
  terms: TermNode[];         // every qualifier, at any depth, in order
  text: TextNode[];          // every free-text word or phrase
  conjunctive: boolean;      // a plain AND of (optionally negated) terms and words: no OR, no negated groups
}
```

The tree is plain JSON-serialisable data. Every node and value has `start`/`end` offsets into the input:

```ts
type Node =
  | { type: 'and' | 'or'; children: Node[] }
  | { type: 'not'; child: Node }
  | { type: 'text'; value: string; quoted: boolean }
  | { type: 'term'; field: string; key: string; op: '=' | '>' | '>=' | '<' | '<='; values: TermValue[]; valid: boolean; raw: string };

type TermValue =                                   // each also has raw, start, end
  | { kind: 'string'; value: string; wildcard: boolean; parts: string[] }
  | { kind: 'enum'; value: string }                 // canonical spelling from the schema
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'date'; from: number; to: number }      // [from, to) in epoch ms; from === to for points like 7d
  | { kind: 'number-range'; min: number | null; max: number | null }  // inclusive
  | { kind: 'date-range'; from: number | null; to: number | null }    // [from, to)
  | { kind: 'exists' };                             // field:*
```

`field` is the canonical field name; `key` is what the user typed (maybe an alias, maybe `IS`).

**Error recovery.** The parser always produces the best tree it can:

| Input | Result | Diagnostic |
|---|---|---|
| `label:"good first` | `label:"good first"` | `unterminated-quote` (warning) |
| `(a OR b` | `a OR b` | `unclosed-paren` (warning) |
| `a ) b` | `a b` | `unmatched-paren` (warning) |
| `a OR`, `NOT`, `a -` | `a`, *(empty)*, `a` | `dangling-operator` (warning) |
| `a () b` | `a b` | `empty-group` (warning) |
| `lable:bug` | text `lable:bug` | `unknown-field` (warning, suggestion `label`) |
| `label:` | invalid term (ignored) | `missing-value` (error) |
| `stars:lots` | invalid term (ignored) | `invalid-value` (error) |
| `author:>x` | invalid term (ignored) | `invalid-operator` (error) |
| `stars:9..1` | invalid term (ignored) | `invalid-range` (error) |

Each `Diagnostic` has `code`, `severity`, an English `message`, `start`/`end`, and where relevant `field` and `suggestion`. Use `code` to show your own translated messages.

### `search.filter(items, query)` / `search.compile(query)`

```ts
const visible = search.filter(issues, query); // T[]; accepts any iterable
const test = search.compile<Issue>(query);    // (item: Issue) => boolean
```

Both accept a query string or a `ParseResult`, so you can parse once and reuse the result. Invalid terms are **ignored** rather than matching nothing, so while the user types `stars:` the results don't flash empty. An empty query matches everything.

Matching rules: missing values (`null`/`undefined`) never match a positive term, so `-field:x` matches them (the one exception: boolean fields treat a missing value as `false`). Free text and string fields ignore case and accents by default, and text is recomposed after accent removal so that Korean syllables (`한`) are never matched by a partial jamo prefix (`하`). Wildcards are matched without regular expressions in O(n·m) time, so hostile patterns like `a*a*a*…b` can't freeze the page.

### `search.tokenize(query) → Token[]`

Tokens cover the input exactly: `tokens.map(t => t.text).join('') === query`.

```ts
type TokenType = 'field' | 'colon' | 'operator' | 'value' | 'separator' | 'text'
               | 'keyword' | 'negation' | 'paren' | 'whitespace' | 'error';
interface Token { type: TokenType; text: string; start: number; end: number; field?: string; invalid?: boolean }
```

`invalid` is set on tokens covered by an error diagnostic, which is handy for squiggly underlines.

### `search.suggest(query, cursor?, { limit? }) → SuggestResult`

```ts
search.suggest('is:open la');
// { context: 'field', from: 8, to: 10, prefix: 'la',
//   items: [{ label: 'label', insert: 'label:', kind: 'field' }] }

search.suggest('label:goo');
// { context: 'value', field: 'label', from: 6, to: 9, prefix: 'goo',
//   items: [{ label: 'good first issue', insert: '"good first issue"', kind: 'value' }] }
```

* `context` is `'field'`, `'value'` or `'none'` (inside a quoted phrase or an unknown field).
* Fields match on name or alias. Enum and boolean fields suggest their values; dates suggest `today`, `yesterday`, `7d`, `30d`, `3mo`, `1y`; string fields use their `suggestions`. Values already in the list are skipped (`is:open,` doesn't offer `open` again).
* Prefix matches come first, then substring matches (both case- and accent-insensitive).
* A capitalised prefix (`O`, `AN`) also offers `OR` / `AND` / `NOT`.
* `cursor` defaults to the end of the input and is clamped to its bounds.

### `search.applySuggestion(query, result, item) → { text, cursor }`

Replaces `result.from..result.to` with `item.insert` and tells you where to put the cursor. When a value or keyword is completed at the end of the input, a space is added so the user can keep typing.

### Editing helpers

All helpers take the current query text and return new text. They only touch **top-level** terms (terms combined with AND, optionally negated or in parentheses). Terms inside `OR` groups are left alone. The rest of the query keeps the user's spelling and spacing. Each result is re-parsed and checked to mean exactly "the old query with this change". In the rare case where a text-preserving edit can't guarantee that, the canonical form is returned instead.

```ts
search.hasFilter('is:open label:bug,ui', 'label', 'ui');      // true
search.hasFilter('stars:>5', 'stars', 5);                     // false (operator differs)
search.hasFilter('stars:>5', 'stars', 5, { op: '>' });        // true

search.addFilter('login', 'label', 'good first issue');       // 'login label:"good first issue"'
search.addFilter('login', 'stars', 10, { op: '>=' });         // 'login stars:>=10'
search.addFilter('login', 'label', 'wontfix', { negated: true }); // 'login -label:wontfix'
search.addFilter('label:bug', 'label', 'ui', { combine: 'or' });  // 'label:bug,ui'
search.addFilter('a OR b', 'is', 'open');                     // '(a OR b) is:open'
search.addFilter('(a OR b', 'is', 'open');                    // '(a OR b) is:open'

search.removeFilter('is:open login', 'is');                   // 'login'
search.removeFilter('label:a,b,c', 'label', 'b');             // 'label:a,c'
search.removeFilter('label:a -label:b', 'label', undefined, { negated: true }); // 'label:a'

search.setFilter('is:closed login is:draft', 'is', 'open');   // 'is:open login'
search.setFilter('sort:newest', 'sort', 'stars');             // 'sort:stars'
search.setFilter('is:open login', 'is', null);                // 'login'

search.toggleFilter('login', 'label', 'bug');                 // 'login label:bug'
search.toggleFilter('login label:bug', 'label', 'bug');       // 'login'

search.getValues('sort:stars is:open', 'sort');               // [{ kind: 'enum', value: 'stars', ... }]
```

| Method | Signature |
|---|---|
| `hasFilter` | `(query, field, value?, { negated?, op? })`: is there a top-level term for `field` (with `value` among its alternatives)? |
| `getValues` | `(query, field)`: values of top-level, positive, `=` terms, typed per field |
| `addFilter` | `(query, field, value \| value[], { negated?, op?, raw?, combine? })`: appends the term unless the exact same term exists. `combine: 'or'` extends an existing list instead. |
| `setFilter` | `(query, field, value \| value[] \| null, { negated?, op?, raw? })`: replaces the field's positive terms (negated ones with `negated: true`), writing the new term where the first one was; `null` removes them |
| `removeFilter` | `(query, field, value? \| value[], { negated?, op? })`: removes the field's terms, or just `value` from their lists. Without `negated`, both positive and negated terms go. |
| `toggleFilter` | `(query, field, value, { negated?, op?, combine? })`: removes the value if present, else adds it |

Values can be strings, numbers, booleans or `Date`s (written as ISO timestamps). Strings are quoted when needed, and `*` is kept literal; pass `{ raw: true }` to insert wildcards or other syntax verbatim. For number and date fields, range strings like `'10..20'` work as-is. Adding a value the field can't accept (`stars: 'abc'`, `is: 'nope'`) throws a `RangeError`. Unknown field names throw.

### `search.format(query)` and `stringify(node)`

`format` returns the canonical text of a query: normalised spacing, canonical field names, redundant parentheses dropped, unbalanced quotes and parentheses repaired. Value spellings are kept (`created:2024-05` stays as typed). It is idempotent, and `format(q)` always filters exactly like `q`.

`search.stringify(node)` turns any tree, including one you built yourself, back into query text in the instance's syntax. It is also exported on its own as `stringify(node, { negation? })`; with `negation: false` it writes `NOT x` instead of `-x`.

## Recipes

### A highlighted search input (React)

```tsx
function SearchBox({ value, onChange }: { value: string; onChange(v: string): void }) {
  const tokens = search.tokenize(value);
  return (
    <div className="searchbox">
      <div className="searchbox-highlight" aria-hidden>
        {tokens.map((t, i) => (
          <span key={i} className={`tok-${t.type}${t.invalid ? ' tok-invalid' : ''}`}>{t.text}</span>
        ))}
      </div>
      <input value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
    </div>
  );
}
```

Stack the highlight layer under a transparent-text input that uses the same font and padding; `examples/playground.html` is a complete, framework-free example with autocomplete, keyboard navigation and chips.

### Keep the query in the URL

```ts
const q = new URL(location.href).searchParams.get('q') ?? '';
// ... user edits ...
const url = new URL(location.href);
url.searchParams.set('q', search.format(q));
history.replaceState(null, '', url);
```

### Translate to a database query (SQL with parameters)

The tree is easy to fold into any backend. Here is a complete translator to parameterised PostgreSQL. User text only ever travels as parameters, never inside the SQL string.

```ts
import type { Node, TermValue } from 'querybar';

const columns = { is: 'state', author: 'author', stars: 'stars', created: 'created_at' } as const;
const like = (s: string) => s.replace(/[\\%_]/g, '\\$&');

function toSql(node: Node | null, params: unknown[]): string {
  if (!node) return 'TRUE';
  const p = (v: unknown) => `$${params.push(v)}`;
  switch (node.type) {
    case 'and': return `(${node.children.map((c) => toSql(c, params)).join(' AND ')})`;
    case 'or': return `(${node.children.map((c) => toSql(c, params)).join(' OR ')})`;
    case 'not': return `NOT ${toSql(node.child, params)}`;
    case 'text': return `title ILIKE ${p(`%${like(node.value)}%`)}`;
    case 'term': {
      const col = columns[node.field as keyof typeof columns];
      if (!col || !node.valid) return 'TRUE';
      const op = node.op;
      const one = (v: TermValue): string => {
        switch (v.kind) {
          case 'exists': return `${col} IS NOT NULL`;
          case 'string': return `${col} ILIKE ${p(v.wildcard ? v.parts.map(like).join('%') : like(v.value))}`;
          case 'number-range':
          case 'date-range': {
            const lo = v.kind === 'number-range' ? v.min : v.from;
            const hi = v.kind === 'number-range' ? v.max : v.to;
            const hiOp = v.kind === 'number-range' ? '<=' : '<'; // date ranges end exclusively
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
          default: return `${col} ${op} ${p(v.value)}`; // enum, number, boolean
        }
      };
      return `(${node.values.map(one).join(' OR ')})`;
    }
  }
}

const params: unknown[] = [];
const where = toSql(search.parse('is:open,draft -author:*bot stars:10.. created:2024-05 login').ast, params);
// ((state = $1 OR state = $2) AND NOT (author ILIKE $3) AND (stars >= $4)
//   AND (created_at >= $5 AND created_at < $6) AND title ILIKE $7)
// db.query(`SELECT * FROM issues WHERE ${where}`, params)
```

Unknown fields and invalid terms become `TRUE`, which mirrors how `filter` ignores them. Note that SQL's `NOT` doesn't match `NULL`s, while querybar's `-field:x` matches missing values; use `COALESCE` or `IS DISTINCT FROM` if that matters to you. If your backend only supports AND, check `result.conjunctive` and reject or simplify other queries.

### Localised error messages

```ts
import type { Diagnostic, DiagnosticCode } from 'querybar';

const messages: Partial<Record<DiagnosticCode, (d: Diagnostic) => string>> = {
  'invalid-value': (d) => `«${d.field}»에 사용할 수 없는 값입니다` + (d.suggestion ? ` (혹시 “${d.suggestion}”?)` : ''),
  'unknown-field': (d) => `알 수 없는 필드: ${d.field}`,
  // ...
};
const text = search.parse('is:opne').diagnostics.map((d) => messages[d.code]?.(d) ?? d.message);
// ['«is»에 사용할 수 없는 값입니다 (혹시 “open”?)']
```

### Korean, Japanese and other non-Latin field names

Field names and aliases can use any letters:

```ts
const search = createQuerybar({
  fields: { author: { type: 'string', aliases: ['작성자'] }, state: { type: 'enum', values: ['open', 'closed'], aliases: ['상태'] } },
});
search.filter(posts, '작성자:홍길동 상태:open 검색어');
```

## TypeScript

Field names and enum values are inferred from the schema; you don't need `as const`:

```ts
const search = createQuerybar({ fields: { state: { type: 'enum', values: ['open', 'closed'] } } });
const [v] = search.getValues(q, 'state');
if (v?.kind === 'enum') v.value; // 'open' | 'closed'
```

All types (`Node`, `TermNode`, `TermValue`, `Diagnostic`, `Token`, `Suggestion`, `ParseResult`, …) are exported. TypeScript 5.0 or newer is required for the types.

## Compatibility and guarantees

* **Zero runtime dependencies**, side-effect free, tree-shakeable. ESM and CommonJS builds with types for both.
* **ES2018** output: Node.js 16+, Chrome 64+, Firefox 78+, Safari 11.1+.
* **Never throws on user input.** `parse`, `filter`, `tokenize`, `suggest` and `format` accept any string, including lone surrogates, control characters, 50 000 nested parentheses and queries hundreds of thousands of characters long, and run in linear time. Nesting deeper than 100 levels is read as text.
* **Deterministic.** Dates default to UTC, and the clock is injectable with `now`. The test suite runs in 11 time zones (including ones with half-hour DST shifts and DST changes at midnight). The built package is verified on Node 16, 18, 22 and 24.
* Thoroughly tested: hundreds of unit tests plus property-based fuzzing (fast-check). For random queries the fuzzer checks that `format` is idempotent and keeps the meaning, that tokens cover the input exactly, and that every edit helper does exactly what it says. The example outputs in this README are checked by the test suite.

## Development

Requires Node.js 22.12+ (for the test tooling; the published package itself runs on Node 16+).

```sh
npm install
npm test             # unit, property-based and README tests
npm run test:tz      # the whole suite in 11 time zones
npm run playground   # build and serve the interactive demo at http://localhost:5178
npm run check        # typecheck, tests, time zones, build, built-package smoke tests, package lint
```

`npm publish` runs `npm run check` first (`prepublishOnly`).

## License

[MIT](./LICENSE)
