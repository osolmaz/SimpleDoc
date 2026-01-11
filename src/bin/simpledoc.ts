#!/usr/bin/env node
import process from "node:process";
import { handleSkillflag } from "../cli/skillflag.js";

import { runCli } from "../cli/index.js";

const args = process.argv;
if (args.includes("--skill")) {
  const exitCode = await handleSkillflag(args, {
    skillsRoot: new URL("../../skills/", import.meta.url),
  });
  process.exitCode = exitCode;
} else {
  await runCli(args);
}
