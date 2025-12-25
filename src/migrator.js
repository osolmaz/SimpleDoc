import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

function runGit(args, { cwd }) {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (res.error) throw res.error;
  if (res.status !== 0) {
    const msg = (res.stderr || res.stdout || "").trim();
    throw new Error(msg || `git ${args.join(" ")} failed with code ${res.status}`);
  }
  return res.stdout;
}

function getRepoRoot() {
  const res = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error("Not a git repository (or git is not available).");
  return res.stdout.trim();
}

function isDirty(cwd) {
  const out = runGit(["status", "--porcelain"], { cwd });
  return out.trim().length > 0;
}

function isMarkdownFile(filePath) {
  return filePath.endsWith(".md") || filePath.endsWith(".mdx");
}

function isLowercaseDocBaseName(baseName) {
  const name = baseName.replace(/\.(md|mdx)$/i, "");
  return /[a-z]/.test(name) && !/[A-Z]/.test(name);
}

function isDatePrefixedBaseName(baseName) {
  const m = baseName.match(/^(\d{4}-\d{2}-\d{2})-/);
  return m ? m[1] : null;
}

function isCapitalizedDoc(baseName) {
  const name = baseName.replace(/\.(md|mdx)$/i, "");
  return /[A-Z]/.test(name);
}

function slugifyBaseName(baseName) {
  const name = baseName.replace(/\.(md|mdx)$/i, "");
  const ext = baseName.slice(name.length);

  const slug = name
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return `${slug}${ext}`;
}

function titleFromSlug(slug) {
  const words = slug
    .replace(/\.(md|mdx)$/i, "")
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .split("-")
    .filter(Boolean);
  if (words.length === 0) return "Untitled";
  return words
    .map((w) => (w ? w[0].toLocaleUpperCase("en-US") + w.slice(1) : w))
    .join(" ");
}

function titleFromMarkdown(content) {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^#\s+(.+)\s*$/);
    if (m) return m[1].trim();
    if (line.trim() !== "") break;
  }
  return null;
}

function hasFrontmatter(content) {
  const s = content.replace(/^\uFEFF/, "");
  if (!s.startsWith("---\n") && !s.startsWith("---\r\n")) return false;
  const end = s.indexOf("\n---", 4);
  if (end === -1) return false;
  const after = s.slice(end + 1);
  return after.startsWith("---\n") || after.startsWith("---\r\n");
}

function yamlQuote(value) {
  const s = String(value).replace(/\r?\n/g, " ").trim();
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function buildFrontmatter({ title, author, date }) {
  return [
    "---",
    `title: ${yamlQuote(title)}`,
    `author: ${yamlQuote(author)}`,
    `date: ${yamlQuote(date)}`,
    "---",
  ].join("\n");
}

function getCreationInfo(cwd, filePath) {
  const out = runGit(["log", "--follow", "--format=%aI\t%aN\t%aE", "--", filePath], { cwd });
  const lines = out.trim().split("\n").filter(Boolean);
  if (lines.length === 0) return null;
  const [dateIso, name, email] = lines[lines.length - 1].split("\t");
  const date = dateIso.slice(0, 10);
  const author = email ? `${name} <${email}>` : name;
  return { dateIso, date, author, name, email };
}

async function getFileSystemInfo(repoRootAbs, filePath) {
  const abs = path.join(repoRootAbs, ...filePath.split("/"));
  const stat = await fs.stat(abs);
  const dateIso = stat.birthtime && Number.isFinite(stat.birthtimeMs) && stat.birthtimeMs > 0 ? stat.birthtime.toISOString() : stat.mtime.toISOString();
  const date = dateIso.slice(0, 10);
  return { dateIso, date, author: "Unknown <unknown@example.com>", name: "Unknown", email: "" };
}

function parsePathParts(relPath) {
  const dir = path.posix.dirname(relPath);
  const base = path.posix.basename(relPath);
  const dot = base.lastIndexOf(".");
  const ext = dot === -1 ? "" : base.slice(dot);
  const name = dot === -1 ? base : base.slice(0, dot);
  return { dir: dir === "." ? "" : dir, base, name, ext };
}

function uniqueTargetPath(preferredRelPath, occupied) {
  if (!occupied.has(preferredRelPath)) return preferredRelPath;
  const { dir, name, ext } = parsePathParts(preferredRelPath);
  for (let i = 2; i < 10_000; i++) {
    const candidate = path.posix.join(dir, `${name}-${i}${ext}`);
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error(`Unable to find a unique filename for: ${preferredRelPath}`);
}

async function listRootFiles(repoRootAbs) {
  const entries = await fs.readdir(repoRootAbs, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => !name.startsWith("."));
}

function toPosixRelPath(p) {
  return p.split(path.sep).join(path.posix.sep);
}

export function formatActions(actions) {
  const lines = [];
  for (const action of actions) {
    if (action.type === "rename") lines.push(`- rename: ${action.from} -> ${action.to}`);
    else if (action.type === "frontmatter") lines.push(`- frontmatter: ${action.path}`);
    else lines.push(`- ${action.type}: ${action.path ?? ""}`.trim());
  }
  return lines.join("\n");
}

export async function planMigration({ force }) {
  const repoRootAbs = getRepoRoot();
  const repoRoot = toPosixRelPath(repoRootAbs);

  const dirty = isDirty(repoRootAbs);

  const tracked = runGit(["ls-files", "-z"], { cwd: repoRootAbs })
    .split("\0")
    .filter(Boolean)
    .map((p) => p.trim());
  const trackedSet = new Set(tracked);

  const rootFiles = await listRootFiles(repoRootAbs);
  const rootMarkdown = rootFiles.filter((f) => {
    if (!isMarkdownFile(f)) return false;
    return Boolean(isDatePrefixedBaseName(f)) || isLowercaseDocBaseName(f);
  });

  const existingAll = runGit(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: repoRootAbs,
  })
    .split("\0")
    .filter(Boolean)
    .map((p) => p.trim());
  const existingAllSet = new Set(existingAll);

  const docsMarkdown = existingAll.filter((p) => p.startsWith("docs/") && isMarkdownFile(p));
  const candidates = [...new Set([...rootMarkdown, ...docsMarkdown])];

  const fileMeta = new Map();
  for (const filePath of candidates) {
    let info = null;
    if (trackedSet.has(filePath)) info = getCreationInfo(repoRootAbs, filePath);
    if (!info) info = await getFileSystemInfo(repoRootAbs, filePath);
    fileMeta.set(filePath, info);
  }

  const desiredTargets = new Map();
  for (const filePath of candidates) {
    const base = path.posix.basename(filePath);
    const baseName = base;
    const datePrefix = isDatePrefixedBaseName(baseName);
    const isCap = isCapitalizedDoc(baseName);

    const isRoot = !filePath.includes("/");
    const isInDocs = filePath.startsWith("docs/");

    if (isCap) {
      desiredTargets.set(filePath, filePath);
      continue;
    }

    if (isRoot) {
      // Root lowercase markdowns should live under docs/
      if (datePrefix) {
        desiredTargets.set(filePath, path.posix.join("docs", baseName));
        continue;
      }

      const meta = fileMeta.get(filePath);
      const date = meta?.date;
      if (!date) {
        desiredTargets.set(filePath, path.posix.join("docs", slugifyBaseName(baseName)));
        continue;
      }

      const slug = slugifyBaseName(baseName);
      desiredTargets.set(filePath, path.posix.join("docs", `${date}-${slug}`));
      continue;
    }

    if (isInDocs) {
      if (datePrefix) {
        desiredTargets.set(filePath, filePath);
        continue;
      }

      const meta = fileMeta.get(filePath);
      const date = meta?.date;
      if (!date) {
        desiredTargets.set(filePath, path.posix.join(path.posix.dirname(filePath), slugifyBaseName(baseName)));
        continue;
      }

      const slug = slugifyBaseName(baseName);
      desiredTargets.set(
        filePath,
        path.posix.join(path.posix.dirname(filePath), `${date}-${slug}`),
      );
      continue;
    }

    desiredTargets.set(filePath, filePath);
  }

  const renames = [];
  for (const [from, to] of desiredTargets.entries()) {
    if (from !== to) renames.push({ from, to });
  }

  const sourcesToRename = new Set(renames.map((r) => r.from));
  const occupied = new Set([...existingAllSet].filter((p) => !sourcesToRename.has(p)));

  const finalRenames = [];
  const renameMap = new Map();
  for (const { from, to } of renames) {
    const uniqueTo = uniqueTargetPath(to, occupied);
    occupied.add(uniqueTo);
    finalRenames.push({ type: "rename", from, to: uniqueTo });
    renameMap.set(from, uniqueTo);
  }

  const frontmatterAdds = [];
  for (const filePath of candidates) {
    const base = path.posix.basename(filePath);
    const targetPath = renameMap.get(filePath) ?? filePath;
    const targetBase = path.posix.basename(targetPath);
    const datePrefix = isDatePrefixedBaseName(targetBase);

    if (!datePrefix) continue;
    if (isCapitalizedDoc(base)) continue;

    const abs = path.join(repoRootAbs, ...targetPath.split("/"));
    let content;
    try {
      content = await fs.readFile(abs, "utf8");
    } catch {
      // File may be moved/renamed; read original if target doesn't exist yet.
      const absOld = path.join(repoRootAbs, ...filePath.split("/"));
      content = await fs.readFile(absOld, "utf8");
    }

    if (hasFrontmatter(content)) continue;

    const meta = fileMeta.get(filePath);
    const author = meta?.author ?? "Unknown <unknown@example.com>";
    const date = datePrefix;
    const title = titleFromMarkdown(content) ?? titleFromSlug(targetBase);
    frontmatterAdds.push({ type: "frontmatter", path: targetPath, title, author, date });
  }

  const actions = [...finalRenames, ...frontmatterAdds];

  return {
    repoRootAbs,
    repoRoot,
    trackedSet,
    dirty,
    actions,
  };
}

async function ensureParentDir(repoRootAbs, relPath) {
  const dir = path.dirname(path.join(repoRootAbs, ...relPath.split("/")));
  await fs.mkdir(dir, { recursive: true });
}

function gitMv(repoRootAbs, from, to) {
  runGit(["mv", "--", from, to], { cwd: repoRootAbs });
}

async function fsMv(repoRootAbs, from, to) {
  await ensureParentDir(repoRootAbs, to);
  const absFrom = path.join(repoRootAbs, ...from.split("/"));
  const absTo = path.join(repoRootAbs, ...to.split("/"));
  await fs.rename(absFrom, absTo);
}

async function writeFrontmatter(repoRootAbs, relPath, frontmatter) {
  const abs = path.join(repoRootAbs, ...relPath.split("/"));
  const content = await fs.readFile(abs, "utf8");
  if (hasFrontmatter(content)) return;
  const cleaned = content.replace(/^\uFEFF/, "");
  const separator = cleaned.startsWith("\n") ? "\n" : "\n\n";
  await fs.writeFile(abs, `${frontmatter}${separator}${cleaned}`, "utf8");
}

export async function runMigrationPlan(plan) {
  for (const action of plan.actions) {
    if (action.type !== "rename") continue;
    await ensureParentDir(plan.repoRootAbs, action.to);
    if (plan.trackedSet.has(action.from)) gitMv(plan.repoRootAbs, action.from, action.to);
    else await fsMv(plan.repoRootAbs, action.from, action.to);
  }

  for (const action of plan.actions) {
    if (action.type !== "frontmatter") continue;
    const frontmatter = buildFrontmatter({
      title: action.title,
      author: action.author,
      date: action.date,
    });
    await writeFrontmatter(plan.repoRootAbs, action.path, frontmatter);
  }
}
