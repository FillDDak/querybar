import { applySuggestion, suggest, tokenize } from './assist';
import { compile } from './compile';
import { Editor } from './edit';
import { parse, type ParserConfig } from './parser';
import { stringify } from './stringify';
import type {
  BooleanValue,
  DateRangeValue,
  DateValue,
  EditOptions,
  EnumValue,
  ExistsValue,
  FieldDef,
  Fields,
  InputValue,
  Node,
  NumberRangeValue,
  NumberValue,
  ParseResult,
  QuerybarOptions,
  MatchOptions,
  RemoveOptions,
  StringValue,
  Suggestion,
  SuggestOptions,
  SuggestResult,
  Token,
} from './types';

export type * from './types';

/** The value types `getValues` can return for a field definition. */
export type ValueFor<D> = D extends { type: 'enum'; values: readonly (infer V)[] }
  ? (Omit<EnumValue, 'value'> & { value: V }) | ExistsValue
  : D extends { type: 'number' }
    ? NumberValue | NumberRangeValue | ExistsValue
    : D extends { type: 'date' }
      ? DateValue | DateRangeValue | ExistsValue
      : D extends { type: 'boolean' }
        ? BooleanValue | ExistsValue
        : StringValue | ExistsValue;

/** A field name or one of its aliases (any casing is accepted at runtime). */
export type FieldName<F extends Fields> = Extract<keyof F, string> | (string & {});

export interface AddOptions extends EditOptions {
  /**
   * `'and'` (default) adds a separate term: `label:a label:b` (both required).
   * `'or'` extends an existing positive term's list: `label:a,b` (either).
   */
  combine?: 'and' | 'or';
}

export interface Querybar<F extends Fields = Fields> {
  /** The schema this instance was created with. */
  readonly fields: F;

  /** Parses a query. Never throws; problems are reported as `diagnostics`. */
  parse(input: string): ParseResult;

  /** Builds a predicate for in-memory filtering. Invalid terms are ignored. */
  compile<T = any>(query: string | ParseResult): (item: T) => boolean;

  /** Shorthand for `items.filter(compile(query))` (accepts any iterable). */
  filter<T>(items: Iterable<T>, query: string | ParseResult): T[];

  /** Tokens covering the whole input, for syntax highlighting. */
  tokenize(input: string): Token[];

  /** Autocomplete suggestions for the cursor position (default: end of input). */
  suggest(input: string, cursor?: number, options?: SuggestOptions): SuggestResult;

  /** Applies a suggestion; returns the new input and cursor position. */
  applySuggestion(
    input: string,
    result: Pick<SuggestResult, 'from' | 'to'>,
    suggestion: Pick<Suggestion, 'insert' | 'kind'>,
  ): { text: string; cursor: number };

  /** Rewrites a query in canonical form (normalised spacing and quoting). */
  format(input: string): string;

  /** Turns a syntax tree back into query text, using this instance's syntax options. */
  stringify(node: Node | null): string;

  /** Is there a top-level `field:value` (or any `field:` term when `value` is omitted)? */
  hasFilter(input: string, field: FieldName<F>, value?: InputValue, options?: MatchOptions): boolean;

  /** Values of the top-level, positive, `=` terms for `field` (e.g. read `sort:`). */
  getValues<K extends Extract<keyof F, string>>(input: string, field: K): Array<ValueFor<F[K]>>;
  getValues(input: string, field: FieldName<F>): Array<ValueFor<FieldDef>>;

  /** Appends `field:value` unless it is already present. */
  addFilter(input: string, field: FieldName<F>, value: InputValue | InputValue[], options?: AddOptions): string;

  /** Replaces every top-level `field:` term with `field:value` (in place of the first). `null` removes them. */
  setFilter(
    input: string,
    field: FieldName<F>,
    value: InputValue | InputValue[] | null | undefined,
    options?: EditOptions,
  ): string;

  /** Removes top-level `field:` terms, or just `value` from them. */
  removeFilter(input: string, field: FieldName<F>, value?: InputValue | InputValue[], options?: RemoveOptions): string;

  /** Adds `field:value` if missing, removes it if present. */
  toggleFilter(input: string, field: FieldName<F>, value: InputValue, options?: AddOptions): string;
}

const FIELD_NAME = /^[\p{L}_][\p{L}\p{N}_.-]*$/u;
const TYPES = ['string', 'number', 'date', 'boolean', 'enum'];

function validateSchema(fields: Fields): { lookup: Map<string, string>; names: string[] } {
  if (fields === null || typeof fields !== 'object') {
    throw new TypeError('querybar: `fields` must be an object.');
  }
  const lookup = new Map<string, string>();
  const names: string[] = [];
  const claim = (key: string, owner: string): void => {
    if (typeof key !== 'string' || !FIELD_NAME.test(key)) {
      throw new TypeError(
        `querybar: "${key}" can't be used as a field name or alias. ` +
          'Use letters, digits, "_", "." or "-", starting with a letter or "_".',
      );
    }
    const lower = key.toLowerCase();
    const previous = lookup.get(lower);
    if (previous !== undefined) {
      throw new TypeError(`querybar: "${key}" (field "${owner}") clashes with field "${previous}".`);
    }
    lookup.set(lower, owner);
    names.push(key);
  };
  for (const name of Object.keys(fields)) {
    const def = fields[name] as FieldDef | undefined;
    if (!def || typeof def !== 'object' || TYPES.indexOf(def.type) === -1) {
      throw new TypeError(`querybar: field "${name}" needs a type: ${TYPES.join(', ')}.`);
    }
    if (def.type === 'enum') {
      if (!Array.isArray(def.values) || def.values.length === 0 || def.values.some((v) => typeof v !== 'string' || v === '')) {
        throw new TypeError(`querybar: enum field "${name}" needs a non-empty list of non-empty string values.`);
      }
    }
    claim(name, name);
    for (const alias of def.aliases ?? []) claim(alias, name);
  }
  return { lookup, names };
}

/**
 * Creates a search syntax from a schema.
 *
 * @example
 * const search = createQuerybar({
 *   fields: {
 *     is: { type: 'enum', values: ['open', 'closed'] },
 *     author: { type: 'string', aliases: ['by'] },
 *     stars: { type: 'number' },
 *     created: { type: 'date' },
 *   },
 * });
 * const visible = search.filter(issues, 'is:open stars:>=10 -author:bot login bug');
 */
export function createQuerybar<const F extends Fields>(options: QuerybarOptions<F>): Querybar<F> {
  if (!options || typeof options !== 'object') throw new TypeError('querybar: options are required.');
  const fields = options.fields;
  const { lookup, names } = validateSchema(fields);
  const utc = (options.timeZone ?? 'utc') !== 'local';
  const ignoreDiacritics = options.ignoreDiacritics !== false;
  const clock = options.now;

  const config: ParserConfig & { ignoreDiacritics: boolean } = {
    fields,
    lookup,
    names,
    unknownFields: options.unknownFields === 'error' ? 'error' : 'text',
    operators: options.operators !== false,
    negation: options.negation !== false,
    ignoreDiacritics,
    dates: () => {
      let now = Date.now();
      if (clock) {
        try {
          const value = clock();
          const t = value instanceof Date ? value.getTime() : Number(value);
          if (Number.isFinite(t)) now = t;
        } catch {
          // A broken clock must not make parsing throw; fall back to Date.now().
        }
      }
      return { now, utc };
    },
  };

  const syntax = { negation: config.negation };
  const compileConfig = { fields, text: options.text ?? true, ignoreDiacritics };
  const editor = new Editor(config);
  const toInput = (input: unknown): string => (typeof input === 'string' ? input : input == null ? '' : String(input));
  const toResult = (query: string | ParseResult): ParseResult =>
    query !== null && typeof query === 'object' && 'ast' in query ? query : parse(query, config);

  const instance: Querybar<F> = {
    fields,
    parse: (input) => parse(input, config),
    compile: (query) => compile(toResult(query).ast, compileConfig),
    filter: (items, query) => {
      const test = compile(toResult(query).ast, compileConfig);
      const out = [];
      for (const item of items) if (test(item)) out.push(item);
      return out;
    },
    tokenize: (input) => {
      const text = toInput(input);
      return tokenize(text, config, parse(text, config).diagnostics);
    },
    suggest: (input, cursor, opts) => suggest(toInput(input), cursor, config, ignoreDiacritics, opts),
    applySuggestion: (input, result, suggestion) => applySuggestion(toInput(input), result, suggestion),
    format: (input) => stringify(parse(input, config).ast, syntax),
    stringify: (node) => stringify(node, syntax),
    hasFilter: (input, field, value, opts) => editor.run(() => editor.has(toInput(input), field, value, opts ?? {})),
    getValues: ((input: string, field: string) => editor.values(toInput(input), field)) as Querybar<F>['getValues'],
    addFilter: (input, field, value, opts) => editor.run(() => editor.add(toInput(input), field, value, opts ?? {})),
    setFilter: (input, field, value, opts) => editor.run(() => editor.set(toInput(input), field, value, opts ?? {})),
    removeFilter: (input, field, value, opts) => editor.run(() => editor.remove(toInput(input), field, value, opts ?? {})),
    toggleFilter: (input, field, value, opts) => editor.run(() => editor.toggle(toInput(input), field, value, opts ?? {})),
  };
  return instance;
}

export { stringify };
export type { StringifyOptions } from './stringify';
