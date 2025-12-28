import type { RenameCaseMode, RenameAction } from "../../migrator.js";
import { promptSelect } from "../ui.js";

export async function collectRenameCaseOverrides(
  actions: RenameAction[],
): Promise<Record<string, RenameCaseMode> | null> {
  const overrides: Record<string, RenameCaseMode> = {};
  for (const action of actions) {
    const choice = await promptSelect<RenameCaseMode>(
      `Filename case for ${action.from}`,
      [
        {
          label: "Lowercase",
          value: "lowercase",
          hint: "Uses dashes (kebab-case) + keeps the YYYY-MM-DD prefix",
        },
        {
          label: "Capitalized",
          value: "capitalized",
          hint: "Uses underscores (SNAKE_CASE) + keeps the YYYY-MM-DD prefix",
        },
      ],
      "lowercase",
    );
    if (choice === null) return null;
    overrides[action.from] = choice;
  }
  return overrides;
}
