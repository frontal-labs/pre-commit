#!/usr/bin/env node
/**
 * Scoped go vet for staged Go files.
 *
 * Mirrors run-checks.mjs `go:vet:<dir>`:
 *   For each staged .go file, resolve the owning Go module by walking up to
 *   the nearest go.mod.  One `go vet ./...` per affected module.
 *
 * Excluded: vendor/, gen/, generated/, node_modules/, docker/.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const EXCLUDED = [
	/(^|\/)vendor\//,
	/(^|\/)gen\//,
	/(^|\/)generated\//,
	/(^|\/)node_modules\//,
	/(^|\/)docker\//,
];

function git(args, cwd) {
	const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	if (result.status !== 0) {
		const detail = (result.stderr || "").trim();
		throw new Error(`git ${args.join(" ")} failed: ${detail}`);
	}
	return result.stdout.split("\n").filter(Boolean);
}

function findGoModule(file, root) {
	let dir = dirname(resolve(root, file));
	const stop = resolve(root);
	for (;;) {
		if (existsSync(join(dir, "go.mod"))) {
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
	const staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "--", "*.go"], root).filter(
		(f) => !EXCLUDED.some((p) => p.test(f)),
	);

	if (staged.length === 0) {
		process.stderr.write("frontal-go-vet: no staged Go files — nothing to check\n");
		process.exit(0);
	}

	const dirs = [...new Set(staged.map((f) => findGoModule(f, root)).filter(Boolean))];
	if (dirs.length === 0) {
		process.stderr.write("frontal-go-vet: no Go module owns any staged file — nothing to check\n");
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

	for (const dir of dirs) {
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
