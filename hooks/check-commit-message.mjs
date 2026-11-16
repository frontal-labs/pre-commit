#!/usr/bin/env node
/**
 * Conventional Commits validation for a single commit message.
 *
 * Copied verbatim from frontal/scripts/hooks/check-commit-message.mjs —
 * the rules, types, exemptions and length limit are identical.
 *
 * Usage:  check-commit-message.mjs <path-to-message-file>
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
];

const HEADER = new RegExp(
  `^(${TYPES.join("|")})(\\((?<scope>[^)]+)\\))?!?: .+`,
  "u"
);

/** Messages git creates itself, which must not be rejected. */
const EXEMPT = [
  /^Merge /u,
  /^Revert "/u,
  /^fixup! /u,
  /^squash! /u,
  // An in-progress rebase writes these; the final message is validated separately.
  /^amend! /u,
];

export function validateMessage(raw) {
  // Strip comments and the scissors section git appends in verbose mode.
  const body = raw
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");

  const subject = body.split("\n").find((line) => line.trim().length > 0);

  if (!subject) {
    return { ok: false, error: "commit message is empty" };
  }
  if (EXEMPT.some((pattern) => pattern.test(subject))) {
    return { ok: true };
  }

  if (!HEADER.test(subject)) {
    return {
      ok: false,
      error: `not a Conventional Commit: "${subject}"`,
      hint: [
        "expected <type>(<scope>): <description>",
        `  types: ${TYPES.join(", ")}`,
        "  example: fix(billing): reject subscriptions without a connection row",
      ].join("\n"),
    };
  }

  // A subject that runs long is truncated in most git UIs.
  if (subject.length > 100) {
    return {
      ok: false,
      error: `subject is ${subject.length} characters; keep it under 100`,
      hint: "move detail into the commit body",
    };
  }

  return { ok: true };
}

/**
 * Resolve the commit message file path from argv.
 *
 * The hook entry is `sh -c 'node hooks/check-commit-message.mjs "$0"'`.
 * A single positional param to `sh -c` is consumed as `$0` (not `$1` or
 * `$@`), so the path arrives as the script's first argv entry.  When the
 * shell is invoked bare (e.g. from lefthook or an editor integration),
 * `argv[2]` may be `sh`/`bash`/empty — in that case fall back to stdin.
 */
function resolveMessagePath([, , candidate]) {
  if (
    candidate &&
    candidate !== "sh" &&
    candidate !== "bash" &&
    !candidate.endsWith("/sh") &&
    !candidate.endsWith("/bash")
  ) {
    return candidate;
  }
  return null;
}

function main() {
  const path = resolveMessagePath(process.argv);
  const raw = path ? readFileSync(path, "utf8") : readFileSync(0, "utf8");
  const result = validateMessage(raw);
  if (!result.ok) {
    process.stderr.write(`\n  ✗ ${result.error}\n`);
    if (result.hint) {
      process.stderr.write(
        `${result.hint
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n")}\n`
      );
    }
    process.stderr.write("\n");
    process.exit(1);
  }
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main();
}
