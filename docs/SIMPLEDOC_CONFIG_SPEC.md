# SimpleDoc Config

> Repository and local configuration for SimpleDoc tools

## 1) Config files

SimpleDoc tooling MAY read two JSON config files at the repo root:

- `simpledoc.json` (committed, shared defaults)
- `.simpledoc.local.json` (uncommitted, per-user overrides)

Both files are optional.

## 2) File format

- MUST be valid JSON.
- MUST be UTF-8.
- MUST use LF (`\n`) newlines.

## 3) Precedence

Configuration values are resolved in this order (highest wins):

1. CLI flags
2. `.simpledoc.local.json`
3. `simpledoc.json`
4. Tool defaults

## 4) Schema

Top-level object. Current keys:

```json
{
  "docs": {
    "root": "docs"
  },
  "frontmatter": {
    "defaults": {
      "author": "Jane Doe <jane@example.com>",
      "tags": ["docs", "simpledoc"],
      "titlePrefix": "Daily Log"
    }
  },
  "check": {
    "ignore": ["docs/generated/**", "docs/_drafts/**"]
  },
  "simplelog": {
    "root": "docs/logs",
    "thresholdMinutes": 5,
    "timezone": "Europe/Berlin"
  }
}
```

### docs.root

- **Type:** string
- **Meaning:** Root directory for SimpleDoc-managed documentation.
- **Resolution:** If relative, it is resolved from the repo root.
- **Default:** `docs`
- **Notes:** Tools like `npx -y @simpledoc/simpledoc check` and `npx -y @simpledoc/simpledoc migrate` SHOULD treat this as the documentation root.

### frontmatter.defaults

- **Type:** object
- **Meaning:** Default frontmatter values to use when a tool needs to create or insert frontmatter.
- **Notes:** These values SHOULD only fill missing fields and MUST NOT overwrite existing frontmatter.

Supported keys:

- `author` (string): Default `Name <email>` to use.
- `tags` (string array): Default tags to add (optional).
- `titlePrefix` (string): Prefix used when generating titles (optional).

### check.ignore

- **Type:** array of strings
- **Meaning:** Glob-like patterns to ignore when scanning for violations in `npx -y @simpledoc/simpledoc check` (and optionally other scans).
- **Resolution:** Patterns are matched relative to the repo root.
- **Notes:** Ignored paths SHOULD be skipped entirely during scans.

### simplelog.root

- **Type:** string
- **Meaning:** Root directory for SimpleLog daily files.
- **Resolution:** If relative, it is resolved from the repo root.
- **Default:** `${docs.root}/logs` (falls back to `docs/logs` if `docs.root` is unset).
- **Recommendation:** Use a shared path in `simpledoc.json` (e.g. `docs/logs`) and a per-user path in `.simpledoc.local.json` when needed (e.g. `docs/logs/_local/<name>`).

### simplelog.thresholdMinutes

- **Type:** number
- **Meaning:** Default threshold (in minutes) for starting a new session section.
- **Default:** 5
- **Notes:** CLI flags should override this when provided.

### simplelog.timezone

- **Type:** string
- **Meaning:** IANA timezone ID to use when creating new SimpleLog files and sections.
- **Default:** System timezone (or `UTC` if unavailable).
- **Notes:** If a SimpleLog file exists with a `tz` frontmatter value, that value SHOULD take precedence for that file.

## 5) Usage examples

### Shared default (committed)

`simpledoc.json`

```json
{
  "docs": {
    "root": "docs"
  },
  "frontmatter": {
    "defaults": {
      "author": "Jane Doe <jane@example.com>",
      "tags": ["docs", "simpledoc"]
    }
  },
  "check": {
    "ignore": ["docs/generated/**"]
  },
  "simplelog": {
    "root": "docs/logs"
  }
}
```

### Local override (uncommitted)

`.simpledoc.local.json`

```json
{
  "docs": {
    "root": "docs"
  },
  "frontmatter": {
    "defaults": {
      "author": "Alice Example <alice@example.com>"
    }
  },
  "simplelog": {
    "root": "docs/logs/_local/alice",
    "thresholdMinutes": 2,
    "timezone": "Europe/Berlin"
  }
}
```

## 6) Git ignore

Teams SHOULD add `.simpledoc.local.json` to `.gitignore` to prevent accidental commits.
