import test from "node:test";
import assert from "node:assert/strict";

import { planMigration } from "../../src/migrator.js";
import { commitAll, makeTempRepo, writeFile } from "../helpers/repo.js";

test("plan: normalizes capitalized docs under docs/ (no date prefix)", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(repo.dir, "docs/TEST-FILE.md", "# Hello\n");
  commitAll(repo.dir, {
    message: "Add TEST-FILE",
    author: "Alice <alice@example.com>",
    dateIso: "2024-01-15T12:00:00Z",
  });

  const plan = await planMigration({ cwd: repo.dir });
  const renames = plan.actions.filter((a) => a.type === "rename");
  assert.deepEqual(renames, [
    {
      type: "rename",
      from: "docs/TEST-FILE.md",
      to: "docs/TEST_FILE.md",
    },
  ]);
});

test("plan: can override capitalized docs to lowercase (no date prefix)", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(repo.dir, "docs/TEST-FILE.md", "# Hello\n");
  commitAll(repo.dir, {
    message: "Add TEST-FILE",
    author: "Alice <alice@example.com>",
    dateIso: "2024-01-15T12:00:00Z",
  });

  const plan = await planMigration({
    cwd: repo.dir,
    renameCaseOverrides: { "docs/TEST-FILE.md": "lowercase" },
  });
  const renames = plan.actions.filter((a) => a.type === "rename");
  assert.deepEqual(renames, [
    {
      type: "rename",
      from: "docs/TEST-FILE.md",
      to: "docs/test-file.md",
    },
  ]);
});

test("plan: can skip capitalized/canonical renames", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(repo.dir, "docs/TEST-FILE.md", "# Hello\n");
  commitAll(repo.dir, {
    message: "Add TEST-FILE",
    author: "Alice <alice@example.com>",
    dateIso: "2024-01-15T12:00:00Z",
  });

  const plan = await planMigration({
    cwd: repo.dir,
    includeCanonicalRenames: false,
  });
  const renames = plan.actions.filter((a) => a.type === "rename");
  assert.deepEqual(renames, []);
});

test("plan: date-prefixes mixed-case docs under docs/", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(repo.dir, "docs/Develop.md", "# Hello\n");
  commitAll(repo.dir, {
    message: "Add Develop",
    author: "Alice <alice@example.com>",
    dateIso: "2024-01-15T12:00:00Z",
  });

  const plan = await planMigration({ cwd: repo.dir });
  const renames = plan.actions.filter((a) => a.type === "rename");
  assert.deepEqual(renames, [
    {
      type: "rename",
      from: "docs/Develop.md",
      to: "docs/2024-01-15-develop.md",
    },
  ]);
});

test("plan: treats YYYY-MM-DD_ as date-prefixed and normalizes separators", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(repo.dir, "docs/2024-06-01_test-file.md", "# Hello\n");
  commitAll(repo.dir, {
    message: "Add date-prefixed with underscore",
    author: "Alice <alice@example.com>",
    dateIso: "2024-06-10T12:00:00Z",
  });

  const plan = await planMigration({ cwd: repo.dir });
  const renames = plan.actions.filter((a) => a.type === "rename");
  assert.deepEqual(renames, [
    {
      type: "rename",
      from: "docs/2024-06-01_test-file.md",
      to: "docs/2024-06-01-test-file.md",
    },
  ]);
});

test("plan: allows date-only docs without slug", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(repo.dir, "docs/logs/2024-06-01.md", "# Log\n");
  commitAll(repo.dir, {
    message: "Add date-only log",
    author: "Alice <alice@example.com>",
    dateIso: "2024-06-10T12:00:00Z",
  });

  const plan = await planMigration({ cwd: repo.dir });
  const renames = plan.actions.filter(
    (a) => a.type === "rename" && a.from === "docs/logs/2024-06-01.md",
  );
  assert.deepEqual(renames, []);
});

test("plan: keeps YYYY-MM-DD prefix dashes even in capitalized mode", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(repo.dir, "docs/2024-06-01_test-file.md", "# Hello\n");
  commitAll(repo.dir, {
    message: "Add date-prefixed with underscore",
    author: "Alice <alice@example.com>",
    dateIso: "2024-06-10T12:00:00Z",
  });

  const plan = await planMigration({
    cwd: repo.dir,
    renameCaseOverrides: { "docs/2024-06-01_test-file.md": "capitalized" },
  });
  const renames = plan.actions.filter((a) => a.type === "rename");
  assert.deepEqual(renames, [
    {
      type: "rename",
      from: "docs/2024-06-01_test-file.md",
      to: "docs/2024-06-01-TEST_FILE.md",
    },
  ]);
});

test("plan: can force removing date prefix for date-prefixed docs when overridden to capitalized", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(repo.dir, "docs/2024-06-01-test-file.md", "# Hello\n");
  commitAll(repo.dir, {
    message: "Add date-prefixed doc",
    author: "Alice <alice@example.com>",
    dateIso: "2024-06-10T12:00:00Z",
  });

  const plan = await planMigration({
    cwd: repo.dir,
    renameCaseOverrides: { "docs/2024-06-01-test-file.md": "capitalized" },
    forceUndatedPaths: ["docs/2024-06-01-test-file.md"],
  });
  const renames = plan.actions.filter((a) => a.type === "rename");
  assert.deepEqual(renames, [
    {
      type: "rename",
      from: "docs/2024-06-01-test-file.md",
      to: "docs/TEST_FILE.md",
    },
  ]);
});

test("plan: ignores skills/simpledoc/SKILL.md", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(repo.dir, "skills/simpledoc/SKILL.md", "# SimpleDoc skill\n");
  commitAll(repo.dir, {
    message: "Add SimpleDoc skill",
    author: "Alice <alice@example.com>",
    dateIso: "2024-07-01T12:00:00Z",
  });

  const plan = await planMigration({ cwd: repo.dir });
  const renames = plan.actions.filter((a) => a.type === "rename");
  assert.equal(renames.length, 0);
});

test("plan: renames docs/readme.md to docs/README.md (canonical)", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(repo.dir, "docs/readme.md", "# Readme\n");
  commitAll(repo.dir, {
    message: "Add docs/readme.md",
    author: "Alice <alice@example.com>",
    dateIso: "2024-08-01T12:00:00Z",
  });

  const plan = await planMigration({ cwd: repo.dir });
  const renames = plan.actions.filter((a) => a.type === "rename");
  assert.deepEqual(renames, [
    { type: "rename", from: "docs/readme.md", to: "docs/README.md" },
  ]);
});

test("plan: does not date-prefix docs/IDEAS.md (canonical)", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(repo.dir, "docs/IDEAS.md", "# Ideas\n");
  commitAll(repo.dir, {
    message: "Add IDEAS.md",
    author: "Alice <alice@example.com>",
    dateIso: "2024-08-01T12:00:00Z",
  });

  const plan = await planMigration({ cwd: repo.dir });
  const renames = plan.actions.filter((a) => a.type === "rename");
  assert.deepEqual(renames, []);
});

test("plan: treats RFC-* docs as canonical (no date prefix)", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(repo.dir, "docs/RFC-6902-JSON-Patch.md", "# RFC\n");
  commitAll(repo.dir, {
    message: "Add RFC doc",
    author: "Alice <alice@example.com>",
    dateIso: "2024-08-01T12:00:00Z",
  });

  const plan = await planMigration({ cwd: repo.dir });
  const renames = plan.actions.filter((a) => a.type === "rename");
  assert.deepEqual(renames, [
    {
      type: "rename",
      from: "docs/RFC-6902-JSON-Patch.md",
      to: "docs/RFC_6902_JSON_PATCH.md",
    },
  ]);
});

test("plan: can override RFC canonical docs to lowercase (no date prefix)", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(repo.dir, "docs/RFC-6902-JSON-Patch.md", "# RFC\n");
  commitAll(repo.dir, {
    message: "Add RFC doc",
    author: "Alice <alice@example.com>",
    dateIso: "2024-08-01T12:00:00Z",
  });

  const plan = await planMigration({
    cwd: repo.dir,
    renameCaseOverrides: { "docs/RFC-6902-JSON-Patch.md": "lowercase" },
  });
  const renames = plan.actions.filter((a) => a.type === "rename");
  assert.deepEqual(renames, [
    {
      type: "rename",
      from: "docs/RFC-6902-JSON-Patch.md",
      to: "docs/rfc-6902-json-patch.md",
    },
  ]);
});

test("plan: can force date-prefixing capitalized docs when overridden to lowercase", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(repo.dir, "docs/TEST-FILE.md", "# Hello\n");
  commitAll(repo.dir, {
    message: "Add TEST-FILE",
    author: "Alice <alice@example.com>",
    dateIso: "2024-08-01T12:00:00Z",
  });

  const plan = await planMigration({
    cwd: repo.dir,
    renameDocsToDatePrefix: false,
    renameCaseOverrides: { "docs/TEST-FILE.md": "lowercase" },
    forceDatePrefixPaths: ["docs/TEST-FILE.md"],
  });
  const renames = plan.actions.filter((a) => a.type === "rename");
  assert.deepEqual(renames, [
    {
      type: "rename",
      from: "docs/TEST-FILE.md",
      to: "docs/2024-08-01-test-file.md",
    },
  ]);
});

test("plan: resolves rename collisions by uniquifying targets", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(repo.dir, "docs/a-b.md", "# A\n");
  await writeFile(repo.dir, "docs/a_b.md", "# B\n");
  commitAll(repo.dir, {
    message: "Add colliding docs",
    author: "Alice <alice@example.com>",
    dateIso: "2024-09-10T12:00:00Z",
  });

  const plan = await planMigration({ cwd: repo.dir });
  const renames = plan.actions.filter((a) => a.type === "rename");

  assert.equal(renames.length, 2);
  const targets = renames.map((r) => r.to).sort();
  assert.equal(new Set(targets).size, 2);
  assert.ok(
    targets.every((tgt) => tgt.startsWith("docs/2024-09-10-a-b")),
    `Expected both targets to start with docs/2024-09-10-a-b, got: ${targets.join(", ")}`,
  );
  assert.ok(
    targets.some((tgt) => tgt.endsWith("-2.md")),
    `Expected one target to end with -2.md, got: ${targets.join(", ")}`,
  );
});

test("plan: respects docsRoot option", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(repo.dir, "documentation/Develop.md", "# Hello\n");
  commitAll(repo.dir, {
    message: "Add Develop",
    author: "Alice <alice@example.com>",
    dateIso: "2024-01-15T12:00:00Z",
  });

  const plan = await planMigration({
    cwd: repo.dir,
    docsRoot: "documentation",
  });
  const renames = plan.actions.filter((a) => a.type === "rename");
  assert.deepEqual(renames, [
    {
      type: "rename",
      from: "documentation/Develop.md",
      to: "documentation/2024-01-15-develop.md",
    },
  ]);
});

test("plan: ignores paths matched by ignore globs", async (t) => {
  const repo = await makeTempRepo();
  t.after(repo.cleanup);

  await writeFile(repo.dir, "docs/generated/Develop.md", "# Hello\n");
  commitAll(repo.dir, {
    message: "Add generated doc",
    author: "Alice <alice@example.com>",
    dateIso: "2024-01-15T12:00:00Z",
  });

  const plan = await planMigration({
    cwd: repo.dir,
    ignoreGlobs: ["docs/generated/**"],
  });

  assert.equal(plan.actions.length, 0);
});
