import type { InstallationStatus } from "../../installer.js";
import {
  AGENTS_ATTENTION_LINE,
  AGENTS_FILE,
  SIMPLEDOC_SKILL_FILE,
} from "../../installer.js";
import type { InstallSelection } from "../install-helpers.js";
import { noteWrapped, promptConfirm } from "../ui.js";

export async function runInstallSteps(
  status: InstallationStatus,
): Promise<InstallSelection | null> {
  let createAgentsFile = false;
  let addAttentionLine = false;
  let addSkill = false;

  if (!status.agentsExists) {
    noteWrapped(
      AGENTS_ATTENTION_LINE,
      `Proposed: Create \`${AGENTS_FILE}\` (includes the reminder line)`,
    );
    const include = await promptConfirm(`Create \`${AGENTS_FILE}\`?`, true);
    if (include === null) return null;
    createAgentsFile = include;
  } else if (!status.agentsHasAttentionLine) {
    noteWrapped(
      AGENTS_ATTENTION_LINE,
      `Proposed: Add the reminder line to \`${AGENTS_FILE}\``,
    );
    const include = await promptConfirm(
      `Add this reminder line to \`${AGENTS_FILE}\`?`,
      true,
    );
    if (include === null) return null;
    addAttentionLine = include;
  }

  noteWrapped(
    `Will create \`${SIMPLEDOC_SKILL_FILE}\` from the bundled SimpleDoc skill (won't overwrite if it already exists).`,
    "Proposed: Add skills/simpledoc/SKILL.md",
  );
  const include = await promptConfirm(
    `Create \`${SIMPLEDOC_SKILL_FILE}\` template?`,
    !status.skillExists,
  );
  if (include === null) return null;
  addSkill = include;

  return { createAgentsFile, addAttentionLine, addSkill };
}
