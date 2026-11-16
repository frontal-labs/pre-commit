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
import { dirname, join, resolve } from "node:path";

const EXCLUDED = [
	/(^|\/)gen\//,
	/(^|\/)generated\//,
	/(^|\/)node_modules\//,
	/(^|\/)vendor\//,
];

function git(args, cwd) {
	const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
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
	if (!existsSync(manifest)) return paths;
	for (const line of readFileSync(manifest, "utf8").split("\n")) {
		// Stop at the top-level deps:/lint: keys; - path: only appears under modules:
		const match = line.match(/^\s{2}- path:\s*(\S+)\s*$/);
		if (match) paths.add(match[1].replace(/\/+$/, ""));
	}
	return paths;
}

function findProtoModule(file, root) {
	let dir = dirname(resolve(root, file));
	const stop = resolve(root);
	for (;;) {
		if (existsSync(join(dir, "buf.yaml"))) {
			const rel = dir === stop ? "." : dir.slice(stop.length + 1);
			return rel;
		}
		if (dir === stop) return null;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

try {
	const root = git(["rev-parse", "--show-toplevel"])[0];
	const staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "--", "*.proto"], root).filter(
		(f) => !EXCLUDED.some((p) => p.test(f)),
	);

	if (staged.length === 0) {
		process.stderr.write("frontal-buf-lint: no staged proto files — nothing to check\n");
		process.exit(0);
	}

	const dirs = [...new Set(staged.map((f) => findProtoModule(f, root)).filter(Boolean))];
	if (dirs.length === 0) {
		process.stderr.write("frontal-buf-lint: no proto module owns any staged file — nothing to check\n");
		process.exit(0);
	}

	const workspaceModules = readWorkspaceModules(root);
	const inWorkspace = dirs.filter((dir) => workspaceModules.has(dir));
	const standalone = dirs.filter((dir) => !workspaceModules.has(dir));

	if (inWorkspace.length > 0) {
		process.stderr.write("frontal-buf-lint: buf lint  (repo root, workspace modules)\n");
		const result = spawnSync("buf", ["lint"], { cwd: root, shell: false, stdio: "inherit" });
		if (result.status !== 0) {
			process.stderr.write("\n  ✗ frontal-buf-lint: failed (workspace)\n");
			process.exit(result.status ?? 1);
		}
	}

	for (const dir of standalone) {
		process.stderr.write(`frontal-buf-lint: buf lint  (in ${dir})\n`);
		const result = spawnSync("buf", ["lint"], { cwd: join(root, dir), shell: false, stdio: "inherit" });
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
