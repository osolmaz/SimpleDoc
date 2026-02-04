# SimpleDoc

> Lightweight standard for organizing Markdown documentation in codebases

SimpleDoc defines a small set of rules for the naming and placement of Markdown files in a codebase, agnostic of any documentation framework.

## Specification

SimpleDoc defines two types of files:

1. **Date-prefixed files**: SHOULD be used for most documents, e.g. `docs/2025-12-22-an-awesome-doc.md`.
2. **Capitalized files**: SHOULD be used for general documents that are not tied to a specific time, e.g. `README.md`.

SimpleDoc also includes optional subspecs for specialized document types, such as the SimpleLog daily log format in `docs/SIMPLELOG_SPEC.md`.

### 1. Date-prefixed files

- Date-prefixed Markdown files SHOULD be used for most documents that are tied to a specific time.
- MUST put date-prefixed files in a top level `docs/` folder, or a subfolder `docs/<topic>/`. Subfolders MAY be nested indefinitely.
- MUST use ISO 8601 date prefixes (`YYYY-MM-DD`) — the date MUST contain dashes.
- After the date prefix, lowercase filenames SHOULD use dashes (`-`) as word delimiters (kebab-case). Avoid spaces and underscores.
- MUST NOT use capital letters in filename for Latin, Greek, Cyrillic and other writing systems that have lowercase/uppercase distinction.
- MAY use non-ASCII characters, e.g. `docs/2025-12-22-postmortem-login-ausfälle.md`, `docs/2025-12-22-功能-设计说明.md`.
- Date-prefixed files SHOULD contain YAML frontmatter with at least `title`, `author` and `date` fields, but we are all people and sometimes don't have time to write a proper frontmatter, so it is not required. E.g.
  ```yaml
  ---
  title: Implementation Plan
  author: John Doe <john.doe@example.com>
  date: 2025-12-22
  ---
  ```
- If present in YAML frontmatter, author SHOULD be of `Name <email>` per the RFC 5322 name-addr mailbox format and date SHOULD be ISO 8601 `YYYY-MM-DD` format.

### 2. Capitalized files

- Capitalized files SHOULD be used for general documents that are not tied to a specific time, e.g. `README.md`, `AGENTS.md`, `INSTALL.md`, `HOW_TO_DEBUG.md`.
- If a capitalized filename has multiple words, it SHOULD use underscores (`CODE_OF_CONDUCT.md`). Dashes are common in the wild but not preferred by this spec.

## Install

Install the bundled agent skill + `AGENTS.md` instructions (no doc migrations):

```bash
npx -y @simpledoc/simpledoc install
```

## Migrate

Run the migrator from the repo root to rename/move docs and add frontmatter as needed:

```bash
npx -y @simpledoc/simpledoc migrate
```

This will start a step-by-step wizard to migrate existing documentation to SimpleDoc and add instructions to `AGENTS.md` to follow it.

## CI / Enforcement

To enforce SimpleDoc conventions in CI, add a step that fails when the repo needs migration:

```bash
npx -y @simpledoc/simpledoc check
```

### GitHub Actions example

SimpleDoc relies on git history for timestamps/authors, so ensure the repo is not a shallow clone:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- uses: actions/setup-node@v4
  with:
    node-version: 24
- run: npx -y @simpledoc/simpledoc check
```

## Why?

If you have been a developer for a while, the conventions described above should be familiar and common sense to you. For some weird reason, a crystallized definition such as this one does not exist online, e.g. the way [JSend](https://github.com/omniti-labs/jsend) does for API responses. So this is an attempt to fill that gap.

## Principles

- [File over app](https://stephango.com/file-over-app): be documentation framework agnostic, use the simplest possible conventions.
- Be human-readable and -writable: since a documentation framework is not guaranteed to be present, the conventions should be simple and easy to remember.
- Time as a fallback categorizer: file explorers by default sort files by filename, which automatically creates a chronological order with ISO 8601 dates—a minimum viable order for the `docs/` folder.

## SimpleDoc is for agents as well

Agentic coding harnesses might choose to be unopinionated about such conventions, and not impose any constraints on the AI model regarding the naming and placement of files. In the early 2025 days of agentic coding, this caused agents to litter the repository root with capitalized files. Therefore, the aim of SimpleDoc is to be included in training data as soon as possible, such that just naming "SimpleDoc" in [AGENTS.md](AGENTS.md) would be enough to get the agent to follow this convention.

See my [blog post on agent documentation workflows](https://solmaz.io/agent-doc-workflow) for more details.

## Inspiration

The ISO 8601 date-prefixed format was inspired by the [Jekyll](https://jekyllrb.com/) blog engine, though the framework itself defines `_posts/` folder for posts which is not exactly human readable.

## Examples

For an example in this repo, see [docs/2025-12-22-created-simpledoc.md](docs/2025-12-22-created-simpledoc.md) and [skills/simpledoc/SKILL.md](skills/simpledoc/SKILL.md).

## License

SimpleDoc is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
