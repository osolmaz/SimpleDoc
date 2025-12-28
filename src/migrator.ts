import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

type FileMeta = {
  dateIso: string;
  date: string;
  author: string;
  name: string;
  email: string;
};

export type RenameCaseMode = "lowercase" | "capitalized";

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

function isMarkdownFile(filePath: string): boolean {
  return filePath.endsWith(".md") || filePath.endsWith(".mdx");
}

function isLowercaseDocBaseName(baseName: string): boolean {
  const name = baseName.replace(/\.(md|mdx)$/i, "");
  return /[a-z]/.test(name) && !/[A-Z]/.test(name);
}

function isDatePrefixedBaseName(baseName: string): string | null {
  const name = baseName.replace(/\.(md|mdx)$/i, "");
  const m = name.match(/^(\d{4}-\d{2}-\d{2})(?:$|[-_\s])/);
  return m ? m[1] : null;
}

const ALWAYS_CAPITALIZED_STEMS = new Set<string>([
  "readme",
  "agents",
  "install",
  "ideas",
  "todo",
  "principles",
  "relevant",
  "review_prompt",
  "review-prompt",
  "jsend",
  "contributing",
  "code_of_conduct",
  "code-of-conduct",
  "security",
  "support",
  "changelog",
  "history",
  "news",
  "notice",
  "authors",
  "contributors",
  "maintainers",
  "governance",
  "license",
  "licenses",
  "copying",
  "copyright",
  "patents",
  "third_party_notices",
  "third-party-notices",
  "faq",
  "roadmap",
]);

function getAlwaysCapitalizedBaseName(baseName: string): string | null {
  const match = baseName.match(/\.(md|mdx)$/i);
  if (!match) return null;
  const dot = baseName.lastIndexOf(".");
  if (dot === -1) return null;
  const stem = baseName.slice(0, dot);
  const ext = baseName.slice(dot).toLowerCase();
  const lowerStem = stem.toLowerCase();
  if (ALWAYS_CAPITALIZED_STEMS.has(lowerStem))
    return `${normalizeCapitalizedStem(stem)}${ext}`;
  if (/^rfc[-_ ]?\d+/i.test(stem))
    return `${normalizeCapitalizedStem(stem)}${ext}`;
  return null;
}

function normalizeLowercaseStem(stem: string): string {
  return stem
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeCapitalizedStem(stem: string): string {
  const cleaned = stem
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/[^\p{L}\p{N}_]+/gu, "")
    .replace(/^_+|_+$/g, "");
  return cleaned.toLocaleUpperCase("en-US");
}

function parseDatePrefixedStem(
  stem: string,
): { date: string; rest: string } | null {
  const m = stem.match(/^(\d{4}-\d{2}-\d{2})(?:[-_\s]+(.*))?$/);
  if (!m) return null;
  return { date: m[1]!, rest: (m[2] ?? "").trim() };
}

function normalizeBaseName(baseName: string, mode: RenameCaseMode): string {
  const name = baseName.replace(/\.(md|mdx)$/i, "");
  const ext = baseName.slice(name.length).toLowerCase();
  const dateParts = parseDatePrefixedStem(name);
  if (dateParts) {
    const fallback = mode === "capitalized" ? "UNTITLED" : "untitled";
    const rest = dateParts.rest || fallback;
    const restNormalized =
      mode === "capitalized"
        ? normalizeCapitalizedStem(rest)
        : normalizeLowercaseStem(rest);
    return `${dateParts.date}-${restNormalized || fallback}${ext}`;
  }

  const normalizedStem =
    mode === "capitalized"
      ? normalizeCapitalizedStem(name)
      : normalizeLowercaseStem(name);
  return `${normalizedStem}${ext}`;
}

function applyRenameCase(baseName: string, mode: RenameCaseMode): string {
  return normalizeBaseName(baseName, mode);
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
      Boolean(getAlwaysCapitalizedBaseName(f)) ||
      Boolean(isDatePrefixedBaseName(f)) ||
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
  for (const filePath of candidates) {
    let info: FileMeta | null = null;
    if (trackedSet.has(filePath)) info = getCreationInfo(repoRootAbs, filePath);
    if (!info) info = await getFileSystemInfo(repoRootAbs, filePath);
    fileMeta.set(filePath, info);
  }

  const desiredTargets = new Map<string, string>();
  for (const filePath of candidates) {
    if (
      filePath === "docs/HOW_TO_DOC.md" ||
      filePath === "docs/HOW_TO_DOC.mdx"
    ) {
      desiredTargets.set(filePath, filePath);
      continue;
    }

    const base = path.posix.basename(filePath);
    const datePrefix = isDatePrefixedBaseName(base);
    const stem = base.replace(/\.(md|mdx)$/i, "");
    const isAllCapsStem = /[A-Z]/.test(stem) && !/[a-z]/.test(stem);

    const isRoot = !filePath.includes("/");
    const isInDocs = filePath.startsWith("docs/");

    if (includeCanonicalRenames) {
      const alwaysCapitalized = getAlwaysCapitalizedBaseName(base);
      if (alwaysCapitalized) {
        desiredTargets.set(
          filePath,
          path.posix.join(path.posix.dirname(filePath), alwaysCapitalized),
        );
        continue;
      }
    }

    if (isRoot) {
      if (!moveRootMarkdownToDocs) {
        desiredTargets.set(filePath, filePath);
        continue;
      }

      if (datePrefix) {
        const mode = getRenameCaseMode(filePath);
        const targetBase = normalizeDatePrefixedDocs
          ? applyRenameCase(base, mode)
          : base;
        desiredTargets.set(filePath, path.posix.join("docs", targetBase));
        continue;
      }

      const meta = fileMeta.get(filePath);
      const date = meta?.date;
      if (!date) {
        const mode = getRenameCaseMode(filePath);
        desiredTargets.set(
          filePath,
          path.posix.join("docs", applyRenameCase(base, mode)),
        );
        continue;
      }

      const mode = getRenameCaseMode(filePath);
      const slug = applyRenameCase(base, mode);
      desiredTargets.set(filePath, path.posix.join("docs", `${date}-${slug}`));
      continue;
    }

    if (isInDocs) {
      if (datePrefix) {
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

      if (isAllCapsStem) {
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

      if (!renameDocsToDatePrefix) {
        desiredTargets.set(filePath, filePath);
        continue;
      }

      const meta = fileMeta.get(filePath);
      const date = meta?.date;
      if (!date) {
        const mode = getRenameCaseMode(filePath);
        desiredTargets.set(
          filePath,
          path.posix.join(
            path.posix.dirname(filePath),
            applyRenameCase(base, mode),
          ),
        );
        continue;
      }

      const mode = getRenameCaseMode(filePath);
      const slug = applyRenameCase(base, mode);
      desiredTargets.set(
        filePath,
        path.posix.join(path.posix.dirname(filePath), `${date}-${slug}`),
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
      const datePrefix = isDatePrefixedBaseName(targetBase);

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

      const meta = fileMeta.get(filePath);
      const author = meta?.author ?? "Unknown <unknown@example.com>";
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
    for (const filePath of existingOnDisk) {
      const abs = path.join(repoRootAbs, ...filePath.split("/"));
      let content: string;
      try {
        content = await fs.readFile(abs, "utf8");
      } catch {
        continue;
      }

      if (content.includes("\0")) continue;
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
  const needsTwoPhase = renames.some((r) => fromSet.has(r.to));

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
        const abs = path.join(plan.repoRootAbs, ...action.path.split("/"));
        let content: string;
        try {
          content = await fs.readFile(abs, "utf8");
        } catch {
          continue;
        }
        if (content.includes("\0")) continue;
        const next = content.replace(regex, (match) => {
          return replacementMap.get(match) ?? match;
        });
        if (next !== content) await fs.writeFile(abs, next, "utf8");
      }
    }
  }
}
