import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const AGENTS_FILE = "AGENTS.md";
export const SIMPLEDOC_SKILL_FILE = path.posix.join(
  "skills",
  "simpledoc",
  "SKILL.md",
);

export const AGENTS_ATTENTION_LINE = `**Attention agent!** Before creating ANY documentation, use the \`simpledoc\` skill in \`${SIMPLEDOC_SKILL_FILE}\`.`;

export type InstallAction =
  | {
      type: "write-file";
      path: string;
      content: string;
      ifExists: "skip" | "overwrite";
    }
  | {
      type: "append-line";
      path: string;
      line: string;
    };

export type InstallationStatus = {
  agentsExists: boolean;
  agentsHasAttentionLine: boolean;
  skillExists: boolean;
};

function normalizeNewlines(input: string): string {
  return input.replace(/\r\n/g, "\n");
}

function hasExactLine(content: string, line: string): boolean {
  const lines = normalizeNewlines(content).split("\n");
  return lines.some((l) => l.replace(/\r$/, "") === line);
}

function defaultAgentsFileContent(): string {
  return ["# Agent Instructions", "", AGENTS_ATTENTION_LINE, ""].join("\n");
}

async function readBundledSimpleDocSkill(): Promise<string> {
  const primaryUrl = new URL("../skills/simpledoc/SKILL.md", import.meta.url);
  const primaryPath = fileURLToPath(primaryUrl);
  try {
    return await fs.readFile(primaryPath, "utf8");
  } catch {
    const fallbackUrl = new URL(
      "../../skills/simpledoc/SKILL.md",
      import.meta.url,
    );
    const fallbackPath = fileURLToPath(fallbackUrl);
    return await fs.readFile(fallbackPath, "utf8");
  }
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

export async function getInstallationStatus(
  repoRootAbs: string,
): Promise<InstallationStatus> {
  const agentsAbs = path.join(repoRootAbs, AGENTS_FILE);
  const skillAbs = path.join(repoRootAbs, ...SIMPLEDOC_SKILL_FILE.split("/"));

  const agentsExists = await fileExists(agentsAbs);
  const agentsContent = agentsExists
    ? await fs.readFile(agentsAbs, "utf8")
    : null;
  const agentsHasAttentionLine = agentsContent
    ? hasExactLine(agentsContent, AGENTS_ATTENTION_LINE)
    : false;

  const skillExists = await fileExists(skillAbs);

  return { agentsExists, agentsHasAttentionLine, skillExists };
}

export async function buildInstallationActions(opts: {
  createAgentsFile: boolean;
  addAttentionLine: boolean;
  addSkill: boolean;
}): Promise<InstallAction[]> {
  const actions: InstallAction[] = [];

  if (opts.createAgentsFile) {
    actions.push({
      type: "write-file",
      path: AGENTS_FILE,
      content: defaultAgentsFileContent(),
      ifExists: "skip",
    });
  }

  if (opts.addAttentionLine) {
    actions.push({
      type: "append-line",
      path: AGENTS_FILE,
      line: AGENTS_ATTENTION_LINE,
    });
  }

  if (opts.addSkill) {
    actions.push({
      type: "write-file",
      path: SIMPLEDOC_SKILL_FILE,
      content: await readBundledSimpleDocSkill(),
      ifExists: "skip",
    });
  }

  return actions;
}

async function ensureParentDir(repoRootAbs: string, relPath: string) {
  const dir = path.dirname(path.join(repoRootAbs, ...relPath.split("/")));
  await fs.mkdir(dir, { recursive: true });
}

export async function applyInstallationActions(
  repoRootAbs: string,
  actions: InstallAction[],
): Promise<void> {
  for (const action of actions) {
    if (action.type === "write-file") {
      const abs = path.join(repoRootAbs, ...action.path.split("/"));
      const exists = await fileExists(abs);
      if (exists && action.ifExists === "skip") continue;
      await ensureParentDir(repoRootAbs, action.path);
      const content = action.content.endsWith("\n")
        ? action.content
        : `${action.content}\n`;
      await fs.writeFile(abs, content, "utf8");
      continue;
    }

    if (action.type === "append-line") {
      const abs = path.join(repoRootAbs, ...action.path.split("/"));
      const exists = await fileExists(abs);
      if (!exists) {
        await ensureParentDir(repoRootAbs, action.path);
        await fs.writeFile(abs, defaultAgentsFileContent(), "utf8");
      }

      const current = await fs.readFile(abs, "utf8");
      if (hasExactLine(current, action.line)) continue;
      const suffix = `\n${action.line}\n`;
      await fs.appendFile(abs, suffix, "utf8");
      continue;
    }

    const exhaustiveCheck: never = action;
    throw new Error(`Unknown install action: ${String(exhaustiveCheck)}`);
  }
}

export function formatInstallActions(actions: InstallAction[]): string {
  const lines: string[] = [];
  for (const action of actions) {
    if (action.type === "write-file") {
      const verb = action.ifExists === "overwrite" ? "write" : "create";
      lines.push(`- ${verb}: ${action.path}`);
      continue;
    }
    if (action.type === "append-line") {
      lines.push(`- append line: ${action.path}`);
      continue;
    }
    const exhaustiveCheck: never = action;
    throw new Error(`Unknown install action: ${String(exhaustiveCheck)}`);
  }
  return lines.join("\n");
}
