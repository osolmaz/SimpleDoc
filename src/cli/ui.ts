import process from "node:process";
import { confirm, isCancel, note, select, text } from "@clack/prompts";
import type { Option } from "@clack/prompts";

export const MAX_STEP_FILE_PREVIEW_LINES = 20;

export function limitLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return `${lines.slice(0, maxLines).join("\n")}\n- …and ${lines.length - maxLines} more`;
}

function wrapLineWithIndent(
  line: string,
  width: number,
): { lines: string[]; maxLineLength: number } {
  const bulletMatch = line.match(/^(\s*[-*]\s+)/);
  const firstPrefix = bulletMatch?.[1] ?? "";
  const restPrefix = firstPrefix ? " ".repeat(firstPrefix.length) : "";
  const content = firstPrefix ? line.slice(firstPrefix.length) : line;
  const available = Math.max(10, width - firstPrefix.length);

  const words = content.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (!current) return;
    out.push(current);
    current = "";
  };

  const pushLongWord = (word: string) => {
    for (let i = 0; i < word.length; i += available) {
      out.push(word.slice(i, i + available));
    }
  };

  for (const word of words) {
    if (!current) {
      if (word.length > available) {
        pushLongWord(word);
        continue;
      }
      current = word;
      continue;
    }

    if (current.length + 1 + word.length <= available) {
      current = `${current} ${word}`;
      continue;
    }

    pushCurrent();
    if (word.length > available) {
      pushLongWord(word);
      continue;
    }
    current = word;
  }
  pushCurrent();

  if (out.length === 0) out.push("");

  const rendered = out.map((l, idx) =>
    idx === 0 ? `${firstPrefix}${l}` : `${restPrefix}${l}`,
  );
  const maxLineLength = rendered.reduce((max, l) => Math.max(max, l.length), 0);
  return { lines: rendered, maxLineLength };
}

function wrapForNote(message: string, title?: string): string {
  const cols = process.stdout.columns ?? 80;
  const slack = 10;
  const maxMessageWidth = Math.max(40, cols - slack);

  const titleLen = title ? title.length + 6 : 0;
  const width = Math.min(maxMessageWidth, Math.max(40, cols - slack, titleLen));

  const lines = message.split(/\r?\n/);
  const wrapped: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") {
      wrapped.push("");
      continue;
    }
    wrapped.push(...wrapLineWithIndent(line, width).lines);
  }
  return wrapped.join("\n");
}

export function noteWrapped(message: string, title?: string): void {
  note(wrapForNote(message, title), title);
}

export async function promptConfirm(
  message: string,
  initialValue: boolean,
): Promise<boolean | null> {
  const value = await confirm({ message, initialValue });
  if (isCancel(value)) return null;
  return value;
}

export async function promptText(
  message: string,
  defaultValue: string,
): Promise<string | null> {
  const value = await text({
    message,
    placeholder: defaultValue,
    defaultValue,
  });
  if (isCancel(value)) return null;
  return value.trim() || defaultValue;
}

export async function promptSelect<T extends string>(
  message: string,
  options: Option<T>[],
  initialValue?: T,
): Promise<T | null> {
  const value = await select({
    message,
    options,
    initialValue,
  });
  if (isCancel(value)) return null;
  return value as T;
}

export function createScanProgressBarReporter(
  enabled: boolean,
): (info: { phase: "scan"; current: number; total: number }) => void {
  if (!enabled) return () => {};
  let lastLineLength = 0;
  let lastTick = 0;
  return (info) => {
    if (info.phase !== "scan") return;
    const now = Date.now();
    if (now - lastTick < 80 && info.current !== info.total) return;
    lastTick = now;

    const cols = process.stdout.columns ?? 80;
    const barWidth = Math.max(10, Math.min(40, cols - 35));
    const ratio = info.total === 0 ? 1 : info.current / info.total;
    const filled = Math.min(barWidth, Math.round(barWidth * ratio));
    const empty = Math.max(0, barWidth - filled);
    const bar = `${"#".repeat(filled)}${"-".repeat(empty)}`;
    const percent = Math.min(100, Math.round(ratio * 100));
    const line = `Scanning repo files: [${bar}] ${info.current}/${info.total} ${percent}%`;
    const padded =
      line.length >= lastLineLength
        ? line
        : `${line}${" ".repeat(lastLineLength - line.length)}`;
    lastLineLength = padded.length;
    process.stderr.write(`\r${padded}`);
    if (info.current === info.total) process.stderr.write("\n");
  };
}
