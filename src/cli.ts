import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { formatActions, planMigration, runMigrationPlan } from "./migrator.js";

type CliCommand = "migrate";

type CliArgs = {
  command: CliCommand;
  dryRun: boolean;
  yes: boolean;
  force: boolean;
  help: boolean;
  authorOverride: string | null;
};

function printHelp(): void {
  process.stdout.write(
    [
      "SimpleDoc CLI",
      "",
      "Usage:",
      "  simpledoc migrate [--dry-run] [--yes] [--force] [--author \"Name <email>\"]",
      "  simpledoc [--dry-run] [--yes] [--force] [--author \"Name <email>\"]   # defaults to `migrate`",
      "",
      "Commands:",
      "  migrate     One-step wizard to migrate a repo to SimpleDoc conventions",
      "",
      "Migrate options:",
      "  --dry-run   Print planned changes and exit",
      "  --yes       Apply defaults without prompts",
      "  --force     Run even if working tree is dirty",
      "  --author    Override author for inserted frontmatter (otherwise uses git history)",
      "  --help      Show this help",
      "",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    command: "migrate",
    dryRun: false,
    yes: false,
    force: false,
    help: false,
    authorOverride: null,
  };

  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;

    if (arg === "migrate") {
      args.command = "migrate";
      continue;
    }

    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (arg === "--yes" || arg === "-y") {
      args.yes = true;
      continue;
    }

    if (arg === "--force") {
      args.force = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    if (arg === "--author") {
      const value = rest[i + 1];
      if (!value) throw new Error("Missing value for --author");
      args.authorOverride = value;
      i++;
      continue;
    }

    if (arg.startsWith("--author=")) {
      args.authorOverride = arg.slice("--author=".length);
      continue;
    }

    if (arg.startsWith("-")) throw new Error(`Unknown argument: ${arg}`);
    throw new Error(`Unknown command: ${arg}`);
  }

  return args;
}

async function confirm(rl: ReturnType<typeof createInterface>, question: string, defaultYes: boolean) {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = (await rl.question(`${question} ${suffix} `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === "y" || answer === "yes";
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

function getGitConfiguredAuthor(): string | null {
  const nameRes = spawnSync("git", ["config", "--get", "user.name"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const emailRes = spawnSync("git", ["config", "--get", "user.email"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  const name = (nameRes.stdout ?? "").trim();
  const email = (emailRes.stdout ?? "").trim();
  if (!name && !email) return null;
  if (name && email) return `${name} <${email}>`;
  return name || email;
}

export async function runCli(argv: string[]): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${getErrorMessage(err)}\n\n`);
    printHelp();
    process.exitCode = 2;
    return;
  }

  if (args.help) {
    printHelp();
    return;
  }

  if (args.command !== "migrate") {
    process.stderr.write(`Unknown command: ${args.command}\n\n`);
    printHelp();
    process.exitCode = 2;
    return;
  }

  let plan;
  try {
    plan = await planMigration();
  } catch (err) {
    process.stderr.write(`${getErrorMessage(err)}\n`);
    process.exitCode = 1;
    return;
  }

  if (plan.actions.length === 0) {
    process.stdout.write("No migration needed.\n");
    return;
  }

  if (plan.dirty && !args.force) {
    if (args.dryRun) {
      process.stderr.write("Warning: working tree is dirty (use --force to apply).\n\n");
    } else if (args.yes) {
      process.stderr.write("Refusing to apply changes on a dirty working tree without --force.\n");
      process.exitCode = 2;
      return;
    }
  }

  const rootMoves = plan.actions.filter((a) => a.type === "rename" && !a.from.includes("/"));
  const docsRenames = plan.actions.filter((a) => a.type === "rename" && a.from.startsWith("docs/"));
  const frontmatterAdds = plan.actions.filter((a) => a.type === "frontmatter");

  process.stdout.write("Planned changes:\n");
  if (rootMoves.length > 0) {
    process.stdout.write(`\nStep 1: Move root markdown files to docs/ (${rootMoves.length})\n`);
    process.stdout.write(`${limitLines(formatActions(rootMoves), 30)}\n`);
  }
  if (docsRenames.length > 0) {
    process.stdout.write(`\nStep 2: Add date prefixes to docs/ markdown files (${docsRenames.length})\n`);
    process.stdout.write(`${limitLines(formatActions(docsRenames), 30)}\n`);
  }
  if (frontmatterAdds.length > 0) {
    process.stdout.write(`\nStep 3: Add YAML frontmatter (${frontmatterAdds.length})\n`);
    process.stdout.write(`${limitLines(formatActions(frontmatterAdds), 30)}\n`);
  }

  if (args.dryRun) return;

  const interactive = process.stdin.isTTY && process.stdout.isTTY && !args.yes;
  if (!interactive && !args.yes) {
    process.stderr.write("Refusing to apply changes without a TTY. Re-run with --yes.\n");
    process.exitCode = 2;
    return;
  }

  let proceed = true;
  if (interactive) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (plan.dirty && !args.force) {
        const contDirty = await confirm(rl, "Working tree is dirty. Continue anyway?", false);
        if (!contDirty) {
          process.stdout.write("Aborted.\n");
          process.exitCode = 1;
          return;
        }
      }

      if (frontmatterAdds.length > 0 && !args.authorOverride) {
        const useGit = await confirm(rl, "Use per-file authors from git history for new frontmatter?", true);
        if (!useGit) {
          const suggested = getGitConfiguredAuthor();
          const answer = (
            await rl.question(
              suggested
                ? `Author to use for inserted frontmatter (Name <email>) [${suggested}]: `
                : "Author to use for inserted frontmatter (Name <email>): ",
            )
          ).trim();
          args.authorOverride = answer || suggested;
          if (!args.authorOverride) {
            process.stderr.write("Author is required when not using git history.\n");
            process.exitCode = 2;
            return;
          }
        }
      }

      if (rootMoves.length > 0) {
        const ok = await confirm(rl, "Proceed with step 1 (move root markdown to docs/)?", true);
        if (!ok) {
          process.stdout.write("Aborted.\n");
          process.exitCode = 1;
          return;
        }
      }
      if (docsRenames.length > 0) {
        const ok = await confirm(rl, "Proceed with step 2 (date-prefix docs/ markdown)?", true);
        if (!ok) {
          process.stdout.write("Aborted.\n");
          process.exitCode = 1;
          return;
        }
      }
      if (frontmatterAdds.length > 0) {
        const ok = await confirm(rl, "Proceed with step 3 (add YAML frontmatter)?", true);
        if (!ok) {
          process.stdout.write("Aborted.\n");
          process.exitCode = 1;
          return;
        }
      }

      proceed = await confirm(rl, "Apply all steps now?", true);
    } finally {
      rl.close();
    }
  }

  if (!proceed) {
    process.stdout.write("Aborted.\n");
    process.exitCode = 1;
    return;
  }

  try {
    await runMigrationPlan(plan, { authorOverride: args.authorOverride });
  } catch (err) {
    process.stderr.write(`${getErrorMessage(err)}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Done. Review with `git status` / `git diff` and commit when ready.\n");
}
