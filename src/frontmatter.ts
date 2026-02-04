export type FrontmatterValue = string | string[];

export type ParsedFrontmatter = {
  data: Record<string, string>;
  body: string;
  hasFrontmatter: boolean;
};

export const DOC_FRONTMATTER_ORDER = ["title", "author", "date", "tags"];

export const SIMPLELOG_FRONTMATTER_ORDER = [
  "title",
  "author",
  "date",
  "tz",
  "created",
  "last_section",
  "updated",
  "tags",
];

function yamlQuote(value: string): string {
  const s = String(value).replace(/\r?\n/g, " ").trim();
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function formatArray(values: string[]): string {
  const rendered = values.map((value) => yamlQuote(value));
  return `[${rendered.join(", ")}]`;
}

function formatValue(value: FrontmatterValue, quoteStrings: boolean): string {
  if (Array.isArray(value)) return formatArray(value);
  if (quoteStrings) return yamlQuote(value);
  return value;
}

function isEmptyValue(value: FrontmatterValue | undefined): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  return value.trim() === "";
}

export function buildFrontmatter(
  data: Record<string, FrontmatterValue | undefined>,
  opts?: { order?: string[]; quoteStrings?: boolean },
): string {
  const order = opts?.order ?? [];
  const quoteStrings = opts?.quoteStrings ?? false;
  const keys = Object.keys(data).filter((key) => !isEmptyValue(data[key]));
  const preferred = order.filter((key) => keys.includes(key));
  const extras = keys.filter((key) => !order.includes(key)).sort();
  const finalKeys = [...preferred, ...extras];

  const lines = finalKeys.map((key) => {
    const value = data[key] as FrontmatterValue;
    return `${key}: ${formatValue(value, quoteStrings)}`;
  });

  return `---\n${lines.join("\n")}\n---\n\n`;
}

export function parseFrontmatterBlock(content: string): ParsedFrontmatter {
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
