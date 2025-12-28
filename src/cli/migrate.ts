import process from "node:process";
import { cancel, intro, outro, spinner } from "@clack/prompts";

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
  HOW_TO_DOC_FILE,
  applyInstallationActions,
  buildInstallationActions,
  formatInstallActions,
  getInstallationStatus,
} from "../installer.js";
import type { InstallAction } from "../installer.js";
import {
  MAX_STEP_FILE_PREVIEW_LINES,
  limitLines,
  noteWrapped,
  promptConfirm,
} from "./ui.js";
import {
  detectDocsDatePrefixRenames,
  runDocsDatePrefixStep,
} from "./steps/docs-date-prefix.js";
import { runCanonicalStep, detectCanonicalRenames } from "./steps/canonical.js";
import {
  detectDatePrefixNormalizations,
  runDatePrefixNormalizeStep,
} from "./steps/date-normalize.js";
import { runFrontmatterStep } from "./steps/frontmatter.js";
import { runInstallSteps } from "./steps/install.js";
import { detectRootMoves, runRootMoveStep } from "./steps/root-move.js";
import { runReferenceUpdatesStep } from "./steps/references.js";

type StepPreview = {
  id: string;
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

function abort(message = "Aborted."): void {
  cancel(message);
  process.exitCode = 1;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function buildDefaultPreviews(opts: {
  plan: MigrationPlan;
  installActions: InstallAction[];
}): StepPreview[] {
  const renameActionsAll = opts.plan.actions.filter(
    (a): a is RenameAction => a.type === "rename",
  );
  const rootMovesAll = detectRootMoves(renameActionsAll);
  const docsRenamesAll = detectDocsDatePrefixRenames(renameActionsAll);
  const datePrefixNormalizationsAll =
    detectDatePrefixNormalizations(renameActionsAll);
  const categorizedRenames = new Set<string>([
    ...rootMovesAll.map((a) => a.from),
    ...docsRenamesAll.map((a) => a.from),
    ...datePrefixNormalizationsAll.map((a) => a.from),
  ]);
  const canonicalRenamesAll = detectCanonicalRenames({
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
      id: "migrate-root-move",
      title: "Relocate root Markdown docs into `docs/` (SimpleDoc convention)",
      actionsText: formatActions(rootMovesAll),
      actionCount: rootMovesAll.length,
    });

  if (docsRenamesAll.length > 0)
    defaultPreviews.push({
      id: "migrate-docs-date-prefix",
      title:
        "Date-prefix `docs/` Markdown files to `YYYY-MM-DD-…` using first git commit date",
      actionsText: formatActions(docsRenamesAll),
      actionCount: docsRenamesAll.length,
    });

  if (datePrefixNormalizationsAll.length > 0)
    defaultPreviews.push({
      id: "migrate-docs-date-normalize",
      title: "Normalize date-prefixed `docs/` filenames to SimpleDoc naming",
      actionsText: formatActions(datePrefixNormalizationsAll),
      actionCount: datePrefixNormalizationsAll.length,
    });

  if (canonicalRenamesAll.length > 0)
    defaultPreviews.push({
      id: "migrate-canonical-capitalization",
      title: "Normalize capitalized/canonical Markdown filenames",
      actionsText: formatActions(canonicalRenamesAll),
      actionCount: canonicalRenamesAll.length,
    });

  if (frontmatterAddsAll.length > 0)
    defaultPreviews.push({
      id: "migrate-frontmatter",
      title:
        "Insert missing YAML frontmatter (title/author/date) into date-prefixed docs",
      actionsText: formatActions(frontmatterAddsAll),
      actionCount: frontmatterAddsAll.length,
    });

  if (referenceUpdatesAll.length > 0)
    defaultPreviews.push({
      id: "migrate-references",
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
        id: "install-create-agents",
        title: `Create \`${AGENTS_FILE}\``,
        actionsText: formatInstallActions(createAgents),
        actionCount: createAgents.length,
      });

    const addLine = opts.installActions.filter(
      (a) => a.type === "append-line" && a.path === AGENTS_FILE,
    );
    if (addLine.length > 0)
      defaultPreviews.push({
        id: "install-add-attention-line",
        title: `Add SimpleDoc agent reminder line to \`${AGENTS_FILE}\``,
        actionsText: formatInstallActions(addLine),
        actionCount: addLine.length,
      });

    const howToDoc = opts.installActions.filter(
      (a) => a.type === "write-file" && a.path === HOW_TO_DOC_FILE,
    );
    if (howToDoc.length > 0)
      defaultPreviews.push({
        id: "install-how-to-doc",
        title: `Create \`${HOW_TO_DOC_FILE}\` template`,
        actionsText: formatInstallActions(howToDoc),
        actionCount: howToDoc.length,
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
    process.stderr.write(
      "Planning changes (this may take a while on large repos)...\n",
    );
    const planAll = await planMigration();
    const installStatus = await getInstallationStatus(planAll.repoRootAbs);

    const installActionsAll = await buildInstallationActions({
      createAgentsFile: !installStatus.agentsExists,
      addAttentionLine:
        installStatus.agentsExists && !installStatus.agentsHasAttentionLine,
      addHowToDoc: !installStatus.howToDocExists,
    });

    const hasTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
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

    intro("simpledoc migrate");

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

    const rootMovesAll = detectRootMoves(renameActionsAll);
    const docsRenamesAll = detectDocsDatePrefixRenames(renameActionsAll);
    const datePrefixNormalizationsAll =
      detectDatePrefixNormalizations(renameActionsAll);
    const categorizedRenames = new Set<string>([
      ...rootMovesAll.map((a) => a.from),
      ...docsRenamesAll.map((a) => a.from),
      ...datePrefixNormalizationsAll.map((a) => a.from),
    ]);
    const canonicalRenamesAll = detectCanonicalRenames({
      renameActions: renameActionsAll,
      categorizedSources: categorizedRenames,
    });

    const renameCaseOverrides: Record<string, RenameCaseMode> = {};

    const rootMoveSel = await runRootMoveStep(rootMovesAll);
    if (rootMoveSel === null) return abort("Operation cancelled.");
    const includeRootMoves = rootMoveSel.include;
    Object.assign(renameCaseOverrides, rootMoveSel.renameCaseOverrides);

    const docsDatePrefixSel = await runDocsDatePrefixStep(docsRenamesAll);
    if (docsDatePrefixSel === null) return abort("Operation cancelled.");
    const includeDocsRenames = docsDatePrefixSel.include;
    Object.assign(renameCaseOverrides, docsDatePrefixSel.renameCaseOverrides);

    const includeDatePrefixNormalization = await runDatePrefixNormalizeStep(
      datePrefixNormalizationsAll,
    );
    if (includeDatePrefixNormalization === null)
      return abort("Operation cancelled.");

    const includeCanonicalRenames = await runCanonicalStep(canonicalRenamesAll);
    if (includeCanonicalRenames === null) return abort("Operation cancelled.");

    const needsReplan =
      (rootMovesAll.length > 0 && !includeRootMoves) ||
      (docsRenamesAll.length > 0 && !includeDocsRenames) ||
      includeDatePrefixNormalization === false ||
      includeCanonicalRenames === false ||
      Object.keys(renameCaseOverrides).length > 0;

    let planWithFrontmatter = planAll;
    if (needsReplan) {
      process.stderr.write(
        "Recomputing plan (this may take a while on large repos)...\n",
      );
      planWithFrontmatter = await planMigration({
        moveRootMarkdownToDocs: Boolean(includeRootMoves),
        renameDocsToDatePrefix: Boolean(includeDocsRenames),
        addFrontmatter: true,
        renameCaseOverrides,
        includeCanonicalRenames,
        normalizeDatePrefixedDocs: includeDatePrefixNormalization,
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
      if (action.type === "write-file" && action.path === HOW_TO_DOC_FILE) {
        summaryLines.push(`- Create \`${HOW_TO_DOC_FILE}\``);
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
