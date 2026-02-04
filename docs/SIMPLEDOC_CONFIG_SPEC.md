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
  "simplelog": {
    "root": "docs/logs",
    "thresholdMinutes": 5
  }
}
```

### simplelog.root

- **Type:** string
- **Meaning:** Root directory for SimpleLog daily files.
- **Resolution:** If relative, it is resolved from the repo root.
- **Recommendation:** Use a shared path in `simpledoc.json` (e.g. `docs/logs`) and a per-user path in `.simpledoc.local.json` when needed (e.g. `docs/logs/_local/<name>`).

### simplelog.thresholdMinutes

- **Type:** number
- **Meaning:** Default threshold (in minutes) for starting a new session section.
- **Default:** 5
- **Notes:** CLI flags should override this when provided.

## 5) Usage examples

### Shared default (committed)

`simpledoc.json`

```json
{
  "simplelog": {
    "root": "docs/logs"
  }
}
```

### Local override (uncommitted)

`.simpledoc.local.json`

```json
{
  "simplelog": {
    "root": "docs/logs/_local/alice",
    "thresholdMinutes": 2
  }
}
```

## 6) Git ignore

Teams SHOULD add `.simpledoc.local.json` to `.gitignore` to prevent accidental commits.
