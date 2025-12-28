import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

type CommitOptions = {
  message: string;
  author: string;
  dateIso: string;
};

export async function makeTempRepo(): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "simpledoc-test-"));
  git(dir, ["init"]);
  git(dir, ["config", "user.name", "Test Committer"]);
  git(dir, ["config", "user.email", "committer@example.com"]);
  return {
    dir,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

export function git(
  cwd: string,
  args: string[],
  env?: Record<string, string>,
): string {
  const out = execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return out.trimEnd();
}

export async function writeFile(
  repoDir: string,
  relPathPosix: string,
  content: string,
): Promise<void> {
  const abs = path.join(repoDir, ...relPathPosix.split("/"));
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

export async function readFile(
  repoDir: string,
  relPathPosix: string,
): Promise<string> {
  const abs = path.join(repoDir, ...relPathPosix.split("/"));
  return fs.readFile(abs, "utf8");
}

export async function exists(
  repoDir: string,
  relPathPosix: string,
): Promise<boolean> {
  try {
    const abs = path.join(repoDir, ...relPathPosix.split("/"));
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

export function commitAll(repoDir: string, options: CommitOptions): void {
  git(repoDir, ["add", "-A"]);
  git(repoDir, ["commit", "-m", options.message, "--author", options.author], {
    GIT_AUTHOR_DATE: options.dateIso,
    GIT_COMMITTER_DATE: options.dateIso,
  });
}
