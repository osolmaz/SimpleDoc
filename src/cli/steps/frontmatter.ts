import type { FrontmatterAction } from "../../migrator.js";
import { formatActions } from "../../migrator.js";
import {
  limitLines,
  MAX_STEP_FILE_PREVIEW_LINES,
  noteWrapped,
  promptConfirm,
  promptText,
} from "../ui.js";

function getAuthorStats(
  actions: FrontmatterAction[],
): Array<[author: string, count: number]> {
  const counts = new Map<string, number>();
  for (const action of actions)
    counts.set(action.author, (counts.get(action.author) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) =>
    b[1] - a[1] ? b[1] - a[1] : a[0].localeCompare(b[0]),
  );
}

function summarizeAuthors(
  authorStats: Array<[author: string, count: number]>,
  maxAuthors: number,
): string {
  const lines: string[] = authorStats
    .slice(0, maxAuthors)
    .map(
      ([author, count]) =>
        `- ${author} (${count} file${count === 1 ? "" : "s"})`,
    );
  if (authorStats.length > maxAuthors)
    lines.push(`- …and ${authorStats.length - maxAuthors} more`);
  return lines.join("\n");
}

export async function runFrontmatterStep(opts: {
  actions: FrontmatterAction[];
  authorFlag?: string;
}): Promise<{
  include: boolean;
  authorRewrites: Record<string, string> | null;
} | null> {
  const { actions, authorFlag } = opts;
  if (actions.length === 0) return { include: false, authorRewrites: null };

  noteWrapped(
    `Date-prefixed docs missing YAML frontmatter (will get \`title\`, \`author\`, \`date\`):\n\n${limitLines(formatActions(actions), MAX_STEP_FILE_PREVIEW_LINES)}`,
    `Proposed: Insert missing YAML frontmatter (${actions.length})`,
  );

  const include = await promptConfirm(
    `Insert YAML frontmatter into ${actions.length} doc${actions.length === 1 ? "" : "s"} missing it?`,
    true,
  );
  if (include === null) return null;
  if (!include) return { include: false, authorRewrites: null };

  if (authorFlag) return { include: true, authorRewrites: null };

  const authorStats = getAuthorStats(actions);
  noteWrapped(
    summarizeAuthors(authorStats, 10),
    "Detected authors for inserted frontmatter (from git history)",
  );

  const useGit = await promptConfirm(
    "Use per-file git authors for inserted frontmatter?",
    true,
  );
  if (useGit === null) return null;
  if (useGit) return { include: true, authorRewrites: null };

  noteWrapped(
    `You'll now be prompted to replace each of the ${authorStats.length} detected authors. Press Enter to keep the original.`,
    "Author replacement",
  );

  const rewrites: Record<string, string> = {};
  for (const [author, count] of authorStats) {
    const replacement = await promptText(
      `Replacement for ${author} (${count} files)`,
      author,
    );
    if (replacement === null) return null;
    rewrites[author] = replacement;
  }
  return { include: true, authorRewrites: rewrites };
}
