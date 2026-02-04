import test from "node:test";
import assert from "node:assert/strict";

import { runLog } from "../../src/cli/log.js";
import { parseFrontmatterBlock } from "../../src/frontmatter.js";
import { makeTempRepo, readFile, writeFile } from "../helpers/repo.js";

async function withMockedDate(
  iso: string,
  fn: () => Promise<void>,
): Promise<void> {
  const RealDate = Date;
  const fixed = new RealDate(iso);
  const fixedMs = fixed.getTime();
  class MockDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        super(fixedMs);
        return;
      }
      if (args.length === 1) {
        super(args[0] as string | number | Date);
        return;
      }
      const [year, month, date, hours, minutes, seconds, ms] = args as number[];
      super(year, month, date, hours, minutes, seconds, ms);
    }

    static now(): number {
      return fixedMs;
    }
  }

  globalThis.Date = MockDate as DateConstructor;
  try {
    await fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

test("log: starts a new section after the threshold", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(
    repo.dir,
    "simpledoc.json",
    JSON.stringify(
      {
        simplelog: {
          root: "docs/logs",
          timezone: "UTC",
          thresholdMinutes: 5,
        },
        frontmatter: { defaults: { author: "Test <test@example.com>" } },
      },
      null,
      2,
    ) + "\n",
  );

  const originalCwd = process.cwd();
  t.after(() => process.chdir(originalCwd));
  process.chdir(repo.dir);

  await withMockedDate("2026-02-04T12:00:00Z", async () => {
    await runLog("First entry", {});
  });

  await withMockedDate("2026-02-04T12:03:00Z", async () => {
    await runLog("Second entry", {});
  });

  await withMockedDate("2026-02-04T12:10:00Z", async () => {
    await runLog("Third entry", {});
  });

  const content = await readFile(repo.dir, "docs/logs/2026-02-04.md");
  const sectionCount = (content.match(/^## /gm) ?? []).length;
  assert.equal(sectionCount, 2);
  assert.match(content, /^## 12:00/m);
  assert.match(content, /^## 12:10/m);
  assert.match(content, /First entry/);
  assert.match(content, /Second entry/);
  assert.match(content, /Third entry/);

  const parsed = parseFrontmatterBlock(content);
  assert.equal(parsed.data.last_section, "2026-02-04T12:10:00Z");
});
