import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";

import { runInstall } from "../../src/cli/install.js";
import { exists, makeTempRepo } from "../helpers/repo.js";

test("install: writes AGENTS.md and bundled skill", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  const cwd = process.cwd();
  t.after(() => {
    process.chdir(cwd);
  });

  process.chdir(repo.dir);
  await runInstall({ dryRun: false, yes: true });

  assert.equal(await exists(repo.dir, "AGENTS.md"), true);
  assert.equal(await exists(repo.dir, "skills/simpledoc/SKILL.md"), true);
});
