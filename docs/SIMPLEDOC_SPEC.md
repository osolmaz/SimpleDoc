# SimpleDoc

> Lightweight standard for organizing Markdown documentation in codebases

SimpleDoc defines a small set of rules for the naming and placement of Markdown files in a codebase, agnostic of any documentation framework:

## Specification

SimpleDoc defines two types of files:

1. **Date-prefixed files**: SHOULD be used for most documents, e.g. `docs/2025-12-22-an-awesome-doc.md`.
2. **Capitalized files**: SHOULD be used for general documents that are not tied to a specific time, e.g. `README.md`.

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
