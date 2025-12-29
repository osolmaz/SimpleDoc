import type { RenameCaseMode, RenameAction } from "../../migrator.js";
import { promptSelect } from "../ui.js";

export type CollectRenameCaseOverridesOptions = {
  defaultMode: RenameCaseMode;
};

export async function collectRenameCaseOverrides(
  actions: RenameAction[],
  options: CollectRenameCaseOverridesOptions,
): Promise<Record<string, RenameCaseMode> | null> {
  const overrides: Record<string, RenameCaseMode> = {};
  for (const action of actions) {
    const choice = await promptSelect<RenameCaseMode>(
      `Filename case for ${action.from}`,
      [
        {
          label: "Lowercase",
          value: "lowercase",
          hint: "Uses dashes (kebab-case)",
        },
        {
          label: "Capitalized",
          value: "capitalized",
          hint: "Uses underscores (SNAKE_CASE)",
        },
      ],
      options.defaultMode,
    );
    if (choice === null) return null;
    overrides[action.from] = choice;
  }
  return overrides;
}
