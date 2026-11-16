#!/usr/bin/env node
/**
 * Scoped cargo clippy for staged Rust files.
 *
 * Mirrors run-checks.mjs `rust:clippy:<workspace>`:
 *   For each staged .rs file, resolve the owning workspace (nearest ancestor
 *   Cargo.toml declaring [workspace]) and the crate name.  One clippy run per
 *   workspace covers all of its staged crates together.
 *
 *   cargo clippy -p <crate1> -p <crate2> … --all-targets -- -D warnings
 *
 * The cwd is the workspace directory so rustup picks the correct toolchain
 * from rust-toolchain.toml.
 *
 * Excluded: gen/ (generated bindings), node_modules/, vendor/.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const EXCLUDED = [
  /(?<prefix>^|\/)gen\//u,
  /(?<prefix>^|\/)generated\//u,
  /(?<prefix>^|\/)vendor\//u,
  /(?<prefix>^|\/)node_modules\//u,
];

const WORKSPACE_SECTION_RE = /^\s*\[workspace\]/mu;
const CRATE_NAME_RE =
  /^\s*\[package\][\s\S]*?^\s*name\s*=\s*"(?<name>[^"]+)"/mu;

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
 * Walk up from `file` to the nearest ancestor Cargo.toml that declares a
 * [workspace] section, stopping at (and including) `root`.
 */
function findRustWorkspace(file, root) {
  const rootResolved = resolve(root);
  let dir = dirname(resolve(rootResolved, file));
  // Walk up to (and including) the repo root; stop once dir rises above it.
  while (dir === rootResolved || dir.startsWith(rootResolved + sep)) {
    const manifest = join(dir, "Cargo.toml");
    if (existsSync(manifest)) {
      const text = readFileSync(manifest, "utf8");
      if (WORKSPACE_SECTION_RE.test(text)) {
        const rel = relative(rootResolved, dir);
        return rel === "" ? "." : rel.split(sep).join("/");
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
  return null;
}

function readCrateName(crateDir, root) {
  const manifest = join(resolve(root, crateDir), "Cargo.toml");
  if (!existsSync(manifest)) {
    return null;
  }
  const match = readFileSync(manifest, "utf8").match(CRATE_NAME_RE);
  return match ? match.groups.name : null;
}

try {
  const [root] = git(["rev-parse", "--show-toplevel"]);
  const staged = git(
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "--", "*.rs"],
    root
  ).filter((f) => !EXCLUDED.some((p) => p.test(f)));

  if (staged.length === 0) {
    process.stderr.write(
      "frontal-clippy: no staged Rust files — nothing to check\n"
    );
    process.exit(0);
  }

  // Map workspace → [crate names]
  const clippyCrates = new Map();
  for (const file of staged) {
    const workspace = findRustWorkspace(file, root);
    if (!workspace) {
      continue; // no workspace manifest; Bazel owns this
    }
    // The workspace dir holds the manifest that addresses this crate with
    // `-p`.  In the self-workspace layout (a crate declaring its own
    // [workspace] members = ["."]) that manifest also declares the [package].
    const name = readCrateName(workspace, root);
    if (!name) {
      continue; // workspace root with no [package]; not addressable with -p
    }
    clippyCrates.set(workspace, [...(clippyCrates.get(workspace) ?? []), name]);
  }

  if (clippyCrates.size === 0) {
    process.stderr.write(
      "frontal-clippy: no addressable crates in staged files — nothing to check\n"
    );
    process.exit(0);
  }

  for (const [workspace, names] of clippyCrates) {
    const uniqueNames = [...new Set(names)];
    const args = [
      "clippy",
      ...uniqueNames.flatMap((n) => ["-p", n]),
      "--all-targets",
      "--",
      "-D",
      "warnings",
    ];
    process.stderr.write(
      `frontal-clippy: cargo ${args.join(" ")}  (in ${workspace})\n`
    );
    const result = spawnSync("cargo", args, {
      cwd: join(root, workspace),
      shell: false,
      stdio: "inherit",
    });
    if (result.status !== 0) {
      process.stderr.write(`\n  ✗ frontal-clippy: failed in ${workspace}\n`);
      process.exit(result.status ?? 1);
    }
  }

  process.stderr.write("frontal-clippy: ok\n");
} catch (error) {
  process.stderr.write(`frontal-clippy: ${error.message}\n`);
  process.exit(1);
}
