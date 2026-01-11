import test from "node:test";
import assert from "node:assert/strict";

import {
  AGENTS_ATTENTION_LINE,
  AGENTS_FILE,
  SIMPLEDOC_SKILL_FILE,
  applyInstallationActions,
  getInstallationStatus,
} from "../../src/installer.js";
import { buildDefaultInstallActions } from "../../src/cli/install-helpers.js";
import { exists, makeTempRepo, readFile, writeFile } from "../helpers/repo.js";

test("installer: installs AGENTS.md and bundled skill on fresh repo", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  const status = await getInstallationStatus(repo.dir);
  const actions = await buildDefaultInstallActions(status);

  assert.deepEqual(
    actions.map((action) => `${action.type}:${action.path}`),
    [`write-file:${AGENTS_FILE}`, `write-file:${SIMPLEDOC_SKILL_FILE}`],
  );

  await applyInstallationActions(repo.dir, actions);

  assert.equal(await exists(repo.dir, AGENTS_FILE), true);
  assert.equal(await exists(repo.dir, SIMPLEDOC_SKILL_FILE), true);

  const agents = await readFile(repo.dir, AGENTS_FILE);
  assert.ok(agents.includes(AGENTS_ATTENTION_LINE));
});

test("installer: appends attention line when missing", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(repo.dir, AGENTS_FILE, "# Agent Instructions\n");
  await writeFile(repo.dir, SIMPLEDOC_SKILL_FILE, "# SimpleDoc skill\n");

  const status = await getInstallationStatus(repo.dir);
  const actions = await buildDefaultInstallActions(status);

  assert.deepEqual(
    actions.map((action) => action.type),
    ["append-line"],
  );

  await applyInstallationActions(repo.dir, actions);

  const agents = await readFile(repo.dir, AGENTS_FILE);
  assert.ok(agents.includes(AGENTS_ATTENTION_LINE));
});
