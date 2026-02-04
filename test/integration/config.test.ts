import test from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "../../src/config.js";
import { makeTempRepo, writeFile } from "../helpers/repo.js";

test("config: merges repo and local overrides", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(
    repo.dir,
    "simpledoc.json",
    JSON.stringify(
      {
        docs: { root: "documentation" },
        frontmatter: { defaults: { author: "Repo <repo@example.com>" } },
        check: { ignore: ["docs/generated/**"] },
        simplelog: { thresholdMinutes: 7 },
      },
      null,
      2,
    ) + "\n",
  );

  await writeFile(
    repo.dir,
    ".simpledoc.local.json",
    JSON.stringify(
      {
        frontmatter: {
          defaults: { author: "Local <local@example.com>" },
        },
        simplelog: { root: "docs/logs/_local/alice", thresholdMinutes: 2 },
      },
      null,
      2,
    ) + "\n",
  );

  const config = await loadConfig(repo.dir);
  assert.equal(config.docsRoot, "documentation");
  assert.equal(config.simplelog.root, "docs/logs/_local/alice");
  assert.equal(config.simplelog.thresholdMinutes, 2);
  assert.equal(config.frontmatterDefaults.author, "Local <local@example.com>");
  assert.deepEqual(config.checkIgnore, ["docs/generated/**"]);
});

test("config: defaults simplelog root to docs root", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(
    repo.dir,
    "simpledoc.json",
    JSON.stringify({ docs: { root: "documentation" } }, null, 2) + "\n",
  );

  const config = await loadConfig(repo.dir);
  assert.equal(config.docsRoot, "documentation");
  assert.equal(config.simplelog.root, "documentation/logs");
});

test("config: rejects invalid value types", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(
    repo.dir,
    "simpledoc.json",
    JSON.stringify(
      {
        docs: { root: 123 },
        check: { ignore: "docs/generated/**" },
        simplelog: { thresholdMinutes: "5" },
      },
      null,
      2,
    ) + "\n",
  );

  await assert.rejects(
    () => loadConfig(repo.dir),
    /docs\.root must be a string/,
  );
});

test("config: rejects invalid nested values", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(
    repo.dir,
    "simpledoc.json",
    JSON.stringify(
      {
        frontmatter: { defaults: { author: 42, tags: ["ok", 1] } },
      },
      null,
      2,
    ) + "\n",
  );

  await assert.rejects(
    () => loadConfig(repo.dir),
    /frontmatter\.defaults\.author must be a string/,
  );
});
