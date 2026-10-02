# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-02

### Added

- `createQuerybar(schema)` with `string`, `number`, `date`, `boolean` and `enum` fields,
  aliases, custom getters/paths, custom or disabled matching and per-field validation.
- Query language: free text and phrases, `field:value`, comma lists, `AND` / `OR` / `NOT`,
  `-` / `!` negation, parentheses, comparisons, inclusive ranges, wildcards, `field:*`,
  calendar dates as periods, `today` / `yesterday` / `tomorrow`, and relative dates (`7d`, `3mo`).
- Fault-tolerant `parse` with positioned diagnostics and "did you mean" suggestions.
- `filter` / `compile` for in-memory search (case- and accent-insensitive, Hangul-safe).
- `tokenize` for syntax highlighting, `suggest` / `applySuggestion` for autocomplete.
- `format` / `stringify` for canonical, round-trippable query text.
- Query editing helpers: `hasFilter`, `getValues`, `addFilter`, `setFilter`, `removeFilter`, `toggleFilter`.
