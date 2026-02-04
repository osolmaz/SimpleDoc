import fs from "node:fs/promises";
import path from "node:path";

import { createGitClient, type GitClient } from "./git.js";
import { normalizeDocsRoot } from "./paths.js";

type FrontmatterDefaults = {
  author?: string;
  tags?: string[];
  titlePrefix?: string;
};

type SimpleLogConfig = {
  root?: string;
  thresholdMinutes?: number;
  timezone?: string;
};

type DocsConfig = {
  root?: string;
};

type CheckConfig = {
  ignore?: string[];
};

type FrontmatterConfig = {
  defaults?: FrontmatterDefaults;
};

export type SimpleDocConfig = {
  docs?: DocsConfig;
  frontmatter?: FrontmatterConfig;
  check?: CheckConfig;
  simplelog?: SimpleLogConfig;
};

export type ResolvedSimpleDocConfig = {
  repoRootAbs: string;
  docsRoot: string;
  frontmatterDefaults: FrontmatterDefaults;
  checkIgnore: string[];
  simplelog: {
    root: string;
    thresholdMinutes: number;
    timezone?: string;
  };
};

const DEFAULT_DOCS_ROOT = "docs";
const DEFAULT_SIMPLELOG_THRESHOLD_MINUTES = 5;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

function mergeConfig(
  base: SimpleDocConfig,
  override: SimpleDocConfig,
): SimpleDocConfig {
  const out: SimpleDocConfig = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = (out as Record<string, unknown>)[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      (out as Record<string, unknown>)[key] = mergeConfig(
        existing as SimpleDocConfig,
        value as SimpleDocConfig,
      );
    } else {
      (out as Record<string, unknown>)[key] = value as unknown;
    }
  }
  return out;
}

async function readConfigFile(
  absPath: string,
): Promise<SimpleDocConfig | null> {
  try {
    const raw = await fs.readFile(absPath, "utf8");
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    const data = JSON.parse(trimmed) as SimpleDocConfig;
    if (!isPlainObject(data))
      throw new Error("Config must be a JSON object at the top level.");
    return data;
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT")
      return null;
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read config ${absPath}: ${message}`);
  }
}

function normalizeRelPath(
  input: unknown,
  repoRootAbs: string,
  fallback: string,
  label: string,
): string {
  if (input === undefined) return fallback;
  if (typeof input !== "string") throw new Error(`${label} must be a string`);
  const trimmed = input.trim();
  if (!trimmed) return fallback;

  let relPath = trimmed;
  if (path.isAbsolute(relPath)) {
    const relative = path.relative(repoRootAbs, relPath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error(`Config path must be inside repo: ${relPath}`);
    relPath = relative;
  }

  relPath = relPath.replace(/\\/g, "/");
  relPath = relPath.replace(/^\.\//, "");
  relPath = relPath.replace(/\/+$/, "");
  relPath = path.posix.normalize(relPath);
  if (relPath === "." || relPath === "") return fallback;
  if (relPath.startsWith("../"))
    throw new Error(`Config path must be inside repo: ${relPath}`);
  return relPath;
}

function normalizeTags(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value))
    throw new Error("frontmatter.defaults.tags must be an array of strings");
  const tags = value
    .map((item) => {
      if (typeof item !== "string")
        throw new Error(
          "frontmatter.defaults.tags must be an array of strings",
        );
      return item.trim();
    })
    .filter((item) => item.length > 0);
  return tags.length > 0 ? tags : undefined;
}

function normalizeFrontmatterDefaults(value: unknown): FrontmatterDefaults {
  if (value === undefined) return {};
  if (!isPlainObject(value))
    throw new Error("frontmatter.defaults must be an object");
  const author =
    typeof value.author === "string"
      ? value.author.trim() || undefined
      : value.author === undefined
        ? undefined
        : (() => {
            throw new Error("frontmatter.defaults.author must be a string");
          })();
  const titlePrefix =
    typeof value.titlePrefix === "string"
      ? value.titlePrefix.trim() || undefined
      : value.titlePrefix === undefined
        ? undefined
        : (() => {
            throw new Error(
              "frontmatter.defaults.titlePrefix must be a string",
            );
          })();
  const tags = normalizeTags(value.tags);
  return { author, titlePrefix, tags };
}

function normalizeCheckIgnore(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new Error("check.ignore must be an array of strings");
  const patterns = value
    .map((item) => {
      if (typeof item !== "string")
        throw new Error("check.ignore must be an array of strings");
      return item.trim();
    })
    .filter((item) => item.length > 0);
  return patterns;
}

function normalizeThreshold(value: unknown): number {
  if (value === undefined) return DEFAULT_SIMPLELOG_THRESHOLD_MINUTES;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error("simplelog.thresholdMinutes must be a number >= 0");
  return value;
}

function normalizeOptionalString(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function assertPlainObjectOptional(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
}

export async function loadConfig(
  cwd: string,
  opts?: { git?: GitClient },
): Promise<ResolvedSimpleDocConfig> {
  const git = opts?.git ?? createGitClient();
  let repoRootAbs = cwd;
  try {
    repoRootAbs = await git.getRepoRoot(cwd);
  } catch {
    repoRootAbs = cwd;
  }

  const repoConfigPath = path.join(repoRootAbs, "simpledoc.json");
  const localConfigPath = path.join(repoRootAbs, ".simpledoc.local.json");

  const repoConfig = (await readConfigFile(repoConfigPath)) ?? {};
  const localConfig = (await readConfigFile(localConfigPath)) ?? {};
  const merged = mergeConfig(repoConfig, localConfig);

  assertPlainObjectOptional(merged.docs, "docs");
  assertPlainObjectOptional(merged.frontmatter, "frontmatter");
  assertPlainObjectOptional(
    merged.frontmatter?.defaults,
    "frontmatter.defaults",
  );
  assertPlainObjectOptional(merged.check, "check");
  assertPlainObjectOptional(merged.simplelog, "simplelog");

  const docsRoot = normalizeDocsRoot(
    normalizeRelPath(
      merged.docs?.root,
      repoRootAbs,
      DEFAULT_DOCS_ROOT,
      "docs.root",
    ),
  );
  const defaultSimplelogRoot = path.posix.join(docsRoot, "logs");
  const simplelogRoot = normalizeRelPath(
    merged.simplelog?.root,
    repoRootAbs,
    defaultSimplelogRoot,
    "simplelog.root",
  );
  const thresholdMinutes = normalizeThreshold(
    merged.simplelog?.thresholdMinutes,
  );
  const timezone = normalizeOptionalString(
    merged.simplelog?.timezone,
    "simplelog.timezone",
  );

  const frontmatterDefaults = normalizeFrontmatterDefaults(
    merged.frontmatter?.defaults,
  );
  const checkIgnore = normalizeCheckIgnore(merged.check?.ignore);

  return {
    repoRootAbs,
    docsRoot,
    frontmatterDefaults,
    checkIgnore,
    simplelog: {
      root: simplelogRoot,
      thresholdMinutes,
      timezone,
    },
  };
}
