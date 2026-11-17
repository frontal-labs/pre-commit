#!/usr/bin/env node
/**
 * Scoped buf lint for staged proto files.
 *
 * Mirrors run-checks.mjs `proto:lint:<dir>`:
 *   In-workspace modules → buf lint from repo root (buf.yaml workspace)
 *   Standalone modules   → buf lint in the module directory
 *
 * A module is in-workspace when its path appears in the root buf.yaml
 * modules list (parsed the same way as run-checks.mjs readWorkspaceModules).
 *
 * Excluded: gen/, generated/, node_modules/, vendor/.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

const EXCLUDED = [
  /(?<prefix>^|\/)gen\//u,
  /(?<prefix>^|\/)generated\//u,
  /(?<prefix>^|\/)node_modules\//u,
  /(?<prefix>^|\/)vendor\//u,
];

const BUF_PATH_RE = /^\s{2}- path:\s*(?<path>\S+)\s*$/u;
const TRAILING_SLASH_RE = /\/+$/u;

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
 * Module paths listed in the root buf.yaml workspace.
 * Parsed the same way as run-checks.mjs readWorkspaceModules().
 */
function readWorkspaceModules(root) {
  const paths = new Set();
  const manifest = join(root, "buf.yaml");
  if (!existsSync(manifest)) {
    return paths;
  }
  for (const line of readFileSync(manifest, "utf8").split("\n")) {
    // Stop at the top-level deps:/lint: keys; - path: only appears under modules:
    const match = line.match(BUF_PATH_RE);
    if (match) {
      paths.add(match.groups.path.replace(TRAILING_SLASH_RE, ""));
    }
  }
  return paths;
}

/**
 * Walk up from `file` to the nearest ancestor directory containing a
 * buf.yaml, stopping at (and including) `root`.
 */
function findProtoModule(file, root) {
  const rootResolved = resolve(root);
  let dir = dirname(resolve(rootResolved, file));
  // Walk up to (and including) the repo root; stop once dir rises above it.
  while (dir === rootResolved || dir.startsWith(rootResolved + sep)) {
    if (existsSync(join(dir, "buf.yaml"))) {
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
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "--", "*.proto"],
    root
  ).filter((f) => !EXCLUDED.some((p) => p.test(f)));

  if (staged.length === 0) {
    process.stderr.write(
      "frontal-buf-lint: no staged proto files — nothing to check\n"
    );
    process.exit(0);
  }

  const dirs = [
    ...new Set(staged.map((f) => findProtoModule(f, root)).filter(Boolean)),
  ];
  if (dirs.length === 0) {
    process.stderr.write(
      "frontal-buf-lint: no proto module owns any staged file — nothing to check\n"
    );
    process.exit(0);
  }

  const workspaceModules = readWorkspaceModules(root);
  const inWorkspace = dirs.filter((dir) => workspaceModules.has(dir));
  const standalone = dirs.filter((dir) => !workspaceModules.has(dir));

  if (inWorkspace.length > 0) {
    process.stderr.write(
      "frontal-buf-lint: buf lint  (repo root, workspace modules)\n"
    );
    const result = spawnSync("buf", ["lint"], {
      cwd: root,
      shell: false,
      stdio: "inherit",
    });
    if (result.status !== 0) {
      process.stderr.write("\n  ✗ frontal-buf-lint: failed (workspace)\n");
      process.exit(result.status ?? 1);
    }
  }

  for (const dir of standalone) {
    process.stderr.write(`frontal-buf-lint: buf lint  (in ${dir})\n`);
    const result = spawnSync("buf", ["lint"], {
      cwd: join(root, dir),
      shell: false,
      stdio: "inherit",
    });
    if (result.status !== 0) {
      process.stderr.write(`\n  ✗ frontal-buf-lint: failed in ${dir}\n`);
      process.exit(result.status ?? 1);
    }
  }

  process.stderr.write("frontal-buf-lint: ok\n");
} catch (error) {
  process.stderr.write(`frontal-buf-lint: ${error.message}\n`);
  process.exit(1);
}
