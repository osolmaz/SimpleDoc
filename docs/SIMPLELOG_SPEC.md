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

## 3) File header

First lines define the day and timezone context.

Required:

1. `# YYYY-MM-DD`
2. `> TZ: <IANA timezone>`

Optional (recommended):

- `> Created: <ISO-8601 timestamp>`
- `> Updated: <ISO-8601 timestamp>`

Example:

```md
# 2025-12-01

> TZ: Europe/Berlin
> Created: 2025-12-01T00:00:00+01:00
```

Notes:

- The file date is interpreted in the header timezone.
- DST transitions are supported because each entry includes an offset.

## 4) Time sections (hour)

Entries are grouped under hour headings.

- **Section heading format (required):** `## HH:00`
  - `HH` is 24-hour, zero-padded (`00-23`).

Example:

```md
## 09:00

## 14:00
```

Rules:

- SHOULD be in chronological order.
- A section may exist with no entries.

## 5) Entry format (appendable, human-readable, parseable)

Each entry is a Markdown list item starting with a local-time timestamp **including timezone offset**.

Required entry prefix:

- `- <TIME><OFFSET> `

Where:

- `<TIME>` is `HH:MM` or `HH:MM:SS`
- `<OFFSET>` is `Z` or `+HH:MM` or `-HH:MM` (e.g., `+01:00`, `-05:00`)

Recommended entry body conventions (all optional):

- Severity token: `[INFO]`, `[WARN]`, `[ERROR]`, etc.
- Tags: `#tag` tokens
- Key-values: `key=value` tokens (values may be quoted)

Examples:

```md
- 09:13+01:00 Standup notes #team
- 09:14:10+01:00 [WARN] API latency spike service=orders p95_ms=840
- 14:03:22+01:00 Deployed v1.8.2 #deploy ticket=ABC-123
```

Multiline entries:

- Continuation lines MUST be indented by two spaces (or more) to remain inside the list item.
- CLI implementations SHOULD indent newline characters from user input by two spaces so multiline entries remain valid list items.

Example:

```md
- 14:27:05+01:00 Incident review #ops
  - suspected cause: cache stampede
  - mitigation: rate-limit + warmup
```

## 6) Deriving a full timestamp

Given:

- file date `YYYY-MM-DD`
- entry prefix `HH:MM[:SS]+HH:MM` or `HH:MM[:SS]-HH:MM`

The full timestamp is:

- `YYYY-MM-DDTHH:MM[:SS]+HH:MM` or `YYYY-MM-DDTHH:MM[:SS]-HH:MM`

Example:

- File: `2025-12-01.md`
- Entry: `- 09:14:10+01:00 ...`
- Full timestamp: `2025-12-01T09:14:10+01:00`

## 7) CLI append behavior (normative)

When the CLI writes an entry:

1. Determine "now" in the primary timezone from the header (or CLI config).
2. Select file by the local date in that timezone: `YYYY-MM-DD.md`.
3. If the file does not exist, create it with the required header.
4. Select section by local hour: `## HH:00`.
5. Append-only behavior:
   - If the last hour section in the file is not `HH:00`, append a new `## HH:00` at the end.
   - Append the new entry as the last line in the current section (i.e., at file end after the section header and any existing entries).
   - A CLI MAY start a new `## HH:00` section when the last entry is older than a configurable threshold (for example, 5 minutes) to separate sessions, even if the hour has not changed.

This guarantees the tool only appends (no in-file insertion) while keeping hour grouping.

## 8) Complete example file

`2025-12-01.md`

```md
# 2025-12-01

> TZ: Europe/Berlin
> Created: 2025-12-01T00:00:00+01:00

## 09:00

- 09:13:42+01:00 Checked alerts #ops
- 09:14:10+01:00 [WARN] Elevated error rate service=api code=502
  notes="started after deploy"

## 14:00

- 14:03:22+01:00 Deployed v1.8.2 #deploy ticket=ABC-123
- 14:27:05+01:00 Incident review #ops
  - suspected cause: cache stampede
  - mitigation: rate-limit + warmup
```

## 9) Multiple timezones in one file (optional)

If you need multiple timezones in one file (rare, but possible):

- Keep the header TZ as the default.
- Allow an optional zone ID after the offset, e.g. `- 10:00:00+01:00 Europe/Berlin ...`.
