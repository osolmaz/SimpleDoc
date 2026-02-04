import process from "node:process";
import { intro, outro, spinner } from "@clack/prompts";

import {
  formatActions,
  planMigration,
  runMigrationPlan,
  type FrontmatterAction,
  type MigrationAction,
  type MigrationPlan,
  type ReferenceUpdateAction,
  type RenameAction,
  type RenameCaseMode,
} from "../migrator.js";
import {
  AGENTS_FILE,
  SIMPLEDOC_SKILL_FILE,
  applyInstallationActions,
  buildInstallationActions,
  formatInstallActions,
  getInstallationStatus,
} from "../installer.js";
import type { InstallAction } from "../installer.js";
import { buildDefaultInstallActions } from "./install-helpers.js";
import {
  MAX_STEP_FILE_PREVIEW_LINES,
  createScanProgressBarReporter,
  limitLines,
  noteWrapped,
  promptConfirm,
} from "./ui.js";
import { abort, getErrorMessage, hasInteractiveTty } from "./flow.js";
import {
  detectLowercaseDocRenames,
  runLowercaseNamingStep,
} from "./steps/naming-lowercase.js";
import {
  detectCapitalizedDocRenames,
  runCapitalizedNamingStep,
} from "./steps/naming-capitalized.js";
import { runFrontmatterStep } from "./steps/frontmatter.js";
import { runInstallSteps } from "./steps/install.js";
import { detectRootMoves, runRootMoveStep } from "./steps/root-move.js";
import { runReferenceUpdatesStep } from "./steps/references.js";
import { loadConfig } from "../config.js";

type StepPreview = {
  title: string;
  actionsText: string;
  actionCount: number;
};

type MigrateOptions = {
  dryRun: boolean;
  yes: boolean;
  force: boolean;
  author?: string;
};

function buildDefaultPreviews(opts: {
  plan: MigrationPlan;
  installActions: InstallAction[];
  docsRoot: string;
}): StepPreview[] {
  const renameActionsAll = opts.plan.actions.filter(
    (a): a is RenameAction => a.type === "rename",
  );
  const rootMovesAll = detectRootMoves(renameActionsAll, opts.docsRoot);
  const lowercaseRenamesAll = detectLowercaseDocRenames(
    renameActionsAll,
    opts.docsRoot,
  );
  const categorizedRenames = new Set<string>([
    ...rootMovesAll.map((a) => a.from),
    ...lowercaseRenamesAll.map((a) => a.from),
  ]);
  const capitalizedRenamesAll = detectCapitalizedDocRenames({
    renameActions: renameActionsAll,
    categorizedSources: categorizedRenames,
  });

  const frontmatterAddsAll = opts.plan.actions.filter(
    (a): a is FrontmatterAction => a.type === "frontmatter",
  );
  const referenceUpdatesAll = opts.plan.actions.filter(
    (a): a is ReferenceUpdateAction => a.type === "references",
  );

  const defaultPreviews: StepPreview[] = [];

  if (rootMovesAll.length > 0)
    defaultPreviews.push({
      title: `Relocate root Markdown docs into \`${opts.docsRoot}/\` (SimpleDoc convention)`,
      actionsText: formatActions(rootMovesAll),
      actionCount: rootMovesAll.length,
    });

  if (lowercaseRenamesAll.length > 0)
    defaultPreviews.push({
      title:
        "Fix dated/lowercase doc filenames (adds missing YYYY-MM-DD + normalizes separators)",
      actionsText: formatActions(lowercaseRenamesAll),
      actionCount: lowercaseRenamesAll.length,
    });

  if (capitalizedRenamesAll.length > 0)
    defaultPreviews.push({
      title: "Normalize capitalized/canonical Markdown filenames",
      actionsText: formatActions(capitalizedRenamesAll),
      actionCount: capitalizedRenamesAll.length,
    });

  if (frontmatterAddsAll.length > 0)
    defaultPreviews.push({
      title:
        "Insert missing YAML frontmatter (title/author/date) into date-prefixed docs",
      actionsText: formatActions(frontmatterAddsAll),
      actionCount: frontmatterAddsAll.length,
    });

  if (referenceUpdatesAll.length > 0)
    defaultPreviews.push({
      title: "Update references to renamed doc filenames",
      actionsText: formatActions(referenceUpdatesAll),
      actionCount: referenceUpdatesAll.length,
    });

  if (opts.installActions.length > 0) {
    const createAgents = opts.installActions.filter(
      (a) => a.type === "write-file" && a.path === AGENTS_FILE,
    );
    if (createAgents.length > 0)
      defaultPreviews.push({
        title: `Create \`${AGENTS_FILE}\``,
        actionsText: formatInstallActions(createAgents),
        actionCount: createAgents.length,
      });

    const addLine = opts.installActions.filter(
      (a) => a.type === "append-line" && a.path === AGENTS_FILE,
    );
    if (addLine.length > 0)
      defaultPreviews.push({
        title: `Add SimpleDoc agent reminder line to \`${AGENTS_FILE}\``,
        actionsText: formatInstallActions(addLine),
        actionCount: addLine.length,
      });

    const skillTemplate = opts.installActions.filter(
      (a) => a.type === "write-file" && a.path === SIMPLEDOC_SKILL_FILE,
    );
    if (skillTemplate.length > 0)
      defaultPreviews.push({
        title: `Create \`${SIMPLEDOC_SKILL_FILE}\` template`,
        actionsText: formatInstallActions(skillTemplate),
        actionCount: skillTemplate.length,
      });
  }

  return defaultPreviews;
}

function printPreviews(previews: StepPreview[]): void {
  process.stdout.write("Planned changes:\n");
  for (const [idx, step] of previews.entries()) {
    const stepNo = idx + 1;
    process.stdout.write(
      `\nStep ${stepNo}: ${step.title} (${step.actionCount})\n`,
    );
    const preview = step.actionsText.trim();
    if (preview)
      process.stdout.write(
        `${limitLines(preview, MAX_STEP_FILE_PREVIEW_LINES)}\n`,
      );
  }
}

export async function runMigrate(options: MigrateOptions): Promise<void> {
  try {
    const config = await loadConfig(process.cwd());
    process.stderr.write(
      "Planning changes (this may take a while on large repos)...\n",
    );
    const hasTty = hasInteractiveTty();
    const scanProgress = createScanProgressBarReporter(hasTty);
    const planAll = await planMigration({
      onProgress: scanProgress,
      docsRoot: config.docsRoot,
      ignoreGlobs: config.checkIgnore,
      frontmatterDefaults: config.frontmatterDefaults,
    });
    const installStatus = await getInstallationStatus(planAll.repoRootAbs);

    const installActionsAll = await buildDefaultInstallActions(installStatus);
    const interactiveWizard = hasTty && !options.yes && !options.dryRun;

    if (planAll.dirty && !options.force) {
      if (options.dryRun) {
        process.stderr.write(
          "Warning: working tree is dirty (use --force to apply).\n\n",
        );
      } else if (options.yes) {
        process.stderr.write(
          "Refusing to apply changes on a dirty working tree without --force.\n",
        );
        process.exitCode = 2;
        return;
      }
    }

    const defaultPreviews = buildDefaultPreviews({
      plan: planAll,
      installActions: installActionsAll,
      docsRoot: config.docsRoot,
    });

    if (defaultPreviews.length === 0) {
      process.stdout.write("No installation or migration needed.\n");
      return;
    }

    if (options.dryRun) {
      printPreviews(defaultPreviews);
      return;
    }

    if (!hasTty && !options.yes) {
      printPreviews(defaultPreviews);
      process.stderr.write(
        "\nRefusing to apply changes without a TTY. Re-run with --yes.\n",
      );
      process.exitCode = 2;
      return;
    }

    if (options.yes) {
      printPreviews(defaultPreviews);
      process.stderr.write(
        "Applying changes (this may take a while on large repos)...\n",
      );
      await runMigrationPlan(planAll, {
        authorOverride: options.author ?? null,
        authorRewrites: null,
      });
      await applyInstallationActions(planAll.repoRootAbs, installActionsAll);
      process.stdout.write(
        "Done. Review with `git status` / `git diff` and commit when ready.\n",
      );
      return;
    }

    if (!interactiveWizard) {
      printPreviews(defaultPreviews);
      process.stdout.write("Re-run with --yes to apply.\n");
      process.exitCode = 2;
      return;
    }

    intro("npx -y @simpledoc/simpledoc migrate");

    if (planAll.dirty && !options.force) {
      const contDirty = await promptConfirm(
        "Working tree is dirty. Continue anyway?",
        false,
      );
      if (contDirty === null) return abort("Operation cancelled.");
      if (!contDirty) return abort();
    }

    const renameActionsAll = planAll.actions.filter(
      (a): a is RenameAction => a.type === "rename",
    );

    const rootMovesAll = detectRootMoves(renameActionsAll, config.docsRoot);
    const lowercaseRenamesAll = detectLowercaseDocRenames(
      renameActionsAll,
      config.docsRoot,
    );
    const categorizedRenames = new Set<string>([
      ...rootMovesAll.map((a) => a.from),
      ...lowercaseRenamesAll.map((a) => a.from),
    ]);
    const capitalizedRenamesAll = detectCapitalizedDocRenames({
      renameActions: renameActionsAll,
      categorizedSources: categorizedRenames,
    });

    const renameCaseOverrides: Record<string, RenameCaseMode> = {};

    const rootMoveSel = await runRootMoveStep(rootMovesAll, config.docsRoot);
    if (rootMoveSel === null) return abort("Operation cancelled.");
    const includeRootMoves = rootMoveSel.include;
    Object.assign(renameCaseOverrides, rootMoveSel.renameCaseOverrides);

    const lowercaseSel = await runLowercaseNamingStep(lowercaseRenamesAll);
    if (lowercaseSel === null) return abort("Operation cancelled.");
    const includeLowercaseRenames = lowercaseSel.include;
    Object.assign(renameCaseOverrides, lowercaseSel.renameCaseOverrides);

    const forceUndatedPaths: string[] = [];
    for (const [filePath, mode] of Object.entries(
      lowercaseSel.renameCaseOverrides,
    )) {
      if (mode === "capitalized") forceUndatedPaths.push(filePath);
    }

    const capitalizedSel = await runCapitalizedNamingStep(
      capitalizedRenamesAll,
    );
    if (capitalizedSel === null) return abort("Operation cancelled.");
    const includeCapitalizedRenames = capitalizedSel.include;
    Object.assign(renameCaseOverrides, capitalizedSel.renameCaseOverrides);

    const forceDatePrefixPaths: string[] = [];
    for (const [filePath, mode] of Object.entries(
      capitalizedSel.renameCaseOverrides,
    )) {
      if (mode === "lowercase") forceDatePrefixPaths.push(filePath);
    }

    const needsReplan =
      (rootMovesAll.length > 0 && !includeRootMoves) ||
      (lowercaseRenamesAll.length > 0 && !includeLowercaseRenames) ||
      (capitalizedRenamesAll.length > 0 && !includeCapitalizedRenames) ||
      Object.keys(renameCaseOverrides).length > 0;

    let planWithFrontmatter = planAll;
    if (needsReplan) {
      process.stderr.write(
        "Recomputing plan (this may take a while on large repos)...\n",
      );
      planWithFrontmatter = await planMigration({
        moveRootMarkdownToDocs: Boolean(includeRootMoves),
        renameDocsToDatePrefix: Boolean(includeLowercaseRenames),
        normalizeDatePrefixedDocs: Boolean(includeLowercaseRenames),
        addFrontmatter: true,
        renameCaseOverrides,
        forceDatePrefixPaths,
        forceUndatedPaths,
        includeCanonicalRenames: Boolean(includeCapitalizedRenames),
        docsRoot: config.docsRoot,
        ignoreGlobs: config.checkIgnore,
        frontmatterDefaults: config.frontmatterDefaults,
      });
    }

    const frontmatterAdds = planWithFrontmatter.actions.filter(
      (a): a is FrontmatterAction => a.type === "frontmatter",
    );
    const referenceUpdates = planWithFrontmatter.actions.filter(
      (a): a is ReferenceUpdateAction => a.type === "references",
    );

    const frontmatterSel = await runFrontmatterStep({
      actions: frontmatterAdds,
      authorFlag: options.author,
    });
    if (frontmatterSel === null) return abort("Operation cancelled.");
    const includeFrontmatter = frontmatterSel.include;

    const includeReferenceUpdates =
      await runReferenceUpdatesStep(referenceUpdates);
    if (includeReferenceUpdates === null) return abort("Operation cancelled.");

    const installSel = await runInstallSteps(installStatus);
    if (installSel === null) return abort("Operation cancelled.");

    const selectedInstallActions = await buildInstallationActions(installSel);

    let selectedMigrationActions: MigrationAction[] =
      planWithFrontmatter.actions.filter(
        (a) => includeFrontmatter || a.type !== "frontmatter",
      );
    if (!includeReferenceUpdates) {
      selectedMigrationActions = selectedMigrationActions.filter(
        (a) => a.type !== "references",
      );
    }

    const summaryLines: string[] = [];
    const renameCount = selectedMigrationActions.filter(
      (a) => a.type === "rename",
    ).length;
    const frontmatterCount = selectedMigrationActions.filter(
      (a) => a.type === "frontmatter",
    ).length;
    const referenceCount = selectedMigrationActions.filter(
      (a) => a.type === "references",
    ).length;

    if (renameCount > 0)
      summaryLines.push(
        `- Rename/move Markdown files: ${renameCount} file${renameCount === 1 ? "" : "s"}`,
      );
    if (frontmatterCount > 0)
      summaryLines.push(
        `- Insert YAML frontmatter: ${frontmatterCount} file${frontmatterCount === 1 ? "" : "s"}`,
      );
    if (referenceCount > 0)
      summaryLines.push(
        `- Update references to renamed docs: ${referenceCount} file${referenceCount === 1 ? "" : "s"}`,
      );

    for (const action of selectedInstallActions) {
      if (action.type === "write-file" && action.path === AGENTS_FILE) {
        summaryLines.push(`- Create \`${AGENTS_FILE}\``);
        continue;
      }
      if (action.type === "append-line" && action.path === AGENTS_FILE) {
        summaryLines.push(`- Update \`${AGENTS_FILE}\` (add reminder line)`);
        continue;
      }
      if (
        action.type === "write-file" &&
        action.path === SIMPLEDOC_SKILL_FILE
      ) {
        summaryLines.push(`- Create \`${SIMPLEDOC_SKILL_FILE}\``);
        continue;
      }
    }

    const totalFiles = new Set<string>();
    for (const action of selectedMigrationActions) {
      if (action.type === "rename") totalFiles.add(action.to);
      else if (action.type === "frontmatter") totalFiles.add(action.path);
      else if (action.type === "references") totalFiles.add(action.path);
    }
    for (const action of selectedInstallActions) totalFiles.add(action.path);
    summaryLines.push(
      `- Total files affected: ${totalFiles.size} file${totalFiles.size === 1 ? "" : "s"}`,
    );

    noteWrapped(summaryLines.join("\n"), "Summary of selected changes");

    const apply = await promptConfirm("Apply these changes now?", true);
    if (apply === null) return abort("Operation cancelled.");
    if (!apply) return abort();

    const s = spinner();
    s.start("Applying changes (this may take a while on large repos)...");
    await runMigrationPlan(
      { ...planWithFrontmatter, actions: selectedMigrationActions },
      {
        authorOverride: options.author ?? null,
        authorRewrites: frontmatterSel.authorRewrites,
      },
    );
    await applyInstallationActions(planAll.repoRootAbs, selectedInstallActions);
    s.stop("Done.");
    outro("Review with `git status` / `git diff` and commit when ready.");
  } catch (err) {
    process.stderr.write(`${getErrorMessage(err)}\n`);
    process.exitCode = 1;
  }
}
