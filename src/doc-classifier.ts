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

export function classifyDoc(relPath: string): DocClassification {
  const baseName = path.posix.basename(relPath);
  if (!isMarkdownFile(baseName))
    throw new Error(`classifyDoc expected a Markdown file, got: ${relPath}`);

  const location: DocLocation = relPath.includes("/")
    ? relPath.startsWith("docs/")
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
