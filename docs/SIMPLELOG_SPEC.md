# SimpleLog

> SimpleDoc subspec: Daily Markdown Log (DML) v1 - Specification

## 1) Storage layout

- **Root directory:** any path. When used inside a SimpleDoc codebase, logs SHOULD live under `docs/` or `docs/<topic>/` to remain compliant with SimpleDoc.
- **Daily file name:** `YYYY-MM-DD.md` (local date in the chosen "primary" timezone).
  - Example: `2025-12-01.md`
- **Optional subdirectories** (recommended when many files):
  - `YYYY/YYYY-MM-DD.md` or `YYYY/MM/YYYY-MM-DD.md`
  - Example: `2025/2025-12-01.md`

## 2) File encoding and newlines

- MUST be UTF-8.
- MUST use LF (`\n`) newlines.
- SHOULD end with a trailing newline.

## 3) Frontmatter (required)

Files MUST start with YAML frontmatter that follows SimpleDoc conventions.

Required fields:

- `title`: human-readable title for the day.
- `author`: `Name <email>` (RFC 5322 name-addr format).
- `date`: `YYYY-MM-DD`.
- `tz`: IANA timezone ID (e.g., `Europe/Berlin`).
- `created`: ISO-8601 timestamp with offset.

Optional fields:

- `updated`: ISO-8601 timestamp with offset.

Example:

```md
---
title: Daily Log 2025-12-01
author: Jane Doe <jane@example.com>
date: 2025-12-01
tz: Europe/Berlin
created: 2025-12-01T00:00:00+01:00
---
```

Notes:

- The file date is interpreted in the `tz` timezone.
- DST transitions are supported because each entry includes an offset.

## 4) Session sections (threshold)

Entries are grouped into session sections. Section titles SHOULD reflect the local time of the first entry in that section.

- **Section heading format (required):** `## HH:MM`
  - `HH` is 24-hour, zero-padded (`00-23`).

Example:

```md
## 09:13

## 14:03
```

Rules:

- SHOULD be in chronological order.
- A section may exist with no entries.

## 5) Entry format (appendable, human-readable, parseable)

Each entry is a block of text separated by at least one blank line. The entry body is freeform; the only reserved syntax is the session section headings.

Recommended entry body conventions (all optional):

- Severity token: `[INFO]`, `[WARN]`, `[ERROR]`, etc.
- Tags: `#tag` tokens
- Key-values: `key=value` tokens (values may be quoted)
- Optional timestamp prefix if you want exact times per entry, e.g. `09:14:10+01:00 ...`.

Examples:

```md
Standup notes #team

[WARN] API latency spike service=orders p95_ms=840

09:14:10+01:00 Deployed v1.8.2 #deploy ticket=ABC-123
```

Multiline entries:

- Continuation lines are allowed and are stored as-is.
- CLI implementations SHOULD NOT alter indentation; they only ensure a blank line separates entries.

Example:

```md
Incident review #ops

- suspected cause: cache stampede
- mitigation: rate-limit + warmup
```

## 6) Optional full timestamp derivation

If an entry begins with a timestamp prefix, you can derive a full timestamp by combining it with the file date:

- file date `YYYY-MM-DD`
- entry prefix `HH:MM[:SS]+HH:MM` or `HH:MM[:SS]-HH:MM`

Full timestamp:

- `YYYY-MM-DDTHH:MM[:SS]+HH:MM` or `YYYY-MM-DDTHH:MM[:SS]-HH:MM`

Example:

- File: `2025-12-01.md`
- Entry: `09:14:10+01:00 ...`
- Full timestamp: `2025-12-01T09:14:10+01:00`

## 7) CLI append behavior (normative)

When the CLI writes an entry (config is resolved via `simpledoc.json` / `.simpledoc.local.json` if present; see `docs/SIMPLEDOC_CONFIG_SPEC.md`):

1. Determine "now" in the primary timezone from frontmatter (or CLI config).
2. Select file by the local date in that timezone: `YYYY-MM-DD.md`.
3. If the file does not exist, create it with the required frontmatter.
4. Start a new session section when either:
   - no section exists yet, or
   - the last entry is older than the threshold (for example, 5 minutes).
     The new section title MUST be the current local time in `HH:MM` format.
5. Ensure there is a blank line between the last existing line and the new entry.
6. Append the new entry block using the exact input text (no indentation changes).

This guarantees the tool only appends (no in-file insertion) while keeping session grouping.

## 8) Complete example file

`2025-12-01.md`

```md
---
title: Daily Log 2025-12-01
author: Jane Doe <jane@example.com>
date: 2025-12-01
tz: Europe/Berlin
created: 2025-12-01T00:00:00+01:00
---

## 09:13

Checked alerts #ops

[WARN] Elevated error rate service=api code=502
notes="started after deploy"

## 14:03

Deployed v1.8.2 #deploy ticket=ABC-123

## 14:27

Incident review #ops

- suspected cause: cache stampede
- mitigation: rate-limit + warmup
```

## 9) Multiple timezones in one file (optional)

If you need multiple timezones in one file (rare, but possible):

- Keep the frontmatter `tz` as the default.
- Allow an optional zone ID after the offset if you include a timestamp prefix, e.g. `10:00:00+01:00 Europe/Berlin ...`.
