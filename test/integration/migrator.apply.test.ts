import test from "node:test";
import assert from "node:assert/strict";

import { planMigration, runMigrationPlan } from "../../src/migrator.js";
import {
  commitAll,
  exists,
  makeTempRepo,
  readFile,
  writeFile,
} from "../helpers/repo.js";

test("apply: renames docs and updates references", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(
    repo.dir,
    "README.md",
    "See docs/TEST-FILE.md and ./docs/TEST-FILE.md\n",
  );
  await writeFile(repo.dir, "docs/TEST-FILE.md", "# Hello\n");
  commitAll(repo.dir, {
    message: "Add docs + reference",
    author: "Alice <alice@example.com>",
    dateIso: "2024-01-15T12:00:00Z",
  });

  const plan = await planMigration({ cwd: repo.dir });
  await runMigrationPlan(plan, { authorOverride: null, authorRewrites: null });

  assert.equal(await exists(repo.dir, "docs/TEST-FILE.md"), false);
  assert.equal(await exists(repo.dir, "docs/TEST_FILE.md"), true);

  const readme = await readFile(repo.dir, "README.md");
  assert.match(readme, /docs\/TEST_FILE\.md/);
  assert.match(readme, /\.\/docs\/TEST_FILE\.md/);
  assert.doesNotMatch(readme, /docs\/TEST-FILE\.md/);
});

test("apply: inserts frontmatter using git author and date prefix", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(repo.dir, "docs/2024-03-02-some-doc.md", "# Hello\n\nBody\n");
  commitAll(repo.dir, {
    message: "Add date-prefixed doc",
    author: "Alice <alice@example.com>",
    dateIso: "2024-04-01T12:00:00Z",
  });

  const plan = await planMigration({ cwd: repo.dir });
  await runMigrationPlan(plan, { authorOverride: null, authorRewrites: null });

  const doc = await readFile(repo.dir, "docs/2024-03-02-some-doc.md");
  assert.ok(doc.startsWith("---\n"));
  assert.match(doc, /title: "Hello"/);
  assert.match(doc, /author: "Alice <alice@example\.com>"/);
  assert.match(doc, /date: "2024-03-02"/);
});

test("apply: uses frontmatter defaults for author, tags, and title prefix", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(repo.dir, "docs/2024-03-02-some-doc.md", "Body\n");
  commitAll(repo.dir, {
    message: "Add date-prefixed doc",
    author: "Alice <alice@example.com>",
    dateIso: "2024-04-01T12:00:00Z",
  });

  const plan = await planMigration({
    cwd: repo.dir,
    frontmatterDefaults: {
      author: "Default <default@example.com>",
      tags: ["alpha", "beta"],
      titlePrefix: "Note",
    },
  });
  await runMigrationPlan(plan, { authorOverride: null, authorRewrites: null });

  const doc = await readFile(repo.dir, "docs/2024-03-02-some-doc.md");
  assert.match(doc, /title: "Note Some Doc"/);
  assert.match(doc, /author: "Default <default@example\.com>"/);
  assert.match(doc, /tags: \["alpha", "beta"\]/);
});
