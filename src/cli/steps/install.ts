import type { InstallationStatus } from "../../installer.js";
import {
  AGENTS_ATTENTION_LINE,
  AGENTS_FILE,
  HOW_TO_DOC_FILE,
} from "../../installer.js";
import { noteWrapped, promptConfirm } from "../ui.js";

export async function runInstallSteps(status: InstallationStatus): Promise<{
  createAgentsFile: boolean;
  addAttentionLine: boolean;
  addHowToDoc: boolean;
} | null> {
  let createAgentsFile = false;
  let addAttentionLine = false;
  let addHowToDoc = false;

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

  if (!status.howToDocExists) {
    noteWrapped(
      `Will create \`${HOW_TO_DOC_FILE}\` from the bundled SimpleDoc template (won't overwrite if it already exists).`,
      "Proposed: Add docs/HOW_TO_DOC.md",
    );
    const include = await promptConfirm(
      `Create \`${HOW_TO_DOC_FILE}\` template?`,
      true,
    );
    if (include === null) return null;
    addHowToDoc = include;
  }

  return { createAgentsFile, addAttentionLine, addHowToDoc };
}
