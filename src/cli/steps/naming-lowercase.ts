import path from "node:path";

import type { RenameAction, RenameCaseMode } from "../../migrator.js";
import { formatActions } from "../../migrator.js";
import { extractDatePrefix } from "../../naming.js";
import {
  limitLines,
  MAX_STEP_FILE_PREVIEW_LINES,
  noteWrapped,
  promptSelect,
} from "../ui.js";
import { collectRenameCaseOverrides } from "./rename-case-overrides.js";

function hasDatePrefix(baseName: string): boolean {
  return extractDatePrefix(baseName) !== null;
}

export function detectLowercaseDocRenames(
  renameActions: RenameAction[],
  docsRoot: string,
): RenameAction[] {
  const docsPrefix = `${docsRoot.replace(/\/+$/, "")}/`;
  return renameActions.filter(
    (a) =>
      a.from.startsWith(docsPrefix) &&
      a.to.startsWith(docsPrefix) &&
      hasDatePrefix(path.posix.basename(a.to)),
  );
}

export async function runLowercaseNamingStep(actions: RenameAction[]): Promise<{
  include: boolean;
  renameCaseOverrides: Record<string, RenameCaseMode>;
} | null> {
  if (actions.length === 0) return { include: false, renameCaseOverrides: {} };

  noteWrapped(
    `Docs that will be renamed to SimpleDoc dated naming (adds missing YYYY-MM-DD and normalizes separators):\n\n${limitLines(formatActions(actions), MAX_STEP_FILE_PREVIEW_LINES)}`,
    `Proposed: Fix dated/lowercase doc filenames (${actions.length})`,
  );

  const choice = await promptSelect<"yes" | "customize" | "no">(
    `Apply dated/lowercase naming to ${actions.length} doc filename${actions.length === 1 ? "" : "s"}?`,
    [
      { label: "Yes", value: "yes" },
      { label: "Customize", value: "customize" },
      { label: "No", value: "no" },
    ],
    "yes",
  );
  if (choice === null) return null;

  if (choice === "no") return { include: false, renameCaseOverrides: {} };
  if (choice === "yes") return { include: true, renameCaseOverrides: {} };

  const overrides = await collectRenameCaseOverrides(actions, {
    defaultMode: "lowercase",
  });
  if (overrides === null) return null;

  return { include: true, renameCaseOverrides: overrides };
}
