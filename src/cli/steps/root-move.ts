import type { RenameAction, RenameCaseMode } from "../../migrator.js";
import {
  noteWrapped,
  promptSelect,
  limitLines,
  MAX_STEP_FILE_PREVIEW_LINES,
} from "../ui.js";
import { collectRenameCaseOverrides } from "./rename-case-overrides.js";

function formatRenameSources(actions: RenameAction[]): string {
  return actions.map((action) => `- ${action.from}`).join("\n");
}

export function detectRootMoves(renameActions: RenameAction[]): RenameAction[] {
  return renameActions.filter(
    (a) => !a.from.includes("/") && a.to.startsWith("docs/"),
  );
}

export async function runRootMoveStep(actions: RenameAction[]): Promise<{
  include: boolean;
  renameCaseOverrides: Record<string, RenameCaseMode>;
} | null> {
  if (actions.length === 0) return { include: false, renameCaseOverrides: {} };

  noteWrapped(
    `Markdown files detected in the repo root (will be moved into \`docs/\`):\n\n${limitLines(formatRenameSources(actions), MAX_STEP_FILE_PREVIEW_LINES)}`,
    `Proposed: Relocate root Markdown docs into \`docs/\` (${actions.length})`,
  );

  const choice = await promptSelect<"yes" | "customize" | "no">(
    `Move ${actions.length} root Markdown file${actions.length === 1 ? "" : "s"} into \`docs/\`?`,
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
