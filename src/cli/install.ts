import process from "node:process";
import { intro, outro, spinner } from "@clack/prompts";

import {
  applyInstallationActions,
  buildInstallationActions,
  formatInstallActions,
  getInstallationStatus,
} from "../installer.js";
import { createGitClient } from "../git.js";
import type { InstallAction } from "../installer.js";
import {
  formatActions,
  planMigration,
  type FrontmatterAction,
  type ReferenceUpdateAction,
  type RenameAction,
} from "../migrator.js";
import { buildDefaultInstallActions } from "./install-helpers.js";
import { abort, getErrorMessage, hasInteractiveTty } from "./flow.js";
import {
  MAX_STEP_FILE_PREVIEW_LINES,
  createScanProgressBarReporter,
  limitLines,
  noteWrapped,
  promptConfirm,
} from "./ui.js";
import { runMigrate } from "./migrate.js";
import { runInstallSteps } from "./steps/install.js";
import { loadConfig } from "../config.js";

type InstallOptions = {
  dryRun: boolean;
  yes: boolean;
};

function printPreview(actions: InstallAction[]): void {
  process.stdout.write("Planned changes:\n");
  const preview = formatInstallActions(actions).trim();
  if (preview) process.stdout.write(`\n${preview}\n`);
}

type MigrationInfo = {
  renames: RenameAction[];
  frontmatters: FrontmatterAction[];
  references: ReferenceUpdateAction[];
  summaryLines: string[];
  preview: string;
  hasIssues: boolean;
};

function buildMigrationInfo(plan: {
  actions: Array<RenameAction | FrontmatterAction | ReferenceUpdateAction>;
}): MigrationInfo {
  const renames = plan.actions.filter(
    (a): a is RenameAction => a.type === "rename",
  );
  const frontmatters = plan.actions.filter(
    (a): a is FrontmatterAction => a.type === "frontmatter",
  );
  const references = plan.actions.filter(
    (a): a is ReferenceUpdateAction => a.type === "references",
  );

  const summaryLines: string[] = [];
  if (renames.length > 0)
    summaryLines.push(
      `- Rename/move Markdown files: ${renames.length} file${renames.length === 1 ? "" : "s"}`,
    );
  if (frontmatters.length > 0)
    summaryLines.push(
      `- Insert YAML frontmatter: ${frontmatters.length} file${frontmatters.length === 1 ? "" : "s"}`,
    );
  if (references.length > 0)
    summaryLines.push(
      `- Update references to renamed docs: ${references.length} file${references.length === 1 ? "" : "s"}`,
    );

  const previewLines: string[] = [];
  if (renames.length > 0) previewLines.push(formatActions(renames));
  if (frontmatters.length > 0) previewLines.push(formatActions(frontmatters));
  if (references.length > 0) previewLines.push(formatActions(references));
  const preview = previewLines.filter(Boolean).join("\n");

  return {
    renames,
    frontmatters,
    references,
    summaryLines,
    preview,
    hasIssues: renames.length + frontmatters.length + references.length > 0,
  };
}

function printMigrationSummary(info: MigrationInfo, includePreview: boolean) {
  if (!info.hasIssues) return;
  process.stdout.write("SimpleDoc check failed.\n\n");
  if (info.summaryLines.length > 0) {
    process.stdout.write(`${info.summaryLines.join("\n")}\n\n`);
  }
  if (includePreview && info.preview) {
    const limited = limitLines(info.preview, MAX_STEP_FILE_PREVIEW_LINES);
    process.stdout.write(`${limited}\n\n`);
  }
}

export async function runInstall(options: InstallOptions): Promise<void> {
  try {
    const config = await loadConfig(process.cwd());
    const git = createGitClient();
    const repoRootAbs = await git.getRepoRoot(process.cwd());
    const installStatus = await getInstallationStatus(repoRootAbs);

    const hasTty = hasInteractiveTty();
    const scanProgress = createScanProgressBarReporter(hasTty);
    const migrationPlan = await planMigration({
      cwd: repoRootAbs,
      onProgress: scanProgress,
      docsRoot: config.docsRoot,
      ignoreGlobs: config.checkIgnore,
      frontmatterDefaults: config.frontmatterDefaults,
    });
    const migrationInfo = buildMigrationInfo(migrationPlan);

    const installActionsAll = await buildDefaultInstallActions(installStatus);

    if (installActionsAll.length === 0 && !migrationInfo.hasIssues) {
      process.stdout.write("No installation needed.\n");
      return;
    }

    if (options.dryRun) {
      if (installActionsAll.length > 0) printPreview(installActionsAll);
      if (migrationInfo.hasIssues) printMigrationSummary(migrationInfo, true);
      return;
    }

    if (!hasTty && !options.yes) {
      if (installActionsAll.length > 0) printPreview(installActionsAll);
      if (migrationInfo.hasIssues) printMigrationSummary(migrationInfo, true);
      process.stderr.write(
        "\nRefusing to apply changes without a TTY. Re-run with --yes.\n",
      );
      process.exitCode = 2;
      return;
    }

    if (options.yes) {
      if (installActionsAll.length > 0) {
        printPreview(installActionsAll);
        process.stderr.write("Applying changes...\n");
        await applyInstallationActions(repoRootAbs, installActionsAll);
      }
      if (migrationInfo.hasIssues) {
        printMigrationSummary(migrationInfo, false);
        process.stdout.write(
          "Run `npx -y @simpledoc/simpledoc migrate` to fix.\n",
        );
      } else {
        process.stdout.write(
          "Done. Review with `git status` / `git diff` and commit when ready.\n",
        );
      }
      return;
    }

    intro("npx -y @simpledoc/simpledoc install");

    if (installActionsAll.length > 0) {
      const installSel = await runInstallSteps(installStatus);
      if (installSel === null) return abort("Operation cancelled.");

      const selectedInstallActions = await buildInstallationActions(installSel);
      if (selectedInstallActions.length > 0) {
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
      }
    }

    if (migrationInfo.hasIssues) {
      noteWrapped(
        migrationInfo.summaryLines.join("\n"),
        "SimpleDoc check failed",
      );
      if (migrationInfo.preview) {
        const limited = limitLines(
          migrationInfo.preview,
          MAX_STEP_FILE_PREVIEW_LINES,
        );
        process.stdout.write(`${limited}\n\n`);
      }
      const migrateNow = await promptConfirm(
        "Run `npx -y @simpledoc/simpledoc migrate` now?",
        true,
      );
      if (migrateNow === null) return abort("Operation cancelled.");
      if (migrateNow) {
        await runMigrate({
          dryRun: false,
          yes: false,
          force: false,
        });
        return;
      }
    }

    outro("Review with `git status` / `git diff` and commit when ready.");
  } catch (err) {
    process.stderr.write(`${getErrorMessage(err)}\n`);
    process.exitCode = 1;
  }
}
