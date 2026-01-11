import process from "node:process";
import { cancel, intro, outro, spinner } from "@clack/prompts";

import {
  applyInstallationActions,
  buildInstallationActions,
  formatInstallActions,
  getInstallationStatus,
} from "../installer.js";
import { createGitClient } from "../git.js";
import type { InstallAction } from "../installer.js";
import { noteWrapped, promptConfirm } from "./ui.js";
import { runInstallSteps } from "./steps/install.js";

type InstallOptions = {
  dryRun: boolean;
  yes: boolean;
};

function abort(message = "Aborted."): void {
  cancel(message);
  process.exitCode = 1;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function printPreview(actions: InstallAction[]): void {
  process.stdout.write("Planned changes:\n");
  const preview = formatInstallActions(actions).trim();
  if (preview) process.stdout.write(`\n${preview}\n`);
}

export async function runInstall(options: InstallOptions): Promise<void> {
  try {
    const git = createGitClient();
    const repoRootAbs = await git.getRepoRoot(process.cwd());
    const installStatus = await getInstallationStatus(repoRootAbs);

    const installActionsAll = await buildInstallationActions({
      createAgentsFile: !installStatus.agentsExists,
      addAttentionLine:
        installStatus.agentsExists && !installStatus.agentsHasAttentionLine,
      addSkill: !installStatus.skillExists,
    });

    if (installActionsAll.length === 0) {
      process.stdout.write("No installation needed.\n");
      return;
    }

    const hasTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);

    if (options.dryRun) {
      printPreview(installActionsAll);
      return;
    }

    if (!hasTty && !options.yes) {
      printPreview(installActionsAll);
      process.stderr.write(
        "\nRefusing to apply changes without a TTY. Re-run with --yes.\n",
      );
      process.exitCode = 2;
      return;
    }

    if (options.yes) {
      printPreview(installActionsAll);
      process.stderr.write("Applying changes...\n");
      await applyInstallationActions(repoRootAbs, installActionsAll);
      process.stdout.write(
        "Done. Review with `git status` / `git diff` and commit when ready.\n",
      );
      return;
    }

    intro("simpledoc install");

    const installSel = await runInstallSteps(installStatus);
    if (installSel === null) return abort("Operation cancelled.");

    const selectedInstallActions = await buildInstallationActions(installSel);
    if (selectedInstallActions.length === 0) {
      outro("Nothing selected.");
      return;
    }

    noteWrapped(
      formatInstallActions(selectedInstallActions),
      "Summary of selected changes",
    );

    const apply = await promptConfirm("Apply these changes now?", true);
    if (apply === null) return abort("Operation cancelled.");
    if (!apply) return abort();

    const s = spinner();
    s.start("Applying changes...");
    await applyInstallationActions(repoRootAbs, selectedInstallActions);
    s.stop("Done.");
    outro("Review with `git status` / `git diff` and commit when ready.");
  } catch (err) {
    process.stderr.write(`${getErrorMessage(err)}\n`);
    process.exitCode = 1;
  }
}
