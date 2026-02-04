import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createGitClient } from "../git.js";

type LogOptions = {
  root?: string;
  thresholdMinutes: number | string;
};

type LogClock = {
  timeZone: string;
  date: string;
  time: string;
  offset: string;
};

const ENTRY_RE = /^-\s+(\d{2}:\d{2}(?::\d{2})?)(Z|[+-]\d{2}:\d{2})\b/;
const SECTION_RE = /^##\s+(\d{2}):00\s*$/;

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

async function getBaseDir(): Promise<string> {
  const git = createGitClient();
  try {
    return await git.getRepoRoot(process.cwd());
  } catch {
    return process.cwd();
  }
}

function getLocalClock(now: Date): LogClock {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const useUTC = timeZone === "UTC";
  const year = useUTC ? now.getUTCFullYear() : now.getFullYear();
  const month = useUTC ? now.getUTCMonth() + 1 : now.getMonth() + 1;
  const day = useUTC ? now.getUTCDate() : now.getDate();
  const hour = useUTC ? now.getUTCHours() : now.getHours();
  const minute = useUTC ? now.getUTCMinutes() : now.getMinutes();
  const second = useUTC ? now.getUTCSeconds() : now.getSeconds();
  const offsetMinutes = useUTC ? 0 : -now.getTimezoneOffset();

  const date = `${year}-${pad2(month)}-${pad2(day)}`;
  const time = `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
  const offset = formatOffset(offsetMinutes);

  return { timeZone, date, time, offset };
}

function findLastSection(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? "";
    const match = line.match(SECTION_RE);
    if (match) return `## ${match[1]}:00`;
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

function buildHeader(clock: LogClock): string {
  const created = `${clock.date}T${clock.time}${clock.offset}`;
  return `# ${clock.date}\n> TZ: ${clock.timeZone}\n> Created: ${created}\n\n`;
}

export async function runLog(
  message: string,
  options: LogOptions,
): Promise<void> {
  try {
    const trimmed = message.trim();
    if (!trimmed) throw new Error("Log entry message is required.");

    const thresholdMinutes = parseThresholdMinutes(options.thresholdMinutes);
    const now = new Date();
    const clock = getLocalClock(now);

    const baseDir = await getBaseDir();
    const rootDir = options.root
      ? path.resolve(baseDir, options.root)
      : path.join(baseDir, "docs", "logs");

    await fs.mkdir(rootDir, { recursive: true });

    const filePath = path.join(rootDir, `${clock.date}.md`);
    let content = "";
    let fileExists = false;

    try {
      content = await fs.readFile(filePath, "utf8");
      fileExists = true;
    } catch (err) {
      if (!(err instanceof Error) || !("code" in err) || err.code !== "ENOENT")
        throw err;
    }

    if (!fileExists) content = buildHeader(clock);

    const lines = content.split(/\r?\n/);
    const currentSection = `## ${clock.time.slice(0, 2)}:00`;
    const lastSection = findLastSection(lines);
    const lastEntry = findLastEntryTime(lines, clock.date);

    let needsSection = false;
    if (!lastSection || lastSection !== currentSection) needsSection = true;

    if (!needsSection && thresholdMinutes > 0 && lastEntry) {
      const diffMs = now.getTime() - lastEntry.getTime();
      if (diffMs >= thresholdMinutes * 60_000) needsSection = true;
    }

    let nextContent = ensureTrailingNewline(content);
    if (needsSection) nextContent += `${currentSection}\n`;

    const entryLine = `- ${clock.time}${clock.offset} ${trimmed}`;
    nextContent += `${entryLine}\n`;

    await fs.writeFile(filePath, nextContent, "utf8");
    process.stdout.write(`Logged to ${filePath}\n`);
  } catch (err) {
    process.stderr.write(`${getErrorMessage(err)}\n`);
    process.exitCode = 1;
  }
}
