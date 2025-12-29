import { spawn } from "node:child_process";

export type FileMeta = {
  date: string;
  author: string;
};

export type GitClient = {
  getRepoRoot(cwd: string): Promise<string>;
  isDirty(cwd: string): Promise<boolean>;
  listTrackedFiles(cwd: string): Promise<string[]>;
  listRepoFiles(cwd: string): Promise<string[]>;
  getCreationInfo(cwd: string, filePath: string): Promise<FileMeta | null>;
  mv(cwd: string, from: string, to: string): Promise<void>;
  grepFilesFixed(cwd: string, patterns: string[]): Promise<string[]>;
};

function createLimiter(
  concurrency: number,
): <T>(fn: () => Promise<T>) => Promise<T> {
  const max = Math.max(1, concurrency);
  let active = 0;
  const queue: Array<() => void> = [];

  const wakeNext = () => {
    if (active >= max) return;
    const next = queue.shift();
    if (next) next();
  };

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max)
      await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      wakeNext();
    }
  };
}

async function execGit(
  args: string[],
  opts: { cwd: string; allowExitCodes?: number[] } = { cwd: process.cwd() },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const allow = new Set(opts.allowExitCodes ?? [0]);
  return await new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      ["--no-pager", "-c", "color.ui=false", ...args],
      {
        cwd: opts.cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const exitCode = code ?? 0;
      if (!allow.has(exitCode)) {
        const msg = (stderr || stdout || "").trim();
        reject(
          new Error(
            msg || `git ${args.join(" ")} failed with code ${exitCode}`,
          ),
        );
        return;
      }
      resolve({ stdout, stderr, exitCode });
    });
  });
}

function parseZList(stdout: string): string[] {
  return stdout
    .split("\0")
    .map((p) => p.trim())
    .filter(Boolean);
}

export function createGitClient(opts?: { maxConcurrency?: number }): GitClient {
  const limit = createLimiter(opts?.maxConcurrency ?? 4);
  const run = async (
    args: string[],
    options: { cwd: string; allowExitCodes?: number[] },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    return await limit(() => execGit(args, options));
  };

  return {
    async getRepoRoot(cwd: string): Promise<string> {
      const { stdout } = await run(["rev-parse", "--show-toplevel"], { cwd });
      const root = stdout.trim();
      if (!root)
        throw new Error("Not a git repository (or git is not available).");
      return root;
    },

    async isDirty(cwd: string): Promise<boolean> {
      const { stdout } = await run(["status", "--porcelain"], { cwd });
      return stdout.trim().length > 0;
    },

    async listTrackedFiles(cwd: string): Promise<string[]> {
      const { stdout } = await run(["ls-files", "-z"], { cwd });
      return parseZList(stdout);
    },

    async listRepoFiles(cwd: string): Promise<string[]> {
      const { stdout } = await run(
        ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        { cwd },
      );
      return parseZList(stdout);
    },

    async getCreationInfo(
      cwd: string,
      filePath: string,
    ): Promise<FileMeta | null> {
      const { stdout } = await run(
        ["log", "--follow", "--format=%aI\t%aN\t%aE", "--", filePath],
        { cwd },
      );
      const lines = stdout.trim().split("\n").filter(Boolean);
      if (lines.length === 0) return null;
      const [dateIso, name, email] = lines[lines.length - 1]!.split("\t");
      if (!dateIso) return null;
      const date = dateIso.slice(0, 10);
      const author = email ? `${name} <${email}>` : (name ?? "");
      return {
        date,
        author: author || "Unknown <unknown@example.com>",
      };
    },

    async mv(cwd: string, from: string, to: string): Promise<void> {
      await run(["mv", "--", from, to], { cwd });
    },

    async grepFilesFixed(cwd: string, patterns: string[]): Promise<string[]> {
      if (patterns.length === 0) return [];
      const out = new Set<string>();
      const chunkSize = 64;

      for (let i = 0; i < patterns.length; i += chunkSize) {
        const chunk = patterns.slice(i, i + chunkSize);
        const { stdout } = await run(
          ["grep", "-l", "-F", "-z", ...chunk.flatMap((p) => ["-e", p]), "--"],
          { cwd, allowExitCodes: [0, 1] },
        );
        for (const filePath of stdout.split("\0").filter(Boolean))
          out.add(filePath.trim());
      }

      return [...out];
    },
  };
}
