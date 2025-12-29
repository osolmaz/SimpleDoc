export type RenameCaseMode = "lowercase" | "capitalized";

const MARKDOWN_EXT_RE = /\.(md|mdx)$/i;

export function isMarkdownFile(filePath: string): boolean {
  return MARKDOWN_EXT_RE.test(filePath);
}

function splitMarkdownBaseName(baseName: string): {
  stem: string;
  ext: string;
} {
  const dot = baseName.lastIndexOf(".");
  const ext = dot === -1 ? "" : baseName.slice(dot);
  const stem = dot === -1 ? baseName : baseName.slice(0, dot);
  return { stem, ext: ext.toLowerCase() };
}

export function extractDatePrefix(baseName: string): string | null {
  const { stem } = splitMarkdownBaseName(baseName);
  const m = stem.match(/^(\d{4}-\d{2}-\d{2})(?:$|[-_\s])/);
  return m ? m[1]! : null;
}

export function isLowercaseDocBaseName(baseName: string): boolean {
  const { stem } = splitMarkdownBaseName(baseName);
  return /[a-z]/.test(stem) && !/[A-Z]/.test(stem);
}

export function isAllCapsDocBaseName(baseName: string): boolean {
  const { stem } = splitMarkdownBaseName(baseName);
  return /[A-Z]/.test(stem) && !/[a-z]/.test(stem);
}

const CANONICAL_CAPITALIZED_STEMS = new Set<string>([
  "readme",
  "agents",
  "install",
  "ideas",
  "todo",
  "principles",
  "relevant",
  "review_prompt",
  "jsend",
  "contributing",
  "code_of_conduct",
  "security",
  "support",
  "changelog",
  "history",
  "news",
  "notice",
  "authors",
  "contributors",
  "maintainers",
  "governance",
  "license",
  "licenses",
  "copying",
  "copyright",
  "patents",
  "third_party_notices",
  "faq",
  "roadmap",
]);

function normalizeCanonicalStem(stem: string): string {
  return stem
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeLowercaseStem(stem: string): string {
  return stem
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeCapitalizedStem(stem: string): string {
  const cleaned = stem
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/[^\p{L}\p{N}_]+/gu, "")
    .replace(/^_+|_+$/g, "");
  return cleaned.toLocaleUpperCase("en-US");
}

export function getCanonicalBaseName(baseName: string): string | null {
  const { stem, ext } = splitMarkdownBaseName(baseName);
  if (!MARKDOWN_EXT_RE.test(baseName)) return null;

  const canonicalStem = normalizeCanonicalStem(stem);
  if (CANONICAL_CAPITALIZED_STEMS.has(canonicalStem))
    return `${normalizeCapitalizedStem(stem)}${ext}`;
  if (/^rfc[-_ ]?\d+/i.test(stem))
    return `${normalizeCapitalizedStem(stem)}${ext}`;
  return null;
}

function parseDatePrefixedStem(
  stem: string,
): { date: string; rest: string } | null {
  const m = stem.match(/^(\d{4}-\d{2}-\d{2})(?:[-_\s]+(.*))?$/);
  if (!m) return null;
  return { date: m[1]!, rest: (m[2] ?? "").trim() };
}

function normalizeBaseName(baseName: string, mode: RenameCaseMode): string {
  const { stem, ext } = splitMarkdownBaseName(baseName);

  const dateParts = parseDatePrefixedStem(stem);
  if (dateParts) {
    const fallback = mode === "capitalized" ? "UNTITLED" : "untitled";
    const rest = dateParts.rest || fallback;
    const restNormalized =
      mode === "capitalized"
        ? normalizeCapitalizedStem(rest)
        : normalizeLowercaseStem(rest);
    return `${dateParts.date}-${restNormalized || fallback}${ext}`;
  }

  const normalizedStem =
    mode === "capitalized"
      ? normalizeCapitalizedStem(stem)
      : normalizeLowercaseStem(stem);
  return `${normalizedStem}${ext}`;
}

export function applyRenameCase(
  baseName: string,
  mode: RenameCaseMode,
): string {
  return normalizeBaseName(baseName, mode);
}
