#!/usr/bin/env node
/**
 * Scoped go vet for staged Go files.
 *
 * Mirrors run-checks.mjs `go:vet:<dir>`:
 *   For each staged .go file, resolve the owning Go module by walking up to
 *   the nearest go.mod.  One `go vet ./...` per affected module.
 *
 *   Modules whose sources are entirely generated (e.g. proto/contract modules
 *   whose gen/ tree is gitignored) have no packages at all on a fresh clone,
 *   and `go vet ./...` fails with "matched no packages" on content the author
 *   never wrote. run-checks.mjs skips exactly those: `go list ./...` exiting 0
 *   with empty stdout means the pattern matched nothing; a broken module
 *   (bad go.mod, unresolvable dependency) makes `go list` exit non-zero and is
 *   NOT skipped, so it still fails the gate.
 *
 * Excluded: vendor/, gen/, generated/, node_modules/, docker/.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

const EXCLUDED = [
  /(?<prefix>^|\/)vendor\//u,
  /(?<prefix>^|\/)gen\//u,
  /(?<prefix>^|\/)generated\//u,
  /(?<prefix>^|\/)node_modules\//u,
  /(?<prefix>^|\/)docker\//u,
];

function git(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = (result.stderr || "").trim();
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout.split("\n").filter(Boolean);
}

/**
 * Walk up from `file` to the nearest ancestor directory containing a
 * go.mod, stopping at (and including) `root`.
 */
function findGoModule(file, root) {
  const rootResolved = resolve(root);
  let dir = dirname(resolve(rootResolved, file));
  // Walk up to (and including) the repo root; stop once dir rises above it.
  while (dir === rootResolved || dir.startsWith(rootResolved + sep)) {
    if (existsSync(join(dir, "go.mod"))) {
      const rel =
        dir === rootResolved ? "." : dir.slice(rootResolved.length + 1);
      return rel;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
  return null;
}

try {
  const [root] = git(["rev-parse", "--show-toplevel"]);
  const staged = git(
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "--", "*.go"],
    root
  ).filter((f) => !EXCLUDED.some((p) => p.test(f)));

  if (staged.length === 0) {
    process.stderr.write(
      "frontal-go-vet: no staged Go files — nothing to check\n"
    );
    process.exit(0);
  }

  const dirs = [
    ...new Set(staged.map((f) => findGoModule(f, root)).filter(Boolean)),
  ];
  if (dirs.length === 0) {
    process.stderr.write(
      "frontal-go-vet: no Go module owns any staged file — nothing to check\n"
    );
    process.exit(0);
  }

  // Warm the module cache for each affected directory (same as run-checks.mjs).
  for (const dir of dirs) {
    spawnSync("go", ["list", "-e", "-deps", "-test", "./..."], {
      cwd: join(root, dir),
      shell: false,
      stdio: "ignore",
    });
  }

  // Skip modules with no packages at all (generated-only, see header).
  // A launch failure (no go toolchain) or non-zero exit leaves the module
  // in the set — the vet check below remains the enforcement point.
  const nonEmpty = new Set();
  for (const dir of dirs) {
    const probe = spawnSync("go", ["list", "./..."], {
      cwd: join(root, dir),
      shell: false,
      encoding: "utf8",
    });
    if (probe.error) {
      nonEmpty.add(dir);
    } else if (probe.status === 0 && (probe.stdout || "").trim() === "") {
      process.stderr.write(
        `frontal-go-vet: ${dir} has no packages — skipping\n`
      );
    } else {
      nonEmpty.add(dir);
    }
  }
  if (nonEmpty.size === 0) {
    process.stderr.write("frontal-go-vet: ok\n");
    process.exit(0);
  }

  for (const dir of nonEmpty) {
    process.stderr.write(`frontal-go-vet: go vet ./...  (in ${dir})\n`);
    const result = spawnSync("go", ["vet", "./..."], {
      cwd: join(root, dir),
      shell: false,
      stdio: "inherit",
    });
    if (result.status !== 0) {
      process.stderr.write(`\n  ✗ frontal-go-vet: failed in ${dir}\n`);
      process.exit(result.status ?? 1);
    }
  }

  process.stderr.write("frontal-go-vet: ok\n");
} catch (error) {
  process.stderr.write(`frontal-go-vet: ${error.message}\n`);
  process.exit(1);
}
