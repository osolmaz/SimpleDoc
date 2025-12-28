import path from "node:path";
import type { RenameAction } from "../../migrator.js";
import { extractDatePrefix } from "../../naming.js";
import {
  limitLines,
  MAX_STEP_FILE_PREVIEW_LINES,
  noteWrapped,
  promptConfirm,
} from "../ui.js";
import { formatActions } from "../../migrator.js";

function isDatePrefixNormalizationRename(action: RenameAction): boolean {
  if (!action.from.startsWith("docs/") || !action.to.startsWith("docs/"))
    return false;
  const fromBase = path.posix.basename(action.from);
  const toBase = path.posix.basename(action.to);
  const fromDate = extractDatePrefix(fromBase);
  const toDate = extractDatePrefix(toBase);
  if (!fromDate || !toDate) return false;
  if (fromDate !== toDate) return false;
  return fromBase !== toBase;
}

export function detectDatePrefixNormalizations(
  renameActions: RenameAction[],
): RenameAction[] {
  return renameActions.filter((a) => isDatePrefixNormalizationRename(a));
}

export async function runDatePrefixNormalizeStep(
  actions: RenameAction[],
): Promise<boolean | null> {
  if (actions.length === 0) return false;

  noteWrapped(
    `Date-prefixed docs detected with non-standard separators (will be normalized):\n\n${limitLines(formatActions(actions), MAX_STEP_FILE_PREVIEW_LINES)}`,
    `Proposed: Normalize date-prefixed filenames (${actions.length})`,
  );

  const include = await promptConfirm(
    `Normalize ${actions.length} date-prefixed filename${actions.length === 1 ? "" : "s"} to SimpleDoc naming?`,
    true,
  );
  return include;
}
