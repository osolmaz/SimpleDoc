import type { ReferenceUpdateAction } from "../../migrator.js";
import { formatActions } from "../../migrator.js";
import {
  limitLines,
  MAX_STEP_FILE_PREVIEW_LINES,
  noteWrapped,
  promptConfirm,
} from "../ui.js";

export async function runReferenceUpdatesStep(
  actions: ReferenceUpdateAction[],
): Promise<boolean | null> {
  if (actions.length === 0) return false;

  noteWrapped(
    `Files referencing renamed docs (will be updated):\n\n${limitLines(formatActions(actions), MAX_STEP_FILE_PREVIEW_LINES)}`,
    `Proposed: Update references to renamed docs (${actions.length})`,
  );
  return await promptConfirm(
    `Update references in ${actions.length} file${actions.length === 1 ? "" : "s"}?`,
    true,
  );
}
