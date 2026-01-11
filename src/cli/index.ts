import process from "node:process";
import { Command, CommanderError } from "commander";

import { runCheck } from "./check.js";
import { runInstall } from "./install.js";
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
