import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { loadConfig } from "../config.js";

type LogOptions = {
  root?: string;
  thresholdMinutes?: number | string;
};

type LogClock = {
  timeZone: string;
  date: string;
  time: string;
  offset: string;
};

type Frontmatter = {
  data: Record<string, string>;
  body: string;
  hasFrontmatter: boolean;
};

const ENTRY_RE = /^-?\s*(\d{2}:\d{2}(?::\d{2})?)(Z|[+-]\d{2}:\d{2})\b/;
const SECTION_RE = /^##\s+(\d{2}):(\d{2})(?::\d{2})?\s*$/;

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatOffset(offsetMinutes: number): string {
  if (offsetMinutes === 0) return "Z";
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `${sign}${pad2(hours)}:${pad2(minutes)}`;
}

function parseThresholdMinutes(value: number | string): number {
  if (typeof value === "number") {
    if (Number.isFinite(value) && value >= 0) return value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
  }
  throw new Error("--threshold-minutes must be a number >= 0");
}

function getDefaultTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function getClockForTimeZone(now: Date, timeZone: string): LogClock {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = formatter.formatToParts(now);
  const lookup = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  const year = Number(lookup("year"));
  const month = Number(lookup("month"));
  const day = Number(lookup("day"));
  const hour = Number(lookup("hour"));
  const minute = Number(lookup("minute"));
  const second = Number(lookup("second"));

  if (!year || !month || !day) {
    throw new Error(`Failed to derive date parts for timezone ${timeZone}`);
  }

  const date = `${year}-${pad2(month)}-${pad2(day)}`;
  const time = `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMinutes = Math.round((asUtc - now.getTime()) / 60_000);
  const offset = formatOffset(offsetMinutes);

  return { timeZone, date, time, offset };
}

function safeClockForTimeZone(now: Date, timeZone: string): LogClock | null {
  try {
    return getClockForTimeZone(now, timeZone);
  } catch {
    return null;
  }
}

function parseFrontmatter(content: string): Frontmatter {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") {
    return { data: {}, body: content, hasFrontmatter: false };
  }

  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === "---") {
      end = i;
      break;
    }
  }

  if (end === -1) {
    return { data: {}, body: content, hasFrontmatter: false };
  }

  const data: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) data[match[1]] = match[2];
  }

  const body = lines.slice(end + 1).join("\n");
  return { data, body, hasFrontmatter: true };
}

function stripLegacyHeader(content: string): string {
  const lines = content.split(/\r?\n/);
  if (!/^#\s+\d{4}-\d{2}-\d{2}\s*$/.test(lines[0] ?? "")) return content;

  let idx = 1;
  while (idx < lines.length) {
    const line = lines[idx] ?? "";
    if (line.trim() === "") {
      idx += 1;
      continue;
    }
    if (line.trim().startsWith(">")) {
      idx += 1;
      continue;
    }
    break;
  }

  return lines.slice(idx).join("\n");
}

type FrontmatterValue = string | string[];

function yamlQuote(value: string): string {
  const s = String(value).replace(/\r?\n/g, " ").trim();
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function formatFrontmatterValue(value: FrontmatterValue): string {
  if (Array.isArray(value))
    return `[${value.map((item) => yamlQuote(item)).join(", ")}]`;
  return value;
}

function buildFrontmatter(data: Record<string, FrontmatterValue>): string {
  const preferredOrder = [
    "title",
    "author",
    "date",
    "tz",
    "created",
    "updated",
  ];
  const preferred = preferredOrder.filter((key) => key in data);
  const extras = Object.keys(data)
    .filter((key) => !preferredOrder.includes(key))
    .sort();
  const keys = [...preferred, ...extras];
  const lines = keys
    .map((key) => `${key}: ${formatFrontmatterValue(data[key]!)}`)
    .filter((line) => !line.endsWith(": "));
  return `---\n${lines.join("\n")}\n---\n\n`;
}

function resolveAuthor(): string {
  const name =
    process.env.GIT_AUTHOR_NAME ||
    process.env.GIT_COMMITTER_NAME ||
    process.env.USER ||
    "Unknown";
  const email =
    process.env.GIT_AUTHOR_EMAIL ||
    process.env.GIT_COMMITTER_EMAIL ||
    process.env.EMAIL ||
    "unknown@example.com";

  if (name.includes("<") && name.includes(">")) return name;
  return `${name} <${email}>`;
}

function normalizeFrontmatter(
  data: Record<string, string>,
  clock: LogClock,
  author: string,
  titlePrefix?: string,
): { data: Record<string, string>; changed: boolean } {
  const next = { ...data };
  let changed = false;

  if (!next.title) {
    const prefix = titlePrefix?.trim();
    next.title = prefix ? `${prefix} ${clock.date}` : `Daily Log ${clock.date}`;
    changed = true;
  }
  if (!next.author) {
    next.author = author;
    changed = true;
  }
  if (!next.date) {
    next.date = clock.date;
    changed = true;
  }
  if (!next.tz) {
    next.tz = clock.timeZone;
    changed = true;
  }
  if (!next.created) {
    next.created = `${clock.date}T${clock.time}${clock.offset}`;
    changed = true;
  }

  return { data: next, changed };
}

function findLastSection(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? "";
    const match = line.match(SECTION_RE);
    if (match) return `## ${match[1]}:${match[2]}`;
  }
  return null;
}

function findLastEntryTime(lines: string[], date: string): Date | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? "";
    const match = line.match(ENTRY_RE);
    if (!match) continue;
    const time = match[1];
    const offset = match[2];
    const iso = `${date}T${time}${offset}`;
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function ensureTrailingNewline(text: string): string {
  if (text === "") return "";
  return text.endsWith("\n") ? text : `${text}\n`;
}

function ensureBlankLine(text: string): string {
  if (text === "") return "";
  if (text.endsWith("\n\n")) return text;
  if (text.endsWith("\n")) return `${text}\n`;
  return `${text}\n\n`;
}

function joinFrontmatterAndBody(frontmatter: string, body: string): string {
  const trimmedBody = body.replace(/^\n+/, "");
  if (!trimmedBody) return frontmatter;
  return `${frontmatter}${trimmedBody}`;
}

function normalizeEntryBody(message: string): string {
  const normalized = message.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const withoutLeadingBlank = normalized.replace(/^\n+/, "");
  return withoutLeadingBlank.replace(/\n+$/, "");
}

function buildEntryText(message: string): string {
  return normalizeEntryBody(message);
}

function parseIsoTimestamp(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export async function runLog(
  message: string,
  options: LogOptions,
): Promise<void> {
  try {
    const normalizedMessage = message
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    if (!normalizedMessage.trim())
      throw new Error("Log entry message is required.");

    const config = await loadConfig(process.cwd());
    const thresholdMinutes =
      options.thresholdMinutes !== undefined
        ? parseThresholdMinutes(options.thresholdMinutes)
        : config.simplelog.thresholdMinutes;
    const now = new Date();

    const baseDir = config.repoRootAbs;
    const rootDir = options.root
      ? path.resolve(baseDir, options.root)
      : path.resolve(baseDir, config.simplelog.root);

    await fs.mkdir(rootDir, { recursive: true });

    let timeZone = config.simplelog.timezone ?? getDefaultTimeZone();
    let clock = getClockForTimeZone(now, timeZone);
    let filePath = path.join(rootDir, `${clock.date}.md`);

    let content = "";
    let fileExists = false;

    try {
      content = await fs.readFile(filePath, "utf8");
      fileExists = true;
    } catch (err) {
      if (!(err instanceof Error) || !("code" in err) || err.code !== "ENOENT")
        throw err;
    }

    let parsed = parseFrontmatter(content);

    if (fileExists && parsed.hasFrontmatter && parsed.data.tz) {
      const desiredTz = parsed.data.tz;
      if (desiredTz !== timeZone) {
        const altClock = safeClockForTimeZone(now, desiredTz);
        if (altClock) {
          timeZone = altClock.timeZone;
          clock = altClock;
          const altPath = path.join(rootDir, `${clock.date}.md`);
          if (altPath !== filePath) {
            filePath = altPath;
            try {
              content = await fs.readFile(filePath, "utf8");
              fileExists = true;
            } catch (err) {
              if (
                !(err instanceof Error) ||
                !("code" in err) ||
                err.code !== "ENOENT"
              )
                throw err;
              fileExists = false;
              content = "";
            }
            parsed = parseFrontmatter(content);
          }
        }
      }
    }

    if (!fileExists) {
      content = "";
      parsed = { data: {}, body: "", hasFrontmatter: false };
    }

    const body = parsed.hasFrontmatter
      ? parsed.body
      : stripLegacyHeader(content);

    const author = config.frontmatterDefaults.author ?? resolveAuthor();
    const normalized = normalizeFrontmatter(
      parsed.data,
      clock,
      author,
      config.frontmatterDefaults.titlePrefix,
    );
    const lines = body.split(/\r?\n/);
    const lastSection = findLastSection(lines);
    const lastEntry =
      parseIsoTimestamp(parsed.data.updated) ??
      parseIsoTimestamp(parsed.data.created) ??
      findLastEntryTime(lines, clock.date);

    let needsSection = !lastSection || !lastEntry;
    if (!needsSection && thresholdMinutes > 0 && lastEntry) {
      const diffMs = now.getTime() - lastEntry.getTime();
      if (diffMs >= thresholdMinutes * 60_000) needsSection = true;
    }

    let nextBody = ensureTrailingNewline(body);
    if (nextBody.trim() !== "") nextBody = ensureBlankLine(nextBody);
    if (needsSection) {
      const sectionTitle = `## ${clock.time.slice(0, 5)}`;
      nextBody += `${sectionTitle}\n`;
      nextBody = ensureBlankLine(nextBody);
    }

    const entryText = buildEntryText(normalizedMessage);
    nextBody += `${entryText}\n`;

    const updated = `${clock.date}T${clock.time}${clock.offset}`;
    const updatedFrontmatterData: Record<string, FrontmatterValue> = {
      ...normalized.data,
      updated,
    };
    if (
      !("tags" in updatedFrontmatterData) &&
      config.frontmatterDefaults.tags
    ) {
      updatedFrontmatterData.tags = config.frontmatterDefaults.tags;
    }
    const updatedFrontmatter = buildFrontmatter(updatedFrontmatterData);
    const nextContent = joinFrontmatterAndBody(updatedFrontmatter, nextBody);
    await fs.writeFile(filePath, nextContent, "utf8");
    process.stdout.write(`Logged to ${filePath}\n`);
  } catch (err) {
    process.stderr.write(`${getErrorMessage(err)}\n`);
    process.exitCode = 1;
  }
}
