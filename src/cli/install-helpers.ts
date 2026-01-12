import type { InstallationStatus, InstallAction } from "../installer.js";
import { buildInstallationActions } from "../installer.js";

export type InstallSelection = {
  createAgentsFile: boolean;
  addAttentionLine: boolean;
  addSkill: boolean;
};

export function buildDefaultInstallSelection(
  status: InstallationStatus,
): InstallSelection {
  return {
    createAgentsFile: !status.agentsExists,
    addAttentionLine: status.agentsExists && !status.agentsHasAttentionLine,
    addSkill: !status.skillExists,
  };
}

export async function buildDefaultInstallActions(
  status: InstallationStatus,
): Promise<InstallAction[]> {
  return buildInstallationActions(buildDefaultInstallSelection(status));
}
