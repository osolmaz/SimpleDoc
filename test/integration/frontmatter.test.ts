import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFrontmatter,
  parseFrontmatterBlock,
  DOC_FRONTMATTER_ORDER,
} from "../../src/frontmatter.js";

test("frontmatter: builds ordered doc frontmatter", async () => {
  const fm = buildFrontmatter(
    {
      title: "Hello",
      author: "Alice <alice@example.com>",
      date: "2026-02-04",
      tags: ["alpha", "beta"],
      extra: "note",
    },
    { order: DOC_FRONTMATTER_ORDER, quoteStrings: true },
  );

  const lines = fm.trim().split("\n");
  assert.equal(lines[0], "---");
  const keys = lines.slice(1, 6).map((line) => line.split(":")[0]);
  assert.deepEqual(keys, ["title", "author", "date", "tags", "extra"]);
  assert.match(fm, /tags: \["alpha", "beta"\]/);
});

test("frontmatter: parses a frontmatter block", async () => {
  const content = [
    "---",
    "title: Test Doc",
    "author: Someone <some@example.com>",
    "date: 2026-02-04",
    "---",
    "",
    "Body line",
    "",
  ].join("\n");

  const parsed = parseFrontmatterBlock(content);
  assert.equal(parsed.hasFrontmatter, true);
  assert.equal(parsed.data.title, "Test Doc");
  assert.equal(parsed.data.author, "Someone <some@example.com>");
  assert.match(parsed.body, /Body line/);
});
