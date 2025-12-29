import type { RenameAction, RenameCaseMode } from "../../migrator.js";
import { formatActions } from "../../migrator.js";
import {
  limitLines,
  MAX_STEP_FILE_PREVIEW_LINES,
  noteWrapped,
  promptSelect,
} from "../ui.js";
import { collectRenameCaseOverrides } from "./rename-case-overrides.js";

export function detectCapitalizedDocRenames(opts: {
  renameActions: RenameAction[];
  categorizedSources: Set<string>;
}): RenameAction[] {
  return opts.renameActions.filter((a) => !opts.categorizedSources.has(a.from));
}

export async function runCapitalizedNamingStep(
  actions: RenameAction[],
): Promise<{
  include: boolean;
  renameCaseOverrides: Record<string, RenameCaseMode>;
} | null> {
  if (actions.length === 0) return { include: false, renameCaseOverrides: {} };

  noteWrapped(
    `Capitalized/canonical Markdown filenames detected (will be normalized with underscores, no date prefix):\n\n${limitLines(formatActions(actions), MAX_STEP_FILE_PREVIEW_LINES)}`,
    `Proposed: Fix capitalized/canonical doc filenames (${actions.length})`,
  );

  const choice = await promptSelect<"yes" | "customize" | "no">(
    `Apply capitalized/canonical naming to ${actions.length} filename${actions.length === 1 ? "" : "s"}?`,
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
    defaultMode: "capitalized",
  });
  if (overrides === null) return null;

  return { include: true, renameCaseOverrides: overrides };
}
