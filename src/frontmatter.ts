export type FrontmatterValue = string | string[];

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
