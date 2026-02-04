import process from "node:process";
import { Command, CommanderError } from "commander";

import { runCheck } from "./check.js";
import { runInstall } from "./install.js";
import { runLog } from "./log.js";
import { runMigrate } from "./migrate.js";

type MigrateOptions = {
  dryRun: boolean;
  yes: boolean;
  force: boolean;
  author?: string;
};
type InstallOptions = {
  dryRun: boolean;
  yes: boolean;
};
type LogOptions = {
  root?: string;
  thresholdMinutes: string;
  stdin?: boolean;
};

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function shouldDefaultToMigrate(argvRest: string[]): boolean {
  if (argvRest.length === 0) return true;

  const hasNonOption = argvRest.some((arg) => !arg.startsWith("-"));
  if (hasNonOption) return false;

  const helpArgs = new Set(["--help", "-h", "help"]);
  const restWithoutHelp = argvRest.filter((a) => !helpArgs.has(a));
  return restWithoutHelp.length > 0;
}

async function readStdinMessage(fallback: string): Promise<string> {
  const chunks: string[] = [];
  return await new Promise((resolve, reject) => {
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      chunks.push(String(chunk));
    });
    process.stdin.on("error", reject);
    process.stdin.on("end", () => {
      const combined = chunks.join("");
      const trimmed = combined.trim();
      resolve(trimmed.length > 0 ? combined : fallback);
    });
  });
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
      "Install SimpleDoc agent instructions and migrate a repo's docs to SimpleDoc conventions.",
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

  program
    .command("install")
    .description("Install SimpleDoc agent instructions (no doc migrations).")
    .option("--dry-run", "Print planned changes and exit", false)
    .option("-y, --yes", "Apply defaults without prompts", false)
    .action(async (options: InstallOptions) => {
      await runInstall(options);
    });

  program
    .command("check")
    .description("Fail if the repo violates SimpleDoc conventions (use in CI).")
    .action(async () => {
      await runCheck();
    });

  program
    .command("log")
    .description("Append a SimpleLog entry (Daily Markdown Log) to docs/logs.")
    .argument("[message...]", "Entry text to append")
    .option("--root <dir>", "Root directory for log files (default: docs/logs)")
    .option("--stdin", "Read entry text from stdin (supports multiline)")
    .option(
      "--threshold-minutes <minutes>",
      "Start a new time section if the last entry is older than this (default: 5). Use 0 to disable.",
      "5",
    )
    .action(async (messageParts: string[], options: LogOptions) => {
      let message = messageParts.join(" ");
      if (options.stdin) {
        message = await readStdinMessage(message);
      }
      await runLog(message, options);
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
