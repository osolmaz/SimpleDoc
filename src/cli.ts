import path from "node:path";
import process from "node:process";
import { Command, CommanderError } from "commander";
import {
  cancel,
  confirm,
  intro,
  isCancel,
  note,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts";
import { formatActions, planMigration, runMigrationPlan } from "./migrator.js";
import {
  AGENTS_ATTENTION_LINE,
  AGENTS_FILE,
  HOW_TO_DOC_FILE,
  applyInstallationActions,
  buildInstallationActions,
  formatInstallActions,
  getInstallationStatus,
} from "./installer.js";
import type { Option } from "@clack/prompts";
import type {
  FrontmatterAction,
  ReferenceUpdateAction,
  RenameAction,
  RenameCaseMode,
} from "./migrator.js";

function abort(message = "Aborted."): void {
  cancel(message);
  process.exitCode = 1;
}

function limitLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return `${lines.slice(0, maxLines).join("\n")}\n- …and ${lines.length - maxLines} more`;
}

const MAX_STEP_FILE_PREVIEW_LINES = 20;

function formatRenameSources(actions: RenameAction[]): string {
  return actions.map((action) => `- ${action.from}`).join("\n");
}

function hasDatePrefix(baseName: string): boolean {
  return extractDatePrefix(baseName) !== null;
}

function extractDatePrefix(baseName: string): string | null {
  const name = baseName.replace(/\.(md|mdx)$/i, "");
  const match = name.match(/^(\d{4}-\d{2}-\d{2})(?:$|[-_\s])/);
  return match ? match[1] : null;
}

function isDatePrefixNormalizationRename(action: RenameAction): boolean {
  if (!action.from.startsWith("docs/") || !action.to.startsWith("docs/"))
    return false;
  const fromBase = path.posix.basename(action.from);
  const toBase = path.posix.basename(action.to);
  const fromDate = extractDatePrefix(fromBase);
  const toDate = extractDatePrefix(toBase);
  if (!fromDate || !toDate) return false;
  if (fromDate !== toDate) return false;
  return fromBase !== toBase;
}

function wrapLineWithIndent(
  line: string,
  width: number,
): { lines: string[]; maxLineLength: number } {
  const bulletMatch = line.match(/^(\s*[-*]\s+)/);
  const firstPrefix = bulletMatch?.[1] ?? "";
  const restPrefix = firstPrefix ? " ".repeat(firstPrefix.length) : "";
  const content = firstPrefix ? line.slice(firstPrefix.length) : line;
  const available = Math.max(10, width - firstPrefix.length);

  const words = content.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (!current) return;
    out.push(current);
    current = "";
  };

  const pushLongWord = (word: string) => {
    for (let i = 0; i < word.length; i += available) {
      out.push(word.slice(i, i + available));
    }
  };

  for (const word of words) {
    if (!current) {
      if (word.length > available) {
        pushLongWord(word);
        continue;
      }
      current = word;
      continue;
    }

    if (current.length + 1 + word.length <= available) {
      current = `${current} ${word}`;
      continue;
    }

    pushCurrent();
    if (word.length > available) {
      pushLongWord(word);
      continue;
    }
    current = word;
  }
  pushCurrent();

  if (out.length === 0) out.push("");

  const rendered = out.map((l, idx) =>
    idx === 0 ? `${firstPrefix}${l}` : `${restPrefix}${l}`,
  );
  const maxLineLength = rendered.reduce((max, l) => Math.max(max, l.length), 0);
  return { lines: rendered, maxLineLength };
}

function wrapForNote(message: string, title?: string): string {
  const cols = process.stdout.columns ?? 80;
  const slack = 10;
  const maxMessageWidth = Math.max(40, cols - slack);

  const titleLen = title ? title.length + 6 : 0;
  const width = Math.min(maxMessageWidth, Math.max(40, cols - slack, titleLen));

  const lines = message.split(/\r?\n/);
  const wrapped: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") {
      wrapped.push("");
      continue;
    }
    wrapped.push(...wrapLineWithIndent(line, width).lines);
  }
  return wrapped.join("\n");
}

function noteWrapped(message: string, title?: string): void {
  note(wrapForNote(message, title), title);
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function getAuthorStats(
  actions: FrontmatterAction[],
): Array<[author: string, count: number]> {
  const counts = new Map<string, number>();
  for (const action of actions)
    counts.set(action.author, (counts.get(action.author) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) =>
    b[1] - a[1] ? b[1] - a[1] : a[0].localeCompare(b[0]),
  );
}

function summarizeAuthors(
  authorStats: Array<[author: string, count: number]>,
  maxAuthors: number,
): string {
  const lines: string[] = authorStats
    .slice(0, maxAuthors)
    .map(
      ([author, count]) =>
        `- ${author} (${count} file${count === 1 ? "" : "s"})`,
    );
  if (authorStats.length > maxAuthors)
    lines.push(`- …and ${authorStats.length - maxAuthors} more`);
  return lines.join("\n");
}

type StepPreview = {
  id: string;
  title: string;
  actionsText: string;
  actionCount: number;
};

async function promptConfirm(
  message: string,
  initialValue: boolean,
): Promise<boolean | null> {
  const value = await confirm({ message, initialValue });
  if (isCancel(value)) return null;
  return value;
}

async function promptText(
  message: string,
  defaultValue: string,
): Promise<string | null> {
  const value = await text({
    message,
    placeholder: defaultValue,
    defaultValue,
  });
  if (isCancel(value)) return null;
  return value.trim() || defaultValue;
}

async function promptSelect<T extends string>(
  message: string,
  options: Option<T>[],
  initialValue?: T,
): Promise<T | null> {
  const value = await select({
    message,
    options,
    initialValue,
  });
  if (isCancel(value)) return null;
  return value as T;
}

async function collectRenameCaseOverrides(
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

type MigrateOptions = {
  dryRun: boolean;
  yes: boolean;
  force: boolean;
  author?: string;
};

function shouldDefaultToMigrate(argvRest: string[]): boolean {
  if (argvRest.length === 0) return true;

  const hasNonOption = argvRest.some((arg) => !arg.startsWith("-"));
  if (hasNonOption) return false;

  const helpArgs = new Set(["--help", "-h", "help"]);
  const restWithoutHelp = argvRest.filter((a) => !helpArgs.has(a));
  return restWithoutHelp.length > 0;
}

async function runMigrate(options: MigrateOptions): Promise<void> {
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

    const renameActionsAll = planAll.actions.filter(
      (a): a is RenameAction => a.type === "rename",
    );
    const rootMovesAll = renameActionsAll.filter(
      (a) => !a.from.includes("/") && a.to.startsWith("docs/"),
    );
    const docsRenamesAll = renameActionsAll.filter(
      (a) =>
        a.from.startsWith("docs/") &&
        a.to.startsWith("docs/") &&
        hasDatePrefix(path.posix.basename(a.to)) &&
        !hasDatePrefix(path.posix.basename(a.from)),
    );
    const datePrefixNormalizationsAll = renameActionsAll.filter((a) =>
      isDatePrefixNormalizationRename(a),
    );
    const categorizedRenames = new Set<string>([
      ...rootMovesAll.map((a) => a.from),
      ...docsRenamesAll.map((a) => a.from),
      ...datePrefixNormalizationsAll.map((a) => a.from),
    ]);
    const canonicalRenamesAll = renameActionsAll.filter(
      (a) => !categorizedRenames.has(a.from),
    );
    const frontmatterAddsAll = planAll.actions.filter(
      (a): a is FrontmatterAction => a.type === "frontmatter",
    );
    const referenceUpdatesAll = planAll.actions.filter(
      (a): a is ReferenceUpdateAction => a.type === "references",
    );

    const defaultPreviews: StepPreview[] = [];

    if (rootMovesAll.length > 0)
      defaultPreviews.push({
        id: "migrate-root-move",
        title:
          "Relocate root Markdown docs into `docs/` (SimpleDoc convention)",
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

    if (installActionsAll.length > 0) {
      const createAgents = installActionsAll.filter(
        (a) => a.type === "write-file" && a.path === AGENTS_FILE,
      );
      if (createAgents.length > 0)
        defaultPreviews.push({
          id: "install-create-agents",
          title: `Create \`${AGENTS_FILE}\``,
          actionsText: formatInstallActions(createAgents),
          actionCount: createAgents.length,
        });

      const addLine = installActionsAll.filter(
        (a) => a.type === "append-line" && a.path === AGENTS_FILE,
      );
      if (addLine.length > 0)
        defaultPreviews.push({
          id: "install-add-attention-line",
          title: `Add SimpleDoc agent reminder line to \`${AGENTS_FILE}\``,
          actionsText: formatInstallActions(addLine),
          actionCount: addLine.length,
        });

      const howToDoc = installActionsAll.filter(
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

    if (defaultPreviews.length === 0) {
      process.stdout.write("No installation or migration needed.\n");
      return;
    }

    const printPreviews = (previews: StepPreview[]) => {
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
    };

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

    let createAgentsFile = false;
    let addAttentionLine = false;
    let addHowToDoc = false;
    let includeDatePrefixNormalization = true;
    let includeCanonicalRenames = true;
    let includeReferenceUpdates = true;
    const renameCaseOverrides: Record<string, RenameCaseMode> = {};

    if (rootMovesAll.length > 0) {
      noteWrapped(
        `Markdown files detected in the repo root (will be moved into \`docs/\`):\n\n${limitLines(formatRenameSources(rootMovesAll), MAX_STEP_FILE_PREVIEW_LINES)}`,
        `Proposed: Relocate root Markdown docs into \`docs/\` (${rootMovesAll.length})`,
      );
    }
    let includeRootMoves = false;
    if (rootMovesAll.length > 0) {
      const choice = await promptSelect<"yes" | "customize" | "no">(
        `Move ${rootMovesAll.length} root Markdown file${rootMovesAll.length === 1 ? "" : "s"} into \`docs/\`?`,
        [
          { label: "Yes", value: "yes" },
          { label: "Customize", value: "customize" },
          { label: "No", value: "no" },
        ],
        "yes",
      );
      if (choice === null) return abort("Operation cancelled.");
      if (choice === "yes") includeRootMoves = true;
      if (choice === "customize") {
        includeRootMoves = true;
        const overrides = await collectRenameCaseOverrides(rootMovesAll);
        if (overrides === null) return abort("Operation cancelled.");
        Object.assign(renameCaseOverrides, overrides);
      }
    }

    if (docsRenamesAll.length > 0) {
      noteWrapped(
        `Markdown files detected under \`docs/\` that should be date-prefixed (will be renamed to lowercase \`YYYY-MM-DD-…\`):\n\n${limitLines(formatRenameSources(docsRenamesAll), MAX_STEP_FILE_PREVIEW_LINES)}`,
        `Proposed: Date-prefix \`docs/\` Markdown filenames (${docsRenamesAll.length})`,
      );
    }
    let includeDocsRenames = false;
    if (docsRenamesAll.length > 0) {
      const choice = await promptSelect<"yes" | "customize" | "no">(
        `Date-prefix ${docsRenamesAll.length} \`docs/\` Markdown file${docsRenamesAll.length === 1 ? "" : "s"}?`,
        [
          { label: "Yes", value: "yes" },
          { label: "Customize", value: "customize" },
          { label: "No", value: "no" },
        ],
        "yes",
      );
      if (choice === null) return abort("Operation cancelled.");
      if (choice === "yes") includeDocsRenames = true;
      if (choice === "customize") {
        includeDocsRenames = true;
        const overrides = await collectRenameCaseOverrides(docsRenamesAll);
        if (overrides === null) return abort("Operation cancelled.");
        Object.assign(renameCaseOverrides, overrides);
      }
    }

    if (datePrefixNormalizationsAll.length > 0) {
      noteWrapped(
        `Date-prefixed docs detected with non-standard separators (will be normalized):\n\n${limitLines(formatActions(datePrefixNormalizationsAll), MAX_STEP_FILE_PREVIEW_LINES)}`,
        `Proposed: Normalize date-prefixed filenames (${datePrefixNormalizationsAll.length})`,
      );
      const include = await promptConfirm(
        `Normalize ${datePrefixNormalizationsAll.length} date-prefixed filename${datePrefixNormalizationsAll.length === 1 ? "" : "s"} to SimpleDoc naming?`,
        true,
      );
      if (include === null) return abort("Operation cancelled.");
      includeDatePrefixNormalization = include;
    }

    if (canonicalRenamesAll.length > 0) {
      noteWrapped(
        `Capitalized/canonical Markdown filenames detected (will be normalized with underscores, no date prefix):\n\n${limitLines(formatActions(canonicalRenamesAll), MAX_STEP_FILE_PREVIEW_LINES)}`,
        `Proposed: Normalize capitalized/canonical filenames (${canonicalRenamesAll.length})`,
      );
      const include = await promptConfirm(
        `Normalize ${canonicalRenamesAll.length} capitalized/canonical filename${canonicalRenamesAll.length === 1 ? "" : "s"} (underscores, no date prefix)?`,
        true,
      );
      if (include === null) return abort("Operation cancelled.");
      includeCanonicalRenames = include;
    }

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

    let includeFrontmatter = false;
    if (frontmatterAdds.length > 0) {
      noteWrapped(
        `Date-prefixed docs missing YAML frontmatter (will get \`title\`, \`author\`, \`date\`):\n\n${limitLines(formatActions(frontmatterAdds), MAX_STEP_FILE_PREVIEW_LINES)}`,
        `Proposed: Insert missing YAML frontmatter (${frontmatterAdds.length})`,
      );
      const include = await promptConfirm(
        `Insert YAML frontmatter into ${frontmatterAdds.length} doc${frontmatterAdds.length === 1 ? "" : "s"} missing it?`,
        true,
      );
      if (include === null) return abort("Operation cancelled.");
      includeFrontmatter = include;
    }

    if (referenceUpdates.length > 0) {
      noteWrapped(
        `Files referencing renamed docs (will be updated):\n\n${limitLines(formatActions(referenceUpdates), MAX_STEP_FILE_PREVIEW_LINES)}`,
        `Proposed: Update references to renamed docs (${referenceUpdates.length})`,
      );
      const include = await promptConfirm(
        `Update references in ${referenceUpdates.length} file${referenceUpdates.length === 1 ? "" : "s"}?`,
        true,
      );
      if (include === null) return abort("Operation cancelled.");
      includeReferenceUpdates = include;
    }

    let authorRewrites: Record<string, string> | null = null;
    if (includeFrontmatter && frontmatterAdds.length > 0 && !options.author) {
      const authorStats = getAuthorStats(frontmatterAdds);
      noteWrapped(
        summarizeAuthors(authorStats, 10),
        "Detected authors for inserted frontmatter (from git history)",
      );

      const useGit = await promptConfirm(
        "Use per-file git authors for inserted frontmatter?",
        true,
      );
      if (useGit === null) return abort("Operation cancelled.");
      if (!useGit) {
        noteWrapped(
          `You'll now be prompted to replace each of the ${authorStats.length} detected authors. Press Enter to keep the original.`,
          "Author replacement",
        );

        const rewrites: Record<string, string> = {};
        for (const [author, count] of authorStats) {
          const replacement = await promptText(
            `Replacement for ${author} (${count} files)`,
            author,
          );
          if (replacement === null) return abort("Operation cancelled.");
          rewrites[author] = replacement;
        }
        authorRewrites = rewrites;
      }
    }

    if (!installStatus.agentsExists) {
      noteWrapped(
        AGENTS_ATTENTION_LINE,
        `Proposed: Create \`${AGENTS_FILE}\` (includes the reminder line)`,
      );
      const include = await promptConfirm(`Create \`${AGENTS_FILE}\`?`, true);
      if (include === null) return abort("Operation cancelled.");
      createAgentsFile = include;
    } else if (!installStatus.agentsHasAttentionLine) {
      noteWrapped(
        AGENTS_ATTENTION_LINE,
        `Proposed: Add the reminder line to \`${AGENTS_FILE}\``,
      );
      const include = await promptConfirm(
        `Add this reminder line to \`${AGENTS_FILE}\`?`,
        true,
      );
      if (include === null) return abort("Operation cancelled.");
      addAttentionLine = include;
    }

    if (!installStatus.howToDocExists) {
      noteWrapped(
        `Will create \`${HOW_TO_DOC_FILE}\` from the bundled SimpleDoc template (won't overwrite if it already exists).`,
        "Proposed: Add docs/HOW_TO_DOC.md",
      );
      const include = await promptConfirm(
        `Create \`${HOW_TO_DOC_FILE}\` template?`,
        true,
      );
      if (include === null) return abort("Operation cancelled.");
      addHowToDoc = include;
    }

    const selectedInstallActions = await buildInstallationActions({
      createAgentsFile,
      addAttentionLine,
      addHowToDoc,
    });

    let selectedMigrationActions = planWithFrontmatter.actions.filter(
      (a) => includeFrontmatter || a.type !== "frontmatter",
    );
    if (!includeReferenceUpdates) {
      selectedMigrationActions = selectedMigrationActions.filter(
        (a) => a.type !== "references",
      );
    }

    const selectedSteps: StepPreview[] = [];
    const selectedRenameActions = selectedMigrationActions.filter(
      (a): a is RenameAction => a.type === "rename",
    );
    const selectedRootMoves = selectedRenameActions.filter(
      (a) => !a.from.includes("/") && a.to.startsWith("docs/"),
    );
    if (selectedRootMoves.length > 0)
      selectedSteps.push({
        id: "migrate-root-move",
        title: "Relocate root Markdown docs into `docs/`",
        actionsText: formatActions(selectedRootMoves),
        actionCount: selectedRootMoves.length,
      });

    const selectedDocsRenames = selectedRenameActions.filter(
      (a) =>
        a.from.startsWith("docs/") &&
        a.to.startsWith("docs/") &&
        hasDatePrefix(path.posix.basename(a.to)) &&
        !hasDatePrefix(path.posix.basename(a.from)),
    );
    if (selectedDocsRenames.length > 0)
      selectedSteps.push({
        id: "migrate-docs-date-prefix",
        title: "Date-prefix `docs/` Markdown filenames",
        actionsText: formatActions(selectedDocsRenames),
        actionCount: selectedDocsRenames.length,
      });

    const selectedDatePrefixNormalizations = selectedRenameActions.filter((a) =>
      isDatePrefixNormalizationRename(a),
    );
    if (selectedDatePrefixNormalizations.length > 0)
      selectedSteps.push({
        id: "migrate-docs-date-normalize",
        title: "Normalize date-prefixed `docs/` filenames to SimpleDoc naming",
        actionsText: formatActions(selectedDatePrefixNormalizations),
        actionCount: selectedDatePrefixNormalizations.length,
      });

    const selectedCategorized = new Set<string>([
      ...selectedRootMoves.map((a) => a.from),
      ...selectedDocsRenames.map((a) => a.from),
      ...selectedDatePrefixNormalizations.map((a) => a.from),
    ]);
    const selectedCanonicalRenames = selectedRenameActions.filter(
      (a) => !selectedCategorized.has(a.from),
    );
    if (selectedCanonicalRenames.length > 0)
      selectedSteps.push({
        id: "migrate-canonical-capitalization",
        title: "Normalize capitalized/canonical Markdown filenames",
        actionsText: formatActions(selectedCanonicalRenames),
        actionCount: selectedCanonicalRenames.length,
      });

    const selectedFrontmatters = selectedMigrationActions.filter(
      (a): a is FrontmatterAction => a.type === "frontmatter",
    );
    if (selectedFrontmatters.length > 0)
      selectedSteps.push({
        id: "migrate-frontmatter",
        title: "Insert missing YAML frontmatter",
        actionsText: formatActions(selectedFrontmatters),
        actionCount: selectedFrontmatters.length,
      });

    const selectedReferenceUpdates = selectedMigrationActions.filter(
      (a): a is ReferenceUpdateAction => a.type === "references",
    );
    if (selectedReferenceUpdates.length > 0)
      selectedSteps.push({
        id: "migrate-references",
        title: "Update references to renamed docs",
        actionsText: formatActions(selectedReferenceUpdates),
        actionCount: selectedReferenceUpdates.length,
      });

    const selectedCreateAgents = selectedInstallActions.filter(
      (a) => a.type === "write-file" && a.path === AGENTS_FILE,
    );
    if (selectedCreateAgents.length > 0)
      selectedSteps.push({
        id: "install-create-agents",
        title: `Create \`${AGENTS_FILE}\``,
        actionsText: formatInstallActions(selectedCreateAgents),
        actionCount: selectedCreateAgents.length,
      });

    const selectedAddLine = selectedInstallActions.filter(
      (a) => a.type === "append-line" && a.path === AGENTS_FILE,
    );
    if (selectedAddLine.length > 0)
      selectedSteps.push({
        id: "install-add-attention-line",
        title: `Add reminder line to \`${AGENTS_FILE}\``,
        actionsText: formatInstallActions(selectedAddLine),
        actionCount: selectedAddLine.length,
      });

    const selectedHowToDoc = selectedInstallActions.filter(
      (a) => a.type === "write-file" && a.path === HOW_TO_DOC_FILE,
    );
    if (selectedHowToDoc.length > 0)
      selectedSteps.push({
        id: "install-how-to-doc",
        title: `Create \`${HOW_TO_DOC_FILE}\` template`,
        actionsText: formatInstallActions(selectedHowToDoc),
        actionCount: selectedHowToDoc.length,
      });

    if (selectedSteps.length === 0) {
      outro("No changes selected.");
      return;
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

    if (renameCount > 0) {
      summaryLines.push(
        `- Rename/move Markdown files: ${renameCount} file${renameCount === 1 ? "" : "s"}`,
      );
    }
    if (frontmatterCount > 0) {
      summaryLines.push(
        `- Insert YAML frontmatter: ${frontmatterCount} file${frontmatterCount === 1 ? "" : "s"}`,
      );
    }
    if (referenceCount > 0) {
      summaryLines.push(
        `- Update references to renamed docs: ${referenceCount} file${referenceCount === 1 ? "" : "s"}`,
      );
    }

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
        authorRewrites,
      },
    );
    await applyInstallationActions(planAll.repoRootAbs, selectedInstallActions);
    s.stop("Done.");
    outro("Review with `git status` / `git diff` and commit when ready.");
  } catch (err) {
    process.stderr.write(`${getErrorMessage(err)}\n`);
    process.exitCode = 1;
    return;
  }
}

export async function runCli(argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name("simpledoc")
    .description("SimpleDoc conventions and CLI tooling for Markdown docs.")
    .showHelpAfterError()
    .showSuggestionAfterError();

  program.exitOverride();
  program.usage("[command] [options]");

  program
    .command("migrate")
    .description(
      "Install SimpleDoc agent docs and migrate a repo's docs to SimpleDoc conventions.",
    )
    .option("--dry-run", "Print planned changes and exit", false)
    .option("-y, --yes", "Apply defaults without prompts", false)
    .option("--force", "Run even if working tree is dirty", false)
    .option(
      "--author <author>",
      "Override author for inserted frontmatter (otherwise uses git history)",
    )
    .action(async (options: MigrateOptions) => {
      await runMigrate(options);
    });

  const rest = argv.slice(2);
  const argvToParse = shouldDefaultToMigrate(rest)
    ? [...argv.slice(0, 2), "migrate", ...rest]
    : argv;

  try {
    await program.parseAsync(argvToParse);
  } catch (err) {
    if (err instanceof CommanderError) {
      process.exitCode = err.exitCode;
      if (err.exitCode !== 0) {
        process.stderr.write(`${getErrorMessage(err)}\n`);
      }
      return;
    }
    throw err;
  }
}
