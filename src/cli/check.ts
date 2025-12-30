import process from "node:process";

import {
  formatActions,
  planMigration,
  type FrontmatterAction,
  type ReferenceUpdateAction,
  type RenameAction,
} from "../migrator.js";
import {
  AGENTS_FILE,
  HOW_TO_DOC_FILE,
  buildInstallationActions,
  formatInstallActions,
  getInstallationStatus,
} from "../installer.js";
import { MAX_STEP_FILE_PREVIEW_LINES, limitLines } from "./ui.js";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function runCheck(): Promise<void> {
  try {
    const plan = await planMigration();
    const installStatus = await getInstallationStatus(plan.repoRootAbs);

    const installActions = await buildInstallationActions({
      createAgentsFile: !installStatus.agentsExists,
      addAttentionLine:
        installStatus.agentsExists && !installStatus.agentsHasAttentionLine,
      addHowToDoc: !installStatus.howToDocExists,
    });

    const renames = plan.actions.filter(
      (a): a is RenameAction => a.type === "rename",
    );
    const frontmatters = plan.actions.filter(
      (a): a is FrontmatterAction => a.type === "frontmatter",
    );
    const references = plan.actions.filter(
      (a): a is ReferenceUpdateAction => a.type === "references",
    );

    if (
      renames.length === 0 &&
      frontmatters.length === 0 &&
      references.length === 0 &&
      installActions.length === 0
    ) {
      process.stdout.write("OK: repo matches SimpleDoc conventions.\n");
      return;
    }

    process.stdout.write("SimpleDoc check failed.\n\n");

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

    const createAgents = installActions.filter(
      (a) => a.type === "write-file" && a.path === AGENTS_FILE,
    );
    if (createAgents.length > 0)
      summaryLines.push(`- Missing \`${AGENTS_FILE}\``);

    const addLine = installActions.filter(
      (a) => a.type === "append-line" && a.path === AGENTS_FILE,
    );
    if (addLine.length > 0)
      summaryLines.push(`- Missing reminder line in \`${AGENTS_FILE}\``);

    const howToDoc = installActions.filter(
      (a) => a.type === "write-file" && a.path === HOW_TO_DOC_FILE,
    );
    if (howToDoc.length > 0)
      summaryLines.push(`- Missing \`${HOW_TO_DOC_FILE}\``);

    process.stdout.write(`${summaryLines.join("\n")}\n\n`);

    const allActions = [
      ...renames,
      ...frontmatters,
      ...references,
      ...installActions,
    ];
    if (allActions.length > 0) {
      const previewLines: string[] = [];
      if (renames.length > 0) previewLines.push(formatActions(renames));
      if (frontmatters.length > 0)
        previewLines.push(formatActions(frontmatters));
      if (references.length > 0) previewLines.push(formatActions(references));
      if (installActions.length > 0)
        previewLines.push(formatInstallActions(installActions));

      const preview = previewLines.filter(Boolean).join("\n");
      const limited = limitLines(preview, MAX_STEP_FILE_PREVIEW_LINES);
      process.stdout.write(`${limited}\n\n`);
    }

    process.stdout.write("Run `simpledoc migrate` to fix.\n");
    process.exitCode = 1;
  } catch (err) {
    process.stderr.write(`${getErrorMessage(err)}\n`);
    process.exitCode = 1;
  }
}
