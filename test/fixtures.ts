import { createQuerybar } from '../src/index';

/** 2024-06-15T12:00:00.000Z — a Saturday. */
export const NOW = Date.UTC(2024, 5, 15, 12, 0, 0);

export const fields = {
  is: { type: 'enum', values: ['open', 'closed', 'draft'], description: 'Issue state' },
  author: { type: 'string', aliases: ['by'], suggestions: ['alice', 'bob', 'Zoë'] },
  label: { type: 'string', suggestions: ['bug', 'feature', 'good first issue', 'ui'] },
  title: { type: 'string', mode: 'contains' },
  stars: { type: 'number' },
  comments: { type: 'number', integer: true, min: 0 },
  created: { type: 'date' },
  archived: { type: 'boolean' },
  sort: { type: 'enum', values: ['created-asc', 'created-desc', 'stars'], filter: false },
} as const;

export const search = createQuerybar({ fields, now: () => NOW });

export interface Issue {
  id: number;
  title: string;
  body?: string;
  author: string;
  label: string[];
  is: string;
  stars: number;
  comments: number;
  created: string | Date | number;
  archived?: boolean;
}

export const issues: Issue[] = [
  {
    id: 1,
    title: 'Login button broken on Safari',
    body: 'Clicking login does nothing',
    author: 'alice',
    label: ['bug', 'ui'],
    is: 'open',
    stars: 12,
    comments: 3,
    created: '2024-01-10T09:00:00Z',
  },
  {
    id: 2,
    title: 'Add dark mode',
    author: 'bob',
    label: ['feature', 'ui'],
    is: 'closed',
    stars: 40,
    comments: 10,
    created: new Date(Date.UTC(2024, 2, 5)),
    archived: true,
  },
  {
    id: 3,
    title: 'Crash when uploading a café photo',
    body: 'Stack trace attached',
    author: 'Zoë',
    label: ['bug', 'good first issue'],
    is: 'open',
    stars: 3,
    comments: 0,
    created: Date.UTC(2024, 5, 14, 8),
  },
  {
    id: 4,
    title: 'Docs: typo in README',
    author: 'dependabot',
    label: [],
    is: 'draft',
    stars: 0,
    comments: 1,
    created: '2023-12-31T23:59:59Z',
  },
  {
    id: 5,
    title: '한글 검색 지원',
    body: '한국어 문서 검색이 필요합니다',
    author: 'minji',
    label: ['feature'],
    is: 'open',
    stars: 7,
    comments: 2,
    created: '2024-06-10T00:00:00Z',
  },
];

export const ids = (query: string): number[] => search.filter(issues, query).map((i) => i.id);
