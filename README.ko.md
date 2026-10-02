# querybar

[English](./README.md) | **한국어**

**어떤 앱에든 GitHub 스타일 검색 문법을.** 필드를 한 번만 정의하면 오류에 관대한 파서, 메모리 내 필터, 구문 강조, 자동완성, "혹시 이걸 찾으셨나요?" 힌트, 필터 칩용 쿼리 편집 함수가 한 번에 생깁니다. 의존성 0개, gzip 기준 약 11 kB, 타입 완비.

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

## 왜 필요한가

관리자 페이지, 대시보드, 이슈 트래커, 로그 뷰어, 데이터 테이블은 결국 모두 "똑똑한" 검색창이 필요해집니다. 대부분의 팀은 이걸 매번 직접 만듭니다. 정규식 조금, `split(' ')` 조금, 그리고 아무도 제대로 처리하지 않는 예외 상황들(따옴표, 부정, 오타, 입력 중인 쿼리, 구문 강조, 텍스트를 깨뜨리지 않고 수정해야 하는 필터 칩)이 남습니다.

querybar는 UI를 뺀 검색창 전체입니다.

| | |
|---|---|
| **파싱** | `parse(query)`는 텍스트를 타입이 있는 구문 트리로 바꿉니다. **절대 예외를 던지지 않습니다.** 입력 중인 쿼리, 짝이 안 맞는 따옴표나 괄호, 오타는 정확한 위치가 담긴 진단 정보로 돌아옵니다. |
| **필터링** | `filter(items, query)` / `compile(query)`로 바로 쓸 수 있는 메모리 내 검색이 생깁니다. AND / OR / NOT, 그룹, 목록, 범위, 와일드카드, 상대 날짜, 대소문자·악센트를 무시하는 자유 텍스트 검색을 지원합니다. |
| **구문 강조** | `tokenize(query)`는 모든 글자를 빠짐없이 덮는 토큰을 돌려주므로, 강조된 입력창은 `map` 한 번이면 그릴 수 있습니다. |
| **자동완성** | `suggest(query, cursor)`는 커서가 필드 이름 위에 있는지 값 위에 있는지 구분하고, 필드·enum 값·불리언·날짜·직접 지정한 후보를 제안합니다. |
| **오타 교정** | `is:opne` → *"Did you mean "open"?"*, 바꿀 정확한 범위와 함께 알려 줍니다. |
| **편집** | `addFilter`, `setFilter`, `removeFilter`, `toggleFilter`는 필터 하나만 바꾸고 사용자가 입력한 나머지 텍스트는 그대로 둡니다. 모든 편집 결과는 검증되며, 항상 "기존 쿼리에 이 변경 하나만 적용한 것"과 같은 의미입니다. |
| **직렬화** | `format(query)`는 정규화된 형태를 돌려줍니다. 트리는 순수 JSON이라 SQL, Prisma, Mongo, API 호출로 쉽게 바꿀 수 있습니다([활용 예제](#활용-예제) 참고). |

## 설치

```sh
npm install querybar
```

ESM, CommonJS 빌드와 TypeScript 타입이 함께 들어 있습니다. Node.js 16 이상과 모든 최신 브라우저(ES2018)에서 동작합니다. 특정 플랫폼 API를 쓰지 않으므로 다른 JavaScript 런타임에서도 동작합니다.

## 빠른 시작

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
    sort: { type: 'enum', values: ['newest', 'stars'], filter: false }, // 필터가 아닌 한정자
  },
  text: ['title', 'body'], // 자유 텍스트를 검색할 위치
});

// 1. 필터링
const results = search.filter(issues, 'is:open label:bug,ui -label:wontfix stars:>=10 login');

// 2. 검증과 설명
const { diagnostics } = search.parse('is:opne stars:lots');
// [ { code: 'invalid-value', message: '"opne" is not a valid value for "is". Did you mean "open"? ...',
//     start: 3, end: 7, suggestion: 'open', severity: 'error', field: 'is' },
//   { code: 'invalid-value', message: '"lots" is not a number (field "stars").', start: 14, end: 18, ... } ]

// 3. 필터가 아닌 한정자 읽기
const [sort] = search.getValues('is:open sort:stars', 'sort'); // { kind: 'enum', value: 'stars', ... }

// 4. 사용자 텍스트를 깨뜨리지 않고 필터 칩 조작하기
search.toggleFilter('login is:open', 'label', 'bug'); // 'login is:open label:bug'
search.toggleFilter('login label:bug,ui', 'label', 'bug'); // 'login label:ui'
search.setFilter('is:closed login', 'is', 'open'); // 'is:open login'
search.addFilter('crash OR freeze', 'is', 'open'); // '(crash OR freeze) is:open'
```

대화형 플레이그라운드: 이 저장소를 클론한 뒤 `npm run playground`를 실행하세요.

## 쿼리 문법

| 문법 | 의미 |
|---|---|
| `login error` | 자유 텍스트. **모든** 단어가 포함되어야 합니다(대소문자·악센트 무시). |
| `"login error"` | 정확한 구문. |
| `field:value` | 한정자. 필드 이름은 대소문자를 구분하지 않으며 별칭을 가질 수 있습니다. |
| `field:a,b,c` | 값 중 하나(OR). |
| `field:a field:b` | 둘 다(AND). 배열 필드라면 둘 다 포함. |
| `-field:value` `!field:value` `NOT field:value` | 부정. 텍스트에도 동작합니다: `-wontfix`. |
| `a OR b` | 둘 중 하나. `AND`는 생략 가능하며(`a b` = `a AND b`) `OR`보다 먼저 결합합니다. |
| `(a OR b) c` | 그룹. `-(a OR b)`는 그룹 전체를 부정합니다. |
| `field:>10` `>=` `<` `<=` | 비교(숫자·날짜 필드). |
| `field:10..20` | 양 끝을 포함하는 범위. 열린 범위: `10..`, `..20`, `10..*`, `*..20`. |
| `field:al*` `field:*bot` `field:a*b` | 와일드카드(문자열 필드). 문자 `*` 자체를 찾으려면 따옴표로 감싸세요: `field:"a*"`. |
| `field:*` / `-field:*` | 값이 있음 / 비어 있거나 없음. |
| `field:"with spaces, commas (and parens)"` | 따옴표. 따옴표 안에서 `\"`는 따옴표, `\\`는 백슬래시이고, 그 밖의 백슬래시는 글자 그대로입니다. |

대문자 `AND`, `OR`, `NOT`만 키워드이므로 `or`, `and`는 일반 단어입니다. `e-mail`이나 `stars:-5`는 부정이 아닙니다. 맨 앞의 `-`만 부정입니다.

### 필드 타입

| 타입 | 받는 값 | 연산자 | 매칭되는 항목 값 |
|---|---|---|---|
| `string` | 모든 텍스트, 와일드카드 | `=` | 문자열(숫자와 불리언도 텍스트로 비교). `mode`: `'exact'`(기본), `'contains'`, `'startsWith'`. `caseSensitive: true`가 아니면 대소문자 무시. |
| `enum` | `values` 중 하나(대소문자 무시) | `=` | 같은 문자열, 대소문자 무시(숫자와 불리언은 텍스트로 비교) |
| `number` | `42`, `-1.5`, `.5`, `1e3`, 범위 | `= > >= < <=`, `a..b` | 숫자 또는 숫자 문자열 |
| `date` | 아래 참고, 범위 | `= > >= < <=`, `a..b` | `Date` 객체, epoch 밀리초, 날짜 문자열(`Date.parse`) |
| `boolean` | `true/false`, `yes/no`, `on/off`, `1/0` | `=` | 불리언, `1/0`, `"true"/"false"`. 값이 없으면 `false`로 취급. |

항목 값이 **배열**(또는 `Set`)이면 요소 중 **하나라도** 맞을 때 매칭됩니다. 그래서 `label:bug`는 `label` 배열에 `"bug"`가 들어 있는 항목을 찾습니다.

### 날짜

날짜는 기간으로 다루므로 의도한 그대로 쓸 수 있습니다.

| 값 | 의미 |
|---|---|
| `2024` / `2024-05` / `2024-05-17` | 그 해 / 그 달 / 그 날 전체 |
| `2024-05-17T10:30`, `…T10:30:15`, `…T10:30:15.250` | 그 분 / 그 초 / 그 밀리초 |
| `…T10:30Z`, `…T10:30+09:00` | 시간대 오프셋을 명시 |
| `"2024-05-17 10:30"` | `T` 대신 공백(따옴표로 감싸기) |
| `today`, `yesterday`, `tomorrow` | 해당 날짜 하루 |
| `now`, `30min`, `12h`, `7d`, `2w`, `3mo`, `1y` | 시점: 지금, 또는 그만큼 이전 |

* `created:2024-05` → 5월 중. `created:>2024-05` → 5월 이후(6월 1일부터). `created:<=2024-05` → 5월까지(5월 포함).
* `created:2024-01..2024-03` → 1월 1일부터 3월 말까지.
* 상대 시점만 단독으로 쓰면 "그때 이후"라는 뜻입니다: `updated:7d` = 최근 7일 이내. `updated:<30d` = 30일보다 오래됨. `created:30d..7d` = 30일 전부터 7일 전 사이.
* 달력 날짜는 기본적으로 **UTC**를 씁니다. 브라우저처럼 사용자 시간대를 쓰려면 `timeZone: 'local'`을 넘기세요. 월·연 계산은 월말로 맞춥니다(3월 31일 − 1mo = 2월 29일).

## API

### `createQuerybar(options)`

```ts
const search = createQuerybar({
  fields,                 // 필수, "필드 옵션" 참고
  text: true,             // 자유 텍스트를 검색할 위치(아래 참고)
  unknownFields: 'text',  // 'text' | 'error'
  operators: true,        // AND / OR / NOT과 괄호
  negation: true,         // -term과 !term
  timeZone: 'utc',        // 'utc' | 'local'
  now: () => Date.now(),  // today / 7d / now에 쓰는 시계(Date 또는 epoch ms)
  ignoreDiacritics: true, // cafe가 café와 매칭
});
```

스키마는 인스턴스를 만들 때 검사하며, 잘못된 스키마는 `TypeError`를 던집니다(알 수 없는 타입, 빈 enum, 잘못된 이름, 대소문자를 무시하면 같아지는 필드나 별칭 이름).

**`text`** 는 자유 텍스트가 검색할 대상을 정합니다.

* `true`(기본): 항목의 최상위 문자열·숫자 속성 전부(그리고 그 배열), 항목 자체가 문자열이면 그 문자열
* 속성 경로 배열: `['title', 'author.name']`
* 함수: `(item) => string | string[]`
* `false`: 자유 텍스트로는 필터링하지 않음(파싱은 되므로 직접 활용 가능)

**`unknownFields`**: `'text'`(기본)이면 알 수 없는 필드 `foo`에 대한 `foo:bar`를 텍스트 `foo:bar`로 검색하고 `unknown-field` 경고를 냅니다. `'error'`이면 오류로 처리하고 그 조건은 무시합니다. 어느 쪽이든 URL(`https://…`)은 진단 없이 항상 일반 텍스트입니다.

#### 필드 옵션

| 옵션 | 타입 | 설명 |
|---|---|---|
| `type` | 전체 | `'string' \| 'number' \| 'date' \| 'boolean' \| 'enum'`(필수) |
| `aliases` | 전체 | 다른 이름, 예: `['by']` |
| `description` | 전체 | 자동완성 제안에 표시 |
| `path` | 전체 | 항목 값까지의 점 경로(기본: 필드 이름). 점이 들어간 키가 실제로 있으면 그 키가 우선. |
| `get` | 전체 | `(item) => value`. `path`보다 우선. |
| `filter` | 전체 | `false`면 필터가 무시하는 순수 한정자(예: `sort:`). 함수 `(item, term) => boolean`이면 매칭 로직을 대체. |
| `values` | enum | 허용 값(필수) |
| `mode` | string | `'exact'`(기본), `'contains'`, `'startsWith'` |
| `caseSensitive` | string | 기본 `false` |
| `suggestions` | string | 자동완성용 `string[]` 또는 `(prefix) => string[]` |
| `integer`, `min`, `max` | number | 검증(범위를 벗어나면 `invalid-value` 오류) |

### `search.parse(query) → ParseResult`

```ts
interface ParseResult {
  input: string;
  ast: Node | null;          // 빈 쿼리면 null
  diagnostics: Diagnostic[]; // 위치순 정렬
  valid: boolean;            // 오류 진단이 없음(경고는 괜찮음)
  terms: TermNode[];         // 모든 한정자, 깊이와 상관없이 순서대로
  text: TextNode[];          // 모든 자유 텍스트 단어와 구문
  conjunctive: boolean;      // (부정 포함) 조건과 단어를 AND로만 묶은 쿼리: OR 없음, 부정 그룹 없음
}
```

트리는 JSON으로 직렬화할 수 있는 순수 데이터입니다. 모든 노드와 값에는 입력 내 위치인 `start`/`end`가 있습니다.

```ts
type Node =
  | { type: 'and' | 'or'; children: Node[] }
  | { type: 'not'; child: Node }
  | { type: 'text'; value: string; quoted: boolean }
  | { type: 'term'; field: string; key: string; op: '=' | '>' | '>=' | '<' | '<='; values: TermValue[]; valid: boolean; raw: string };

type TermValue =                                   // 각각 raw, start, end도 가짐
  | { kind: 'string'; value: string; wildcard: boolean; parts: string[] }
  | { kind: 'enum'; value: string }                 // 스키마에 정의된 표기
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'date'; from: number; to: number }      // epoch ms 기준 [from, to); 7d 같은 시점은 from === to
  | { kind: 'number-range'; min: number | null; max: number | null }  // 양 끝 포함
  | { kind: 'date-range'; from: number | null; to: number | null }    // [from, to)
  | { kind: 'exists' };                             // field:*
```

`field`는 정규 필드 이름이고, `key`는 사용자가 실제로 입력한 것(별칭일 수도, `IS`일 수도 있음)입니다.

**오류 복구.** 파서는 항상 만들 수 있는 최선의 트리를 만듭니다.

| 입력 | 결과 | 진단 |
|---|---|---|
| `label:"good first` | `label:"good first"` | `unterminated-quote`(경고) |
| `(a OR b` | `a OR b` | `unclosed-paren`(경고) |
| `a ) b` | `a b` | `unmatched-paren`(경고) |
| `a OR`, `NOT`, `a -` | `a`, *(빈 쿼리)*, `a` | `dangling-operator`(경고) |
| `a () b` | `a b` | `empty-group`(경고) |
| `lable:bug` | 텍스트 `lable:bug` | `unknown-field`(경고, 제안 `label`) |
| `label:` | 잘못된 조건(무시됨) | `missing-value`(오류) |
| `stars:lots` | 잘못된 조건(무시됨) | `invalid-value`(오류) |
| `author:>x` | 잘못된 조건(무시됨) | `invalid-operator`(오류) |
| `stars:9..1` | 잘못된 조건(무시됨) | `invalid-range`(오류) |

각 `Diagnostic`에는 `code`, `severity`, 영어 `message`, `start`/`end`, 그리고 해당하면 `field`와 `suggestion`이 있습니다. `code`를 이용해 직접 번역한 메시지를 보여 줄 수 있습니다.

### `search.filter(items, query)` / `search.compile(query)`

```ts
const visible = search.filter(issues, query); // T[]; 모든 iterable 허용
const test = search.compile<Issue>(query);    // (item: Issue) => boolean
```

둘 다 쿼리 문자열이나 `ParseResult`를 받으므로 한 번 파싱한 결과를 재사용할 수 있습니다. 잘못된 조건은 아무것도 매칭하지 않는 대신 **무시**됩니다. 그래서 사용자가 `stars:`를 입력하는 도중에 결과가 비었다 돌아오는 깜빡임이 없습니다. 빈 쿼리는 모든 항목과 매칭됩니다.

매칭 규칙: 없는 값(`null`/`undefined`)은 긍정 조건과 절대 매칭되지 않으므로 `-field:x`는 그런 항목과 매칭됩니다(예외: 불리언 필드는 없는 값을 `false`로 취급). 자유 텍스트와 문자열 필드는 기본적으로 대소문자와 악센트를 무시합니다. 악센트 제거 후 텍스트를 다시 조합하기 때문에, 한글 음절(`한`)이 자모 일부(`하`)와 잘못 매칭되는 일이 없습니다. 와일드카드는 정규식 없이 O(n·m) 시간에 매칭하므로 `a*a*a*…b` 같은 악의적인 패턴으로 페이지를 멈추게 할 수 없습니다.

### `search.tokenize(query) → Token[]`

토큰은 입력을 정확히 덮습니다: `tokens.map(t => t.text).join('') === query`.

```ts
type TokenType = 'field' | 'colon' | 'operator' | 'value' | 'separator' | 'text'
               | 'keyword' | 'negation' | 'paren' | 'whitespace' | 'error';
interface Token { type: TokenType; text: string; start: number; end: number; field?: string; invalid?: boolean }
```

`invalid`는 오류 진단이 걸친 토큰에 설정되어, 물결 밑줄을 그릴 때 편리합니다.

### `search.suggest(query, cursor?, { limit? }) → SuggestResult`

```ts
search.suggest('is:open la');
// { context: 'field', from: 8, to: 10, prefix: 'la',
//   items: [{ label: 'label', insert: 'label:', kind: 'field' }] }

search.suggest('label:goo');
// { context: 'value', field: 'label', from: 6, to: 9, prefix: 'goo',
//   items: [{ label: 'good first issue', insert: '"good first issue"', kind: 'value' }] }
```

* `context`는 `'field'`, `'value'`, `'none'`(따옴표 구문 안이나 알 수 없는 필드) 중 하나입니다.
* 필드는 이름이나 별칭으로 매칭합니다. enum과 boolean 필드는 값을, 날짜는 `today`, `yesterday`, `7d`, `30d`, `3mo`, `1y`를, 문자열 필드는 `suggestions`를 제안합니다. 이미 목록에 있는 값은 건너뜁니다(`is:open,`에서 `open`을 다시 제안하지 않음).
* 접두어 매칭이 먼저, 그다음 부분 문자열 매칭이 옵니다(둘 다 대소문자·악센트 무시).
* 대문자 접두어(`O`, `AN`)를 입력하면 `OR` / `AND` / `NOT`도 제안합니다.
* `cursor` 기본값은 입력의 끝이며, 범위를 벗어나면 안쪽으로 맞춥니다.

### `search.applySuggestion(query, result, item) → { text, cursor }`

`result.from..result.to`를 `item.insert`로 바꾸고, 커서를 둘 위치를 알려 줍니다. 입력 끝에서 값이나 키워드를 완성하면 계속 입력할 수 있도록 공백을 붙입니다.

### 편집 함수

모든 함수는 현재 쿼리 텍스트를 받아 새 텍스트를 돌려줍니다. **최상위** 조건(AND로 묶인 조건, 부정이나 괄호 포함)만 건드리고, `OR` 그룹 안의 조건은 그대로 둡니다. 나머지 쿼리는 사용자가 입력한 철자와 공백을 유지합니다. 모든 결과는 다시 파싱해서 정확히 "기존 쿼리에 이 변경만 적용한 것"인지 확인합니다. 드물게 텍스트를 보존하는 편집으로는 이를 보장할 수 없을 때는 정규화된 형태를 대신 돌려줍니다.

```ts
search.hasFilter('is:open label:bug,ui', 'label', 'ui');      // true
search.hasFilter('stars:>5', 'stars', 5);                     // false (연산자가 다름)
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

| 메서드 | 시그니처 |
|---|---|
| `hasFilter` | `(query, field, value?, { negated?, op? })`: `field`에 대한 최상위 조건이 있는가(`value`가 대안 중 하나인가)? |
| `getValues` | `(query, field)`: 최상위·긍정·`=` 조건의 값을 필드 타입에 맞게 반환 |
| `addFilter` | `(query, field, value \| value[], { negated?, op?, raw?, combine? })`: 완전히 같은 조건이 없을 때만 조건을 덧붙임. `combine: 'or'`이면 기존 목록을 확장. |
| `setFilter` | `(query, field, value \| value[] \| null, { negated?, op?, raw? })`: 해당 필드의 긍정 조건(`negated: true`면 부정 조건)을 교체하며, 새 조건은 첫 조건이 있던 자리에 씀. `null`이면 제거 |
| `removeFilter` | `(query, field, value? \| value[], { negated?, op? })`: 해당 필드의 조건을 제거하거나, 목록에서 `value`만 제거. `negated`를 지정하지 않으면 긍정·부정 조건 모두 제거. |
| `toggleFilter` | `(query, field, value, { negated?, op?, combine? })`: 값이 있으면 제거, 없으면 추가 |

값으로는 문자열, 숫자, 불리언, `Date`(ISO 타임스탬프로 기록)를 쓸 수 있습니다. 문자열은 필요하면 따옴표로 감싸고 `*`는 글자 그대로 둡니다. 와일드카드 같은 문법을 그대로 넣으려면 `{ raw: true }`를 넘기세요. 숫자·날짜 필드에는 `'10..20'` 같은 범위 문자열을 그대로 쓸 수 있습니다. 필드가 받을 수 없는 값(`stars: 'abc'`, `is: 'nope'`)을 추가하면 `RangeError`를, 알 수 없는 필드 이름이면 오류를 던집니다.

### `search.format(query)`와 `stringify(node)`

`format`은 쿼리의 정규화된 텍스트를 돌려줍니다. 공백 정리, 정규 필드 이름, 불필요한 괄호 제거, 짝이 안 맞는 따옴표와 괄호 복구를 합니다. 값의 표기는 유지됩니다(`created:2024-05`는 입력한 그대로). 여러 번 적용해도 결과가 같고, `format(q)`는 언제나 `q`와 정확히 같은 결과로 필터링합니다.

`search.stringify(node)`는 직접 만든 트리를 포함해 어떤 트리든 인스턴스의 문법에 맞는 쿼리 텍스트로 되돌립니다. 단독 함수 `stringify(node, { negation? })`로도 내보내며, `negation: false`이면 `-x` 대신 `NOT x`로 씁니다.

## 활용 예제

### 구문 강조 검색창(React)

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

같은 글꼴과 여백을 쓰는, 글자가 투명한 입력창 아래에 강조 레이어를 겹쳐 두면 됩니다. `examples/playground.html`은 자동완성, 키보드 탐색, 칩까지 갖춘 프레임워크 없는 완성 예제입니다.

### 쿼리를 URL에 유지하기

```ts
const q = new URL(location.href).searchParams.get('q') ?? '';
// ... 사용자가 수정 ...
const url = new URL(location.href);
url.searchParams.set('q', search.format(q));
history.replaceState(null, '', url);
```

### 데이터베이스 쿼리로 변환하기(파라미터 바인딩 SQL)

트리는 어떤 백엔드로든 쉽게 변환할 수 있습니다. 아래는 파라미터 바인딩을 쓰는 PostgreSQL 변환기 전체 코드입니다. 사용자 텍스트는 항상 파라미터로만 전달되고 SQL 문자열 안에는 절대 들어가지 않습니다.

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
            const hiOp = v.kind === 'number-range' ? '<=' : '<'; // 날짜 범위의 끝은 포함하지 않음
            const conv = (x: number) => (v.kind === 'date-range' ? new Date(x) : x);
            const parts = [];
            if (lo !== null) parts.push(`${col} >= ${p(conv(lo))}`);
            if (hi !== null) parts.push(`${col} ${hiOp} ${p(conv(hi))}`);
            return parts.join(' AND ');
          }
          case 'date': {
            // 날짜는 기간 [from, to). 상대 시점(7d)은 from === to.
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

알 수 없는 필드와 잘못된 조건은 `TRUE`가 되어 `filter`가 이를 무시하는 동작과 같습니다. SQL의 `NOT`은 `NULL`과 매칭되지 않지만 querybar의 `-field:x`는 값이 없는 항목과 매칭된다는 점에 주의하세요. 이 차이가 중요하다면 `COALESCE`나 `IS DISTINCT FROM`을 쓰세요. 백엔드가 AND만 지원한다면 `result.conjunctive`를 확인해서 다른 쿼리는 거부하거나 단순화하세요.

### 오류 메시지 한국어화

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

### 한글 등 비라틴 문자 필드 이름

필드 이름과 별칭에는 어떤 문자든 쓸 수 있습니다.

```ts
const search = createQuerybar({
  fields: { author: { type: 'string', aliases: ['작성자'] }, state: { type: 'enum', values: ['open', 'closed'], aliases: ['상태'] } },
});
search.filter(posts, '작성자:홍길동 상태:open 검색어');
```

## TypeScript

필드 이름과 enum 값은 스키마에서 추론되므로 `as const`가 필요 없습니다.

```ts
const search = createQuerybar({ fields: { state: { type: 'enum', values: ['open', 'closed'] } } });
const [v] = search.getValues(q, 'state');
if (v?.kind === 'enum') v.value; // 'open' | 'closed'
```

모든 타입(`Node`, `TermNode`, `TermValue`, `Diagnostic`, `Token`, `Suggestion`, `ParseResult`, …)을 내보냅니다. 타입을 쓰려면 TypeScript 5.0 이상이 필요합니다.

## 호환성과 보장

* **런타임 의존성 0개**, 부수 효과 없음, 트리 셰이킹 가능. ESM과 CommonJS 빌드 모두 타입 포함.
* **ES2018** 출력: Node.js 16+, Chrome 64+, Firefox 78+, Safari 11.1+.
* **사용자 입력으로 예외를 던지지 않음.** `parse`, `filter`, `tokenize`, `suggest`, `format`은 짝 없는 서로게이트, 제어 문자, 5만 단계로 중첩된 괄호, 수십만 자 길이의 쿼리를 포함해 어떤 문자열이든 받으며 선형 시간에 동작합니다. 100단계보다 깊은 중첩은 텍스트로 읽습니다.
* **결정적 동작.** 날짜는 기본 UTC이고 시계는 `now`로 주입할 수 있습니다. 테스트는 11개 시간대(30분 단위 서머타임, 자정에 바뀌는 서머타임 포함)에서 실행되며, 빌드된 패키지는 Node 16, 18, 22, 24에서 검증합니다.
* 철저한 테스트: 수백 개의 단위 테스트와 속성 기반 퍼징(fast-check). 무작위 쿼리에 대해 `format`이 멱등이고 의미를 유지하는지, 토큰이 입력을 정확히 덮는지, 모든 편집 함수가 말한 대로만 동작하는지 검사합니다. 이 README의 예제 출력도 테스트로 검사합니다.

## 개발

Node.js 22.12 이상이 필요합니다(테스트 도구 때문이며, 배포된 패키지 자체는 Node 16 이상에서 동작합니다).

```sh
npm install
npm test             # 단위, 속성 기반, README 테스트
npm run test:tz      # 11개 시간대에서 전체 테스트
npm run playground   # 빌드 후 http://localhost:5178 에서 대화형 데모 실행
npm run check        # 타입 검사, 테스트, 시간대, 빌드, 빌드 결과 스모크 테스트, 패키지 검사
```

`npm publish`는 먼저 `npm run check`를 실행합니다(`prepublishOnly`).

## 라이선스

[MIT](./LICENSE)
