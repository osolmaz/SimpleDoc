# TODO

## Refactors (production hardening)

- [x] Extract naming rules into `src/naming.ts` (date-prefix parsing, canonical detection, normalization) and reuse from both `src/migrator.ts` and `src/cli.ts`.
- [x] Introduce a `classifyDoc(relPath)` helper that returns `{ kind, desiredMode, shouldDatePrefix }` and refactor migration planning to use it (less nested logic, fewer edge-case bugs).
- [x] Make git lookups lazy + cached: only run `git log --follow` for files that actually need a date/author (date-prefixing + frontmatter), not for every candidate.
- [x] Harden renames on case-insensitive filesystems: force 2-phase renames when `from.toLowerCase() === to.toLowerCase()` (case-only renames like `readme.md -> README.md` can be flaky otherwise).
- [x] Split `src/cli.ts` into step modules (`src/cli/steps/*.ts`) so each step owns: detect → preview → prompt → apply, and new steps don’t bloat one giant function.
- [x] Tighten reference updates: add size limits/ignore rules (skip huge files), and optionally support more link patterns (`[text](docs/...)`, `<docs/...>`) without scanning everything blindly.
- [x] Centralize git operations in `src/git.ts` (async `spawn`, concurrency limiter, injectable `GitClient`) and use it from `src/migrator.ts`.
