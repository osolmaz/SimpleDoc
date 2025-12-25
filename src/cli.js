import { createInterface } from "node:readline/promises";
import process from "node:process";
import { formatActions, planMigration, runMigrationPlan } from "./migrator.js";

function printHelp() {
  process.stdout.write(
    [
      "SimpleDoc CLI",
      "",
      "Usage:",
      "  simpledoc migrate [--dry-run] [--yes] [--force]",
      "  simpledoc [--dry-run] [--yes] [--force]   # defaults to `migrate`",
      "",
      "Commands:",
      "  migrate     One-step wizard to migrate a repo to SimpleDoc conventions",
      "",
      "Migrate options:",
      "  --dry-run   Print planned changes and exit",
      "  --yes       Apply defaults without prompts",
      "  --force     Run even if working tree is dirty",
      "  --help      Show this help",
      "",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const positional = [];
  const flags = [];
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("-")) flags.push(arg);
    else positional.push(arg);
  }

  const command = positional[0] ?? "migrate";

  const args = {
    command,
    dryRun: false,
    yes: false,
    force: false,
    help: false,
  };

  for (const arg of flags) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--yes" || arg === "-y") args.yes = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

async function confirm(rl, question, defaultYes) {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = (await rl.question(`${question} ${suffix} `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === "y" || answer === "yes";
}

function limitLines(text, maxLines) {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return `${lines.slice(0, maxLines).join("\n")}\n- …and ${lines.length - maxLines} more`;
}

export async function runCli(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n\n`);
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
    plan = await planMigration({ force: args.force });
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
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
    process.stdout.write(`\nStep 1: Move root lowercase markdown files to docs/ (${rootMoves.length})\n`);
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
    await runMigrationPlan(plan);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Done. Review with `git status` / `git diff` and commit when ready.\n");
}
