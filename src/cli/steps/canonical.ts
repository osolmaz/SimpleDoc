import type { RenameAction } from "../../migrator.js";
import { formatActions } from "../../migrator.js";
import {
  limitLines,
  MAX_STEP_FILE_PREVIEW_LINES,
  noteWrapped,
  promptConfirm,
} from "../ui.js";

export function detectCanonicalRenames(opts: {
  renameActions: RenameAction[];
  categorizedSources: Set<string>;
}): RenameAction[] {
  return opts.renameActions.filter((a) => !opts.categorizedSources.has(a.from));
}

export async function runCanonicalStep(
  actions: RenameAction[],
): Promise<boolean | null> {
  if (actions.length === 0) return false;

  noteWrapped(
    `Capitalized/canonical Markdown filenames detected (will be normalized with underscores, no date prefix):\n\n${limitLines(formatActions(actions), MAX_STEP_FILE_PREVIEW_LINES)}`,
    `Proposed: Normalize capitalized/canonical filenames (${actions.length})`,
  );

  return await promptConfirm(
    `Normalize ${actions.length} capitalized/canonical filename${actions.length === 1 ? "" : "s"} (underscores, no date prefix)?`,
    true,
  );
}
