/* ------------------------------------------------------------------------ */
/* Schema                                                                    */
/* ------------------------------------------------------------------------ */

interface FieldBase {
  /** Alternative names accepted for this field, e.g. `['by']` for `author`. */
  aliases?: readonly string[];
  /** Human readable description, surfaced in autocomplete suggestions. */
  description?: string;
  /**
   * Reads the value to compare from an item. Defaults to `item[path]`, where
   * `path` defaults to the field name. May return an array: the term then
   * matches when any element matches.
   */
  get?: (item: any) => unknown;
  /** Dot-separated property path used when `get` is not provided. */
  path?: string;
  /**
   * Overrides matching for this field. `false` makes the field a pure
   * qualifier (e.g. `sort:`) that the generated predicate ignores.
   */
  filter?: false | ((item: any, term: TermNode) => boolean);
}

export interface StringField extends FieldBase {
  type: 'string';
  /** How a plain value is compared with the item value. Default `'exact'`. */
  mode?: 'exact' | 'contains' | 'startsWith';
  /** Compare case-sensitively. Default `false`. */
  caseSensitive?: boolean;
  /** Values offered by autocomplete. */
  suggestions?: readonly string[] | ((prefix: string) => readonly string[]);
}

export interface NumberField extends FieldBase {
  type: 'number';
  /** Reject non-integer values. */
  integer?: boolean;
  /** Smallest accepted value (inclusive). */
  min?: number;
  /** Largest accepted value (inclusive). */
  max?: number;
}

export interface DateField extends FieldBase {
  type: 'date';
}

export interface BooleanField extends FieldBase {
  type: 'boolean';
}

export interface EnumField<V extends string = string> extends FieldBase {
  type: 'enum';
  /** The accepted values. Matching is case-insensitive. */
  values: readonly V[];
}

export type FieldDef = StringField | NumberField | DateField | BooleanField | EnumField;
export type FieldType = FieldDef['type'];
export type Fields = Record<string, FieldDef>;

export interface QuerybarOptions<F extends Fields = Fields> {
  /** The qualifiers (`key:value`) your search bar understands. */
  fields: F;
  /**
   * Where free text (words and "quoted phrases") is searched.
   * - `true` (default): every top-level string/number property of the item
   *   (or the item itself if it is a string).
   * - an array of property paths, e.g. `['title', 'body']`.
   * - a function returning a string or an array of strings.
   * - `false`: free text is ignored by the predicate.
   */
  text?: boolean | readonly string[] | ((item: any) => unknown);
  /**
   * What to do with `key:value` when `key` is not a known field.
   * - `'text'` (default): treat the whole token as free text, with a warning.
   * - `'error'`: report an error; the term is ignored by the predicate.
   */
  unknownFields?: 'text' | 'error';
  /** Enable `AND` / `OR` / `NOT` keywords and parentheses. Default `true`. */
  operators?: boolean;
  /** Enable `-term` / `!term` negation. Default `true`. */
  negation?: boolean;
  /** Time zone used for calendar dates such as `2024-05-01` or `today`. Default `'utc'`. */
  timeZone?: 'utc' | 'local';
  /** Clock used for relative dates (`7d`, `today`, ...). Default `Date.now`. */
  now?: () => number | Date;
  /** Ignore accents when comparing text (`cafe` matches `café`). Default `true`. */
  ignoreDiacritics?: boolean;
}

/* ------------------------------------------------------------------------ */
/* Syntax tree                                                               */
/* ------------------------------------------------------------------------ */

export interface Span {
  /** Offset of the first character in the input (UTF-16 code units). */
  start: number;
  /** Offset just past the last character. */
  end: number;
}

export type Operator = '=' | '>' | '>=' | '<' | '<=';

interface ValueBase extends Span {
  /** The value exactly as written, including quotes. */
  raw: string;
}

/** `field:*` — the field has any (non-empty) value. */
export interface ExistsValue extends ValueBase {
  kind: 'exists';
}
export interface StringValue extends ValueBase {
  kind: 'string';
  value: string;
  /** Unquoted `*` wildcards were used; `parts` are the literal pieces between them. */
  wildcard: boolean;
  parts: string[];
}
export interface NumberValue extends ValueBase {
  kind: 'number';
  value: number;
}
export interface BooleanValue extends ValueBase {
  kind: 'boolean';
  value: boolean;
}
export interface EnumValue extends ValueBase {
  kind: 'enum';
  /** The canonical value as declared in the schema. */
  value: string;
}
/**
 * A date is an interval `[from, to)` in epoch milliseconds: `2024-05` covers
 * the whole month. Relative points (`7d`, `now`) have `from === to`.
 */
export interface DateValue extends ValueBase {
  kind: 'date';
  /** Inclusive start (epoch ms). */
  from: number;
  /** Exclusive end (epoch ms); equals `from` for a relative point. */
  to: number;
}
/** `a..b` (inclusive). An omitted or `*` side is open. */
export interface NumberRangeValue extends ValueBase {
  kind: 'number-range';
  min: number | null;
  max: number | null;
}
export interface DateRangeValue extends ValueBase {
  kind: 'date-range';
  /** Inclusive lower bound (epoch ms) or `null` when open. */
  from: number | null;
  /** Exclusive upper bound (epoch ms) or `null` when open. */
  to: number | null;
}

export type TermValue =
  | ExistsValue
  | StringValue
  | NumberValue
  | BooleanValue
  | EnumValue
  | DateValue
  | NumberRangeValue
  | DateRangeValue;

/** `field:value`, `field:>=10`, `field:a,b` ... */
export interface TermNode extends Span {
  type: 'term';
  /** Canonical field name from the schema. */
  field: string;
  /** The key exactly as typed (may be an alias or differently cased). */
  key: string;
  op: Operator;
  /** Alternatives (comma-separated in the query); the term matches if any matches. */
  values: TermValue[];
  /** `false` when the term has errors; predicates then ignore it. */
  valid: boolean;
  /** The term exactly as written (without a leading `-`). */
  raw: string;
}

/** A free-text word or "quoted phrase". */
export interface TextNode extends Span {
  type: 'text';
  value: string;
  quoted: boolean;
}

export interface NotNode extends Span {
  type: 'not';
  child: Node;
}

export interface AndNode extends Span {
  type: 'and';
  children: Node[];
}

export interface OrNode extends Span {
  type: 'or';
  children: Node[];
}

export type Node = TermNode | TextNode | NotNode | AndNode | OrNode;

/* ------------------------------------------------------------------------ */
/* Results                                                                   */
/* ------------------------------------------------------------------------ */

export type DiagnosticCode =
  | 'unterminated-quote'
  | 'unmatched-paren'
  | 'unclosed-paren'
  | 'empty-group'
  | 'dangling-operator'
  | 'missing-value'
  | 'unknown-field'
  | 'invalid-value'
  | 'invalid-operator'
  | 'invalid-range';

export interface Diagnostic extends Span {
  code: DiagnosticCode;
  severity: 'error' | 'warning';
  /** English message; use `code` (and `field` / `suggestion`) to localise. */
  message: string;
  /** Field involved, if any. */
  field?: string;
  /** A "did you mean" replacement, if one was found. */
  suggestion?: string;
}

export interface ParseResult {
  input: string;
  /** The syntax tree, or `null` for an empty query. */
  ast: Node | null;
  diagnostics: Diagnostic[];
  /** `true` when there are no error diagnostics (warnings are allowed). */
  valid: boolean;
  /** Every qualifier term, in source order, at any depth. */
  terms: TermNode[];
  /** Every free-text node, in source order, at any depth. */
  text: TextNode[];
  /**
   * `true` when the query is a plain conjunction of (optionally negated)
   * terms and text — no `OR` anywhere. Handy when mapping to simple backends.
   */
  conjunctive: boolean;
}

/* ------------------------------------------------------------------------ */
/* Tokens (syntax highlighting)                                              */
/* ------------------------------------------------------------------------ */

export type TokenType =
  | 'whitespace'
  | 'paren'
  | 'keyword'
  | 'negation'
  | 'field'
  | 'colon'
  | 'operator'
  | 'value'
  | 'separator'
  | 'text'
  | 'error';

export interface Token extends Span {
  type: TokenType;
  text: string;
  /** Canonical field for `field` / `value` tokens of known fields. */
  field?: string;
  /** `true` if a diagnostic of severity `error` overlaps this token. */
  invalid?: boolean;
}

/* ------------------------------------------------------------------------ */
/* Autocomplete                                                              */
/* ------------------------------------------------------------------------ */

export interface Suggestion {
  /** What to show in the list. */
  label: string;
  /** Text that replaces `from..to` in the input. */
  insert: string;
  kind: 'field' | 'value' | 'keyword';
  description?: string;
}

export interface SuggestResult {
  /** What the cursor is on. */
  context: 'field' | 'value' | 'none';
  /** Canonical field name when `context === 'value'`. */
  field?: string;
  /** Range to replace with `Suggestion.insert`. */
  from: number;
  to: number;
  /** What was typed so far in the range (up to the cursor). */
  prefix: string;
  items: Suggestion[];
}

export interface SuggestOptions {
  /** Maximum number of suggestions. Default `50`. */
  limit?: number;
}

/* ------------------------------------------------------------------------ */
/* Editing                                                                   */
/* ------------------------------------------------------------------------ */

export type InputValue = string | number | boolean | Date;

export interface EditOptions {
  /** Operate on negated (`-field:value`) terms instead of positive ones. */
  negated?: boolean;
  /** Comparison operator for the new term. Default `'='`. */
  op?: Operator;
  /** Insert string values verbatim (no quoting), e.g. to pass `10..20` or `al*`. */
  raw?: boolean;
}

export interface MatchOptions {
  /** Look at negated (`-field:value`) terms instead of positive ones. */
  negated?: boolean;
  /**
   * When a value is given, only terms with this operator count
   * (default `'='`): `stars:>5` is not the filter `stars:5`.
   */
  op?: Operator;
}

export interface RemoveOptions extends MatchOptions {
  /**
   * Which occurrences to remove: positive only (`false`), negated only
   * (`true`) or both (`undefined`, the default).
   */
  negated?: boolean;
}
