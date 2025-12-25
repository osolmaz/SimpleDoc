import process from "node:process";
import { Command, CommanderError } from "commander";
import {
  cancel,
  confirm,
  intro,
  isCancel,
  note,
  outro,
  spinner,
  text,
} from "@clack/prompts";
import { formatActions, planMigration, runMigrationPlan } from "./migrator.js";
import type { FrontmatterAction } from "./migrator.js";

function abort(message = "Aborted."): void {
  cancel(message);
  process.exitCode = 1;
}

function limitLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return `${lines.slice(0, maxLines).join("\n")}\n- …and ${lines.length - maxLines} more`;
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
    const plan = await planMigration();

    if (plan.actions.length === 0) {
      process.stdout.write("No migration needed.\n");
      return;
    }

    const hasTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    if (plan.dirty && !options.force) {
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

    const rootMoves = plan.actions.filter(
      (a) => a.type === "rename" && !a.from.includes("/"),
    );
    const docsRenames = plan.actions.filter(
      (a) => a.type === "rename" && a.from.startsWith("docs/"),
    );
    const frontmatterAdds = plan.actions.filter(
      (a): a is FrontmatterAction => a.type === "frontmatter",
    );

    const steps = [
      {
        id: "root-move",
        title:
          "Relocate root Markdown docs into `docs/` (SimpleDoc convention)",
        confirmLabel: "move root Markdown docs into `docs/`",
        actions: rootMoves,
      },
      {
        id: "docs-date-prefix",
        title:
          "Rename `docs/` Markdown files to `YYYY-MM-DD-…` using first git commit date",
        confirmLabel:
          "date-prefix `docs/` Markdown filenames using first commit date",
        actions: docsRenames,
      },
      {
        id: "frontmatter",
        title:
          "Insert missing YAML frontmatter (title/author/date) into date-prefixed docs",
        confirmLabel: "add YAML frontmatter (title/author/date)",
        actions: frontmatterAdds,
      },
    ].filter((s) => s.actions.length > 0);

    const interactiveWizard = hasTty && !options.yes && !options.dryRun;
    if (interactiveWizard) {
      intro("simpledoc migrate");
      for (const [idx, step] of steps.entries()) {
        const stepNo = idx + 1;
        note(
          limitLines(formatActions(step.actions), 30),
          `Step ${stepNo}: ${step.title} (${step.actions.length})`,
        );
      }
    } else {
      process.stdout.write("Planned changes:\n");
      for (const [idx, step] of steps.entries()) {
        const stepNo = idx + 1;
        process.stdout.write(
          `\nStep ${stepNo}: ${step.title} (${step.actions.length})\n`,
        );
        process.stdout.write(
          `${limitLines(formatActions(step.actions), 30)}\n`,
        );
      }
    }

    if (options.dryRun) return;

    if (!hasTty && !options.yes) {
      process.stderr.write(
        "Refusing to apply changes without a TTY. Re-run with --yes.\n",
      );
      process.exitCode = 2;
      return;
    }

    const args = {
      authorOverride: options.author ?? null,
      authorRewrites: null as Record<string, string> | null,
    };

    let proceed = true;
    if (interactiveWizard) {
      if (plan.dirty && !options.force) {
        const contDirty = await promptConfirm(
          "Working tree is dirty. Continue anyway?",
          false,
        );
        if (contDirty === null) return abort("Operation cancelled.");
        if (!contDirty) return abort();
      }

      if (frontmatterAdds.length > 0 && !args.authorOverride) {
        const authorStats = getAuthorStats(frontmatterAdds);
        note(
          summarizeAuthors(authorStats, 10),
          "Detected authors for inserted frontmatter (from git history)",
        );

        const useGit = await promptConfirm(
          `Use per-file authors from git history for inserted frontmatter? (No = you'll be prompted to replace each of the ${authorStats.length} detected authors)`,
          true,
        );
        if (useGit === null) return abort("Operation cancelled.");
        if (!useGit) {
          note(
            "You'll now be prompted to replace each detected author. Press Enter to keep the original.",
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
          args.authorRewrites = rewrites;
        }
      }

      for (const [idx, step] of steps.entries()) {
        const stepNo = idx + 1;
        const ok = await promptConfirm(
          `Proceed with step ${stepNo} (${step.confirmLabel})?`,
          true,
        );
        if (ok === null) return abort("Operation cancelled.");
        if (!ok) return abort();
      }

      const apply = await promptConfirm("Apply all steps now?", true);
      if (apply === null) return abort("Operation cancelled.");
      proceed = apply;
    }

    if (!proceed) {
      if (interactiveWizard) return abort();
      process.stdout.write("Aborted.\n");
      process.exitCode = 1;
      return;
    }

    if (interactiveWizard) {
      const s = spinner();
      s.start("Applying migration...");
      await runMigrationPlan(plan, args);
      s.stop("Migration applied.");
      outro(
        "Done. Review with `git status` / `git diff` and commit when ready.",
      );
    } else {
      await runMigrationPlan(plan, args);
      process.stdout.write(
        "Done. Review with `git status` / `git diff` and commit when ready.\n",
      );
    }
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
      "One-step wizard to migrate a repo's docs to SimpleDoc conventions.",
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
