export function normalizeDocsRoot(root?: string): string {
  const normalized = (root ?? "docs")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
  if (!normalized || normalized === ".") return "docs";
  return normalized;
}
