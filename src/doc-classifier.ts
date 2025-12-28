import path from "node:path";
import type { RenameCaseMode } from "./naming.js";
import {
  extractDatePrefix,
  getCanonicalBaseName,
  isAllCapsDocBaseName,
  isMarkdownFile,
} from "./naming.js";

export type DocKind =
  | "installer"
  | "canonical"
  | "date-prefixed"
  | "capitalized"
  | "regular"
  | "other";

export type DocLocation = "root" | "docs" | "other";

export type DocClassification = {
  relPath: string;
  location: DocLocation;
  baseName: string;
  kind: DocKind;
  datePrefix: string | null;
  canonicalBaseName: string | null;
  desiredMode: RenameCaseMode;
  shouldDatePrefix: boolean;
};

export function classifyDoc(relPath: string): DocClassification {
  const baseName = path.posix.basename(relPath);
  const location: DocLocation = relPath.includes("/")
    ? relPath.startsWith("docs/")
      ? "docs"
      : "other"
    : "root";

  const isInstallerDoc =
    relPath === "docs/HOW_TO_DOC.md" || relPath === "docs/HOW_TO_DOC.mdx";

  const datePrefix = extractDatePrefix(baseName);
  const canonicalBaseName = getCanonicalBaseName(baseName);

  let kind: DocKind = "other";
  if (isMarkdownFile(baseName)) {
    if (isInstallerDoc) kind = "installer";
    else if (canonicalBaseName) kind = "canonical";
    else if (datePrefix) kind = "date-prefixed";
    else if (location === "docs" && isAllCapsDocBaseName(baseName))
      kind = "capitalized";
    else kind = "regular";
  }

  const desiredMode: RenameCaseMode =
    kind === "canonical" || kind === "capitalized" || kind === "installer"
      ? "capitalized"
      : "lowercase";

  const shouldDatePrefix = kind === "regular" && location !== "other";

  return {
    relPath,
    location,
    baseName,
    kind,
    datePrefix,
    canonicalBaseName,
    desiredMode,
    shouldDatePrefix,
  };
}
