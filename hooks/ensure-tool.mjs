#!/usr/bin/env node
/**
 * Verify that a tool is on PATH before the hook runs.
 *
 * pre-commit's `language: system` silently exits 0 when the entry command is
 * not found, which is the exact failure mode the frontal hook system exists to
 * prevent.  This script turns that silent pass into a loud, actionable error.
 *
 * Usage:  node hooks/ensure-tool.mjs <tool> [<tool> ...]
 * Exit:   0  every tool found
 *         1  at least one tool missing (names printed to stderr)
 */

import { accessSync, constants as fsConstants } from "node:fs";
import { join } from "node:path";

const tools = process.argv.slice(2);
if (tools.length === 0) {
  process.stderr.write("ensure-tool: expected at least one tool name\n");
  process.exit(2);
}

const missing = [];
for (const bin of tools) {
  if (bin.includes("/")) {
    try {
      accessSync(bin, fsConstants.X_OK);
    } catch {
      missing.push(bin);
    }
    continue;
  }
  const dirs = (process.env.PATH ?? "").split(":").filter(Boolean);
  const found = dirs.some((dir) => {
    try {
      accessSync(join(dir, bin), fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  if (!found) {
    missing.push(bin);
  }
}

if (missing.length > 0) {
  process.stderr.write(
    "\n  ✗ frontal hook: required tool(s) not found on PATH\n"
  );
  for (const t of missing) {
    process.stderr.write(`      ${t}\n`);
  }
  process.stderr.write(
    "  Install the missing tool(s) and retry. See README.md for setup.\n\n"
  );
  process.exit(1);
}
