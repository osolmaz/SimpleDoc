import path from "node:path";
import type { RenameCaseMode } from "./naming.js";
import {
  extractDatePrefix,
  getCanonicalBaseName,
  isAllCapsDocBaseName,
  isMarkdownFile,
} from "./naming.js";

export type DocLocation = "root" | "docs" | "other";

export type DocClassification = {
  relPath: string;
  location: DocLocation;
  baseName: string;
  mode: RenameCaseMode;
  datePrefix: string | null;
  shouldDatePrefix: boolean;
};

function normalizeDocsRoot(docsRoot: string): string {
  const normalized = docsRoot
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
  if (!normalized || normalized === ".") return "docs";
  return normalized;
}

export function classifyDoc(
  relPath: string,
  opts?: { docsRoot?: string },
): DocClassification {
  const baseName = path.posix.basename(relPath);
  if (!isMarkdownFile(baseName))
    throw new Error(`classifyDoc expected a Markdown file, got: ${relPath}`);

  const docsRoot = normalizeDocsRoot(opts?.docsRoot ?? "docs");
  const docsPrefix = `${docsRoot}/`;
  const location: DocLocation = relPath.includes("/")
    ? relPath.startsWith(docsPrefix)
      ? "docs"
      : "other"
    : "root";

  const datePrefix = extractDatePrefix(baseName);
  const isCanonical = Boolean(getCanonicalBaseName(baseName));

  const mode: RenameCaseMode = datePrefix
    ? "lowercase"
    : isCanonical || (location === "docs" && isAllCapsDocBaseName(baseName))
      ? "capitalized"
      : "lowercase";

  const shouldDatePrefix =
    mode === "lowercase" && location !== "other" && datePrefix === null;

  return {
    relPath,
    location,
    baseName,
    mode,
    datePrefix,
    shouldDatePrefix,
  };
}
