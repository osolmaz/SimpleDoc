import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { classifyDoc } from "./doc-classifier.js";
import type { RenameCaseMode } from "./naming.js";
import {
  applyRenameCase,
  extractDatePrefix,
  getCanonicalBaseName,
  isLowercaseDocBaseName,
  isMarkdownFile,
} from "./naming.js";

type FileMeta = {
  dateIso: string;
  date: string;
  author: string;
  name: string;
  email: string;
};

export type { RenameCaseMode } from "./naming.js";

export type RenameAction = { type: "rename"; from: string; to: string };
export type ReferenceUpdateAction = {
  type: "references";
  path: string;
  matchCount: number;
};
export type FrontmatterAction = {
  type: "frontmatter";
  path: string;
  title: string;
  author: string;
  date: string;
};
export type MigrationAction =
  | RenameAction
  | FrontmatterAction
  | ReferenceUpdateAction;

export type MigrationPlan = {
  repoRootAbs: string;
  repoRoot: string;
  trackedSet: Set<string>;
  dirty: boolean;
  actions: MigrationAction[];
};

function runGit(args: string[], { cwd }: { cwd: string }): string {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (res.error) throw res.error;
  if (res.status !== 0) {
    const msg = (res.stderr || res.stdout || "").trim();
    throw new Error(
      msg || `git ${args.join(" ")} failed with code ${res.status}`,
    );
  }
  return res.stdout;
}

function runGitGrep(args: string[], { cwd }: { cwd: string }): string {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (res.error) throw res.error;
  if (res.status === 0) return res.stdout;
  if (res.status === 1) return "";

  const msg = (res.stderr || res.stdout || "").trim();
  throw new Error(
    msg || `git ${args.join(" ")} failed with code ${res.status}`,
  );
}

function gitGrepFiles(repoRootAbs: string, patterns: string[]): string[] {
  if (patterns.length === 0) return [];
  const out = new Set<string>();
  const chunkSize = 64;

  for (let i = 0; i < patterns.length; i += chunkSize) {
    const chunk = patterns.slice(i, i + chunkSize);
    const stdout = runGitGrep(
      ["grep", "-l", "-F", "-z", ...chunk.flatMap((p) => ["-e", p]), "--"],
      { cwd: repoRootAbs },
    );
    for (const filePath of stdout.split("\0").filter(Boolean))
      out.add(filePath.trim());
  }

  return [...out];
}

function getRepoRoot(cwd: string): string {
  const res = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (res.error) throw res.error;
  if (res.status !== 0)
    throw new Error("Not a git repository (or git is not available).");
  return res.stdout.trim();
}

function isDirty(cwd: string): boolean {
  const out = runGit(["status", "--porcelain"], { cwd });
  return out.trim().length > 0;
}

function titleFromSlug(slug: string): string {
  const words = slug
    .replace(/\.(md|mdx)$/i, "")
    .replace(/^\d{4}-\d{2}-\d{2}[-_\s]+/, "")
    .split(/[-_\s]+/)
    .filter(Boolean);
  if (words.length === 0) return "Untitled";
  return words
    .map((w) => (w ? w[0]!.toLocaleUpperCase("en-US") + w.slice(1) : w))
    .join(" ");
}

function titleFromMarkdown(content: string): string | null {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^#\s+(.+)\s*$/);
    if (m) return m[1]!.trim();
    if (line.trim() !== "") break;
  }
  return null;
}

function hasFrontmatter(content: string): boolean {
  const s = content.replace(/^\uFEFF/, "");
  if (!s.startsWith("---\n") && !s.startsWith("---\r\n")) return false;
  const end = s.indexOf("\n---", 4);
  if (end === -1) return false;
  const after = s.slice(end + 1);
  return after.startsWith("---\n") || after.startsWith("---\r\n");
}

function yamlQuote(value: string): string {
  const s = String(value).replace(/\r?\n/g, " ").trim();
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type ReferenceReplacement = { from: string; to: string };

function buildReferenceReplacements(
  renames: RenameAction[],
): ReferenceReplacement[] {
  const replacements = new Map<string, string>();
  for (const rename of renames) {
    replacements.set(rename.from, rename.to);
    replacements.set(`./${rename.from}`, `./${rename.to}`);
    replacements.set(`../${rename.from}`, `../${rename.to}`);
  }
  return [...replacements.entries()].map(([from, to]) => ({ from, to }));
}

function buildReplacementRegex(
  replacements: ReferenceReplacement[],
): RegExp | null {
  if (replacements.length === 0) return null;
  const pattern = replacements
    .map((r) => r.from)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  return new RegExp(pattern, "g");
}

function countMatches(content: string, regex: RegExp): number {
  const matches = content.match(regex);
  return matches ? matches.length : 0;
}

const MAX_REFERENCE_UPDATE_BYTES = 1_000_000;
const REFERENCE_IGNORE_DIR_PREFIXES = [
  "node_modules/",
  "dist/",
  "dist-test/",
  ".git/",
];
const REFERENCE_IGNORE_EXTENSIONS = new Set<string>([
  ".7z",
  ".avi",
  ".bmp",
  ".class",
  ".dll",
  ".dmg",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".mkv",
  ".mov",
  ".mp3",
  ".mp4",
  ".o",
  ".otf",
  ".pdf",
  ".png",
  ".so",
  ".tar",
  ".tgz",
  ".tiff",
  ".ttf",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
]);

function shouldScanForReferenceUpdates(relPath: string): boolean {
  for (const prefix of REFERENCE_IGNORE_DIR_PREFIXES) {
    if (relPath.startsWith(prefix)) return false;
  }
  const ext = path.posix.extname(relPath).toLowerCase();
  if (REFERENCE_IGNORE_EXTENSIONS.has(ext)) return false;
  return true;
}

async function readSmallTextFileForReferences(
  repoRootAbs: string,
  relPath: string,
): Promise<string | null> {
  if (!shouldScanForReferenceUpdates(relPath)) return null;

  const abs = path.join(repoRootAbs, ...relPath.split("/"));
  let stat: { size: number };
  try {
    stat = await fs.stat(abs);
  } catch {
    return null;
  }
  if (stat.size > MAX_REFERENCE_UPDATE_BYTES) return null;

  let content: string;
  try {
    content = await fs.readFile(abs, "utf8");
  } catch {
    return null;
  }
  if (content.includes("\0")) return null;

  return content;
}

function buildFrontmatter({
  title,
  author,
  date,
}: {
  title: string;
  author: string;
  date: string;
}): string {
  return [
    "---",
    `title: ${yamlQuote(title)}`,
    `author: ${yamlQuote(author)}`,
    `date: ${yamlQuote(date)}`,
    "---",
  ].join("\n");
}

function getCreationInfo(cwd: string, filePath: string): FileMeta | null {
  const out = runGit(
    ["log", "--follow", "--format=%aI\t%aN\t%aE", "--", filePath],
    { cwd },
  );
  const lines = out.trim().split("\n").filter(Boolean);
  if (lines.length === 0) return null;
  const [dateIso, name, email] = lines[lines.length - 1]!.split("\t");
  const date = dateIso!.slice(0, 10);
  const author = email ? `${name} <${email}>` : name!;
  return { dateIso: dateIso!, date, author, name: name!, email: email ?? "" };
}

async function getFileSystemInfo(
  repoRootAbs: string,
  filePath: string,
): Promise<FileMeta> {
  const abs = path.join(repoRootAbs, ...filePath.split("/"));
  const stat = await fs.stat(abs);
  const dateIso =
    stat.birthtime && Number.isFinite(stat.birthtimeMs) && stat.birthtimeMs > 0
      ? stat.birthtime.toISOString()
      : stat.mtime.toISOString();
  const date = dateIso.slice(0, 10);
  return {
    dateIso,
    date,
    author: "Unknown <unknown@example.com>",
    name: "Unknown",
    email: "",
  };
}

function parsePathParts(relPath: string): {
  dir: string;
  base: string;
  name: string;
  ext: string;
} {
  const dir = path.posix.dirname(relPath);
  const base = path.posix.basename(relPath);
  const dot = base.lastIndexOf(".");
  const ext = dot === -1 ? "" : base.slice(dot);
  const name = dot === -1 ? base : base.slice(0, dot);
  return { dir: dir === "." ? "" : dir, base, name, ext };
}

function uniqueTargetPath(
  preferredRelPath: string,
  occupied: Set<string>,
): string {
  if (!occupied.has(preferredRelPath)) return preferredRelPath;
  const { dir, name, ext } = parsePathParts(preferredRelPath);
  for (let i = 2; i < 10_000; i++) {
    const candidate = path.posix.join(dir, `${name}-${i}${ext}`);
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error(`Unable to find a unique filename for: ${preferredRelPath}`);
}

async function pathExists(
  repoRootAbs: string,
  relPath: string,
): Promise<boolean> {
  try {
    const abs = path.join(repoRootAbs, ...relPath.split("/"));
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

async function uniqueTempPath(
  repoRootAbs: string,
  fromRelPath: string,
  occupied: Set<string>,
): Promise<string> {
  const { dir, base } = parsePathParts(fromRelPath);
  for (let i = 1; i < 10_000; i++) {
    const suffix = i === 1 ? ".simpledoc-tmp" : `.simpledoc-tmp-${i}`;
    const candidate = path.posix.join(dir, `${base}${suffix}`);
    if (occupied.has(candidate)) continue;
    if (await pathExists(repoRootAbs, candidate)) continue;
    return candidate;
  }
  throw new Error(
    `Unable to allocate a temporary filename for: ${fromRelPath}`,
  );
}

async function listRootFiles(repoRootAbs: string): Promise<string[]> {
  const entries = await fs.readdir(repoRootAbs, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => !name.startsWith("."));
}

function toPosixRelPath(p: string): string {
  return p.split(path.sep).join(path.posix.sep);
}

export function formatActions(actions: MigrationAction[]): string {
  const lines: string[] = [];
  for (const action of actions) {
    if (action.type === "rename")
      lines.push(`- rename: ${action.from} -> ${action.to}`);
    else if (action.type === "frontmatter")
      lines.push(`- frontmatter: ${action.path}`);
    else if (action.type === "references")
      lines.push(`- update references: ${action.path} (${action.matchCount})`);
    else {
      const exhaustiveCheck: never = action;
      throw new Error(`Unknown action: ${String(exhaustiveCheck)}`);
    }
  }
  return lines.join("\n");
}

export type MigrationPlanOptions = {
  cwd?: string;
  moveRootMarkdownToDocs?: boolean;
  renameDocsToDatePrefix?: boolean;
  addFrontmatter?: boolean;
  renameCaseOverrides?: Record<string, RenameCaseMode>;
  includeCanonicalRenames?: boolean;
  normalizeDatePrefixedDocs?: boolean;
};

export async function planMigration(
  options: MigrationPlanOptions = {},
): Promise<MigrationPlan> {
  const cwd = options.cwd ?? process.cwd();
  const moveRootMarkdownToDocs = options.moveRootMarkdownToDocs ?? true;
  const renameDocsToDatePrefix = options.renameDocsToDatePrefix ?? true;
  const addFrontmatter = options.addFrontmatter ?? true;
  const renameCaseOverrides = options.renameCaseOverrides ?? {};
  const includeCanonicalRenames = options.includeCanonicalRenames ?? true;
  const normalizeDatePrefixedDocs = options.normalizeDatePrefixedDocs ?? true;

  const getRenameCaseMode = (filePath: string): RenameCaseMode =>
    renameCaseOverrides[filePath] ?? "lowercase";

  const repoRootAbs = getRepoRoot(cwd);
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
    return (
      Boolean(getCanonicalBaseName(f)) ||
      Boolean(extractDatePrefix(f)) ||
      isLowercaseDocBaseName(f)
    );
  });

  const existingAll = runGit(
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: repoRootAbs,
    },
  )
    .split("\0")
    .filter(Boolean)
    .map((p) => p.trim());
  const existingOnDisk: string[] = [];
  for (const filePath of existingAll) {
    if (await pathExists(repoRootAbs, filePath)) existingOnDisk.push(filePath);
  }
  const existingAllSet = new Set(existingOnDisk);

  const docsMarkdown = existingOnDisk.filter(
    (p) => p.startsWith("docs/") && isMarkdownFile(p),
  );
  const candidates = [...new Set([...rootMarkdown, ...docsMarkdown])];

  const fileMeta = new Map<string, FileMeta>();
  const getMeta = async (filePath: string): Promise<FileMeta> => {
    const cached = fileMeta.get(filePath);
    if (cached) return cached;

    let info: FileMeta | null = null;
    if (trackedSet.has(filePath)) info = getCreationInfo(repoRootAbs, filePath);
    if (!info) info = await getFileSystemInfo(repoRootAbs, filePath);
    fileMeta.set(filePath, info);
    return info;
  };

  const desiredTargets = new Map<string, string>();
  for (const filePath of candidates) {
    const classification = classifyDoc(filePath);
    const base = classification.baseName;

    if (classification.kind === "installer") {
      desiredTargets.set(filePath, filePath);
      continue;
    }

    if (classification.kind === "canonical") {
      if (!includeCanonicalRenames || !classification.canonicalBaseName) {
        desiredTargets.set(filePath, filePath);
        continue;
      }
      const target = path.posix.join(
        path.posix.dirname(filePath),
        classification.canonicalBaseName,
      );
      desiredTargets.set(filePath, target);
      continue;
    }

    if (classification.location === "root") {
      if (!moveRootMarkdownToDocs) {
        desiredTargets.set(filePath, filePath);
        continue;
      }

      if (classification.kind === "date-prefixed") {
        const mode = getRenameCaseMode(filePath);
        const targetBase = normalizeDatePrefixedDocs
          ? applyRenameCase(base, mode)
          : base;
        desiredTargets.set(filePath, path.posix.join("docs", targetBase));
        continue;
      }

      if (classification.kind === "regular") {
        const meta = await getMeta(filePath);
        const mode = getRenameCaseMode(filePath);
        const slug = applyRenameCase(base, mode);
        desiredTargets.set(
          filePath,
          path.posix.join("docs", `${meta.date}-${slug}`),
        );
        continue;
      }
    }

    if (classification.location === "docs") {
      if (classification.kind === "date-prefixed") {
        if (!normalizeDatePrefixedDocs) {
          desiredTargets.set(filePath, filePath);
          continue;
        }
        const mode = getRenameCaseMode(filePath);
        const targetBase = applyRenameCase(base, mode);
        const targetPath = path.posix.join(
          path.posix.dirname(filePath),
          targetBase,
        );
        desiredTargets.set(filePath, targetPath);
        continue;
      }

      if (classification.kind === "capitalized") {
        if (!includeCanonicalRenames) {
          desiredTargets.set(filePath, filePath);
          continue;
        }

        const targetBase = applyRenameCase(base, "capitalized");
        desiredTargets.set(
          filePath,
          path.posix.join(path.posix.dirname(filePath), targetBase),
        );
        continue;
      }

      if (classification.kind !== "regular" || !renameDocsToDatePrefix) {
        desiredTargets.set(filePath, filePath);
        continue;
      }

      const meta = await getMeta(filePath);
      const mode = getRenameCaseMode(filePath);
      const slug = applyRenameCase(base, mode);
      desiredTargets.set(
        filePath,
        path.posix.join(path.posix.dirname(filePath), `${meta.date}-${slug}`),
      );
      continue;
    }

    desiredTargets.set(filePath, filePath);
  }

  const renames: Array<{ from: string; to: string }> = [];
  for (const [from, to] of desiredTargets.entries()) {
    if (from !== to) renames.push({ from, to });
  }

  const sourcesToRename = new Set(renames.map((r) => r.from));
  const occupied = new Set(
    [...existingAllSet].filter((p) => !sourcesToRename.has(p)),
  );

  const finalRenames: RenameAction[] = [];
  const renameMap = new Map<string, string>();
  for (const { from, to } of renames) {
    const uniqueTo = uniqueTargetPath(to, occupied);
    occupied.add(uniqueTo);
    finalRenames.push({ type: "rename", from, to: uniqueTo });
    renameMap.set(from, uniqueTo);
  }

  const frontmatterAdds: FrontmatterAction[] = [];
  if (addFrontmatter) {
    for (const filePath of candidates) {
      const targetPath = renameMap.get(filePath) ?? filePath;
      const targetBase = path.posix.basename(targetPath);
      const datePrefix = extractDatePrefix(targetBase);

      if (!datePrefix) continue;

      const absTarget = path.join(repoRootAbs, ...targetPath.split("/"));
      let content: string | null = null;
      try {
        content = await fs.readFile(absTarget, "utf8");
      } catch {
        const absOld = path.join(repoRootAbs, ...filePath.split("/"));
        try {
          content = await fs.readFile(absOld, "utf8");
        } catch {
          content = null;
        }
      }
      if (!content) continue;

      if (hasFrontmatter(content)) continue;

      const meta = await getMeta(filePath);
      const author = meta.author ?? "Unknown <unknown@example.com>";
      const date = datePrefix;
      const title = titleFromMarkdown(content) ?? titleFromSlug(targetBase);
      frontmatterAdds.push({
        type: "frontmatter",
        path: targetPath,
        title,
        author,
        date,
      });
    }
  }

  const actions: MigrationAction[] = [...finalRenames, ...frontmatterAdds];
  const referenceUpdates: ReferenceUpdateAction[] = [];
  const referenceReplacements = buildReferenceReplacements(finalRenames);
  const referenceRegex = buildReplacementRegex(referenceReplacements);

  if (referenceRegex) {
    const searchStrings = [...new Set(finalRenames.map((r) => r.from))];
    const candidatesForScan = new Set<string>();
    for (const filePath of gitGrepFiles(repoRootAbs, searchStrings))
      candidatesForScan.add(filePath);
    for (const filePath of existingOnDisk) {
      if (trackedSet.has(filePath)) continue;
      candidatesForScan.add(filePath);
    }

    for (const filePath of candidatesForScan) {
      const content = await readSmallTextFileForReferences(
        repoRootAbs,
        filePath,
      );
      if (!content) continue;
      const matchCount = countMatches(content, referenceRegex);
      if (matchCount === 0) continue;
      const targetPath = renameMap.get(filePath) ?? filePath;
      referenceUpdates.push({
        type: "references",
        path: targetPath,
        matchCount,
      });
    }
  }

  actions.push(...referenceUpdates);

  return {
    repoRootAbs,
    repoRoot,
    trackedSet,
    dirty,
    actions,
  };
}

async function ensureParentDir(
  repoRootAbs: string,
  relPath: string,
): Promise<void> {
  const dir = path.dirname(path.join(repoRootAbs, ...relPath.split("/")));
  await fs.mkdir(dir, { recursive: true });
}

function gitMv(repoRootAbs: string, from: string, to: string): void {
  runGit(["mv", "--", from, to], { cwd: repoRootAbs });
}

async function fsMv(
  repoRootAbs: string,
  from: string,
  to: string,
): Promise<void> {
  await ensureParentDir(repoRootAbs, to);
  const absFrom = path.join(repoRootAbs, ...from.split("/"));
  const absTo = path.join(repoRootAbs, ...to.split("/"));
  await fs.rename(absFrom, absTo);
}

async function writeFrontmatter(
  repoRootAbs: string,
  relPath: string,
  frontmatter: string,
): Promise<void> {
  const abs = path.join(repoRootAbs, ...relPath.split("/"));
  const content = await fs.readFile(abs, "utf8");
  if (hasFrontmatter(content)) return;
  const cleaned = content.replace(/^\uFEFF/, "");
  const separator = cleaned.startsWith("\n") ? "\n" : "\n\n";
  await fs.writeFile(abs, `${frontmatter}${separator}${cleaned}`, "utf8");
}

async function applyRenames(
  plan: MigrationPlan,
  renames: RenameAction[],
): Promise<void> {
  const fromSet = new Set(renames.map((r) => r.from));
  const fromSetLower = new Set([...fromSet].map((p) => p.toLowerCase()));
  const needsTwoPhase = renames.some((r) =>
    fromSetLower.has(r.to.toLowerCase()),
  );

  const move = async (
    from: string,
    to: string,
    tracked: boolean,
  ): Promise<void> => {
    await ensureParentDir(plan.repoRootAbs, to);
    if (tracked) gitMv(plan.repoRootAbs, from, to);
    else await fsMv(plan.repoRootAbs, from, to);
  };

  if (!needsTwoPhase) {
    for (const r of renames)
      await move(r.from, r.to, plan.trackedSet.has(r.from));
    return;
  }

  const occupied = new Set<string>([...fromSet, ...renames.map((r) => r.to)]);
  const tempByFrom = new Map<string, string>();
  for (const r of renames) {
    const tmp = await uniqueTempPath(plan.repoRootAbs, r.from, occupied);
    occupied.add(tmp);
    tempByFrom.set(r.from, tmp);
  }

  for (const r of renames) {
    const tmp = tempByFrom.get(r.from);
    if (!tmp)
      throw new Error(`Internal error: missing temp name for ${r.from}`);
    await move(r.from, tmp, plan.trackedSet.has(r.from));
  }

  for (const r of renames) {
    const tmp = tempByFrom.get(r.from);
    if (!tmp)
      throw new Error(`Internal error: missing temp name for ${r.from}`);
    await move(tmp, r.to, plan.trackedSet.has(r.from));
  }
}

export async function runMigrationPlan(
  plan: MigrationPlan,
  options?: {
    authorOverride?: string | null;
    authorRewrites?: Record<string, string> | null;
  },
): Promise<void> {
  const renames = plan.actions.filter(
    (a): a is RenameAction => a.type === "rename",
  );
  const frontmatters = plan.actions.filter(
    (a): a is FrontmatterAction => a.type === "frontmatter",
  );
  const referenceUpdates = plan.actions.filter(
    (a): a is ReferenceUpdateAction => a.type === "references",
  );

  if (renames.length > 0) await applyRenames(plan, renames);

  for (const action of frontmatters) {
    const author =
      options?.authorOverride ??
      options?.authorRewrites?.[action.author] ??
      action.author;
    const frontmatter = buildFrontmatter({
      title: action.title,
      author,
      date: action.date,
    });
    await writeFrontmatter(plan.repoRootAbs, action.path, frontmatter);
  }

  if (referenceUpdates.length > 0) {
    const replacements = buildReferenceReplacements(renames);
    const regex = buildReplacementRegex(replacements);
    if (regex) {
      const replacementMap = new Map(
        replacements.map((pair) => [pair.from, pair.to]),
      );
      for (const action of referenceUpdates) {
        const content = await readSmallTextFileForReferences(
          plan.repoRootAbs,
          action.path,
        );
        if (!content) continue;
        const next = content.replace(regex, (match) => {
          return replacementMap.get(match) ?? match;
        });
        if (next !== content) {
          const abs = path.join(plan.repoRootAbs, ...action.path.split("/"));
          await fs.writeFile(abs, next, "utf8");
        }
      }
    }
  }
}
