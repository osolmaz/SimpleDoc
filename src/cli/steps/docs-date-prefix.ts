import path from "node:path";
import type { RenameAction, RenameCaseMode } from "../../migrator.js";
import { extractDatePrefix } from "../../naming.js";
import {
  limitLines,
  MAX_STEP_FILE_PREVIEW_LINES,
  noteWrapped,
  promptSelect,
} from "../ui.js";
import { collectRenameCaseOverrides } from "./rename-case-overrides.js";

function formatRenameSources(actions: RenameAction[]): string {
  return actions.map((action) => `- ${action.from}`).join("\n");
}

function hasDatePrefix(baseName: string): boolean {
  return extractDatePrefix(baseName) !== null;
}

export function detectDocsDatePrefixRenames(
  renameActions: RenameAction[],
): RenameAction[] {
  return renameActions.filter(
    (a) =>
      a.from.startsWith("docs/") &&
      a.to.startsWith("docs/") &&
      hasDatePrefix(path.posix.basename(a.to)) &&
      !hasDatePrefix(path.posix.basename(a.from)),
  );
}

export async function runDocsDatePrefixStep(actions: RenameAction[]): Promise<{
  include: boolean;
  renameCaseOverrides: Record<string, RenameCaseMode>;
} | null> {
  if (actions.length === 0) return { include: false, renameCaseOverrides: {} };

  noteWrapped(
    `Markdown files detected under \`docs/\` that should be date-prefixed (will be renamed to lowercase \`YYYY-MM-DD-…\`):\n\n${limitLines(formatRenameSources(actions), MAX_STEP_FILE_PREVIEW_LINES)}`,
    `Proposed: Date-prefix \`docs/\` Markdown filenames (${actions.length})`,
  );

  const choice = await promptSelect<"yes" | "customize" | "no">(
    `Date-prefix ${actions.length} \`docs/\` Markdown file${actions.length === 1 ? "" : "s"}?`,
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

  const overrides = await collectRenameCaseOverrides(actions);
  if (overrides === null) return null;
  return { include: true, renameCaseOverrides: overrides };
}
