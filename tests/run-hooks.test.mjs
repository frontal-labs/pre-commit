#!/usr/bin/env node
/**
 * Hook test runner.
 *
 * For each fixture case:
 *   1. Create a throwaway git repo, copy fixture files in, stage them.
 *   2. Copy the hooks/ directory from this repo into the test repo.
 *   3. Run the hook's entry command with cwd = test repo.
 *   4. Verify the exit code matches expectations.
 *
 * Usage:
 *   node tests/run-hooks.test.mjs           # all cases
 *   node tests/run-hooks.test.mjs <case>    # single case by id
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(TEST_DIR);
const FIXTURES = join(TEST_DIR, "fixtures");

/** Matches the `sh -c '<command>'` wrapper every hook entry uses. */
const SH_C_RE = /^sh -c '(?<command>.*)'$/su;
const TS_FILE_RE = /(?<ext>ts|tsx|js|jsx|json)$/u;
const PY_FILE_RE = /\.py$/u;
const EXCLUDED_PATH_RE =
  /(?<prefix>^|\/)(?<name>vendor|gen|generated|node_modules)\//u;

function listFiles(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full, prefix ? `${prefix}${entry}/` : `${entry}/`));
    } else {
      out.push(prefix ? `${prefix}${entry}` : entry);
    }
  }
  return out;
}

/**
 * Tool-availability gates.  A case is SKIPPED (not FAIL) when the tool it
 * needs is not installed on this machine.  ensure-tool.mjs exits 254 for a
 * missing tool, which is indistinguishable from a hook bug without this.
 */
function toolAvailable(cmd, extraArgs = []) {
  const result = spawnSync(cmd, extraArgs, { encoding: "utf8" });
  return result.error === undefined && result.status === 0;
}

const HOOK_TOOLS = {
  "frontal-biome": () =>
    toolAvailable("biome", ["--version"]) ||
    existsSync(join(REPO_ROOT, "node_modules", ".bin", "biome")),
  "frontal-ruff": () => toolAvailable("ruff", ["--version"]),
  "frontal-rustfmt": () => toolAvailable("rustfmt", ["--version"]),
  "frontal-clippy": () => toolAvailable("cargo", ["clippy", "--version"]),
  "frontal-go-vet": () => toolAvailable("go", ["version"]),
  "frontal-buf-lint": () => toolAvailable("buf", ["--version"]),
  "frontal-commit-msg": () => toolAvailable("node", ["--version"]),
};

const HOOKS = {
  "frontal-biome": {
    entry:
      "sh -c 'node hooks/ensure-tool.mjs biome && biome check --no-errors-on-unmatched \"$@\"'",
    staged: (files) =>
      files.filter(
        (f) => TS_FILE_RE.test(f) && !f.startsWith("packages/design-system/")
      ),
    pass_filenames: true,
  },
  "frontal-ruff": {
    entry:
      'sh -c \'node hooks/ensure-tool.mjs ruff && ruff check "$@" && ruff format --check "$@"\'',
    staged: (files) =>
      files.filter((f) => PY_FILE_RE.test(f) && !EXCLUDED_PATH_RE.test(f)),
    pass_filenames: true,
  },
  "frontal-rustfmt": {
    entry:
      'sh -c \'node hooks/ensure-tool.mjs rustfmt && rust_files=$(git diff --cached --name-only --diff-filter=ACMR -- "*.rs" | grep -vE "(^|/)gen/" || true); if [ -n "$rust_files" ]; then printf "%s\\n" "$rust_files" | xargs rustfmt --edition 2024 --check; fi\'',
    staged: () => [],
    pass_filenames: false,
  },
  "frontal-clippy": {
    entry:
      "sh -c 'node hooks/ensure-tool.mjs cargo && node hooks/clippy-scoped.mjs'",
    staged: () => [],
    pass_filenames: false,
  },
  "frontal-go-vet": {
    entry:
      "sh -c 'node hooks/ensure-tool.mjs go && node hooks/go-vet-scoped.mjs'",
    staged: () => [],
    pass_filenames: false,
  },
  "frontal-buf-lint": {
    entry:
      "sh -c 'node hooks/ensure-tool.mjs buf && node hooks/buf-lint-scoped.mjs'",
    staged: () => [],
    pass_filenames: false,
  },
  "frontal-commit-msg": {
    entry: "sh -c 'node hooks/check-commit-message.mjs \"$0\"'",
    staged: () => [],
    pass_filenames: false,
    is_commit_msg: true,
  },
};

const CASES = [
  // [caseId, fixtureRelPath, hookId, expectedPass]
  ["biome-pass", "biome/pass", "frontal-biome", true],
  ["biome-fail", "biome/fail", "frontal-biome", false],
  ["ruff-pass", "ruff/pass", "frontal-ruff", true],
  ["ruff-fail-lint", "ruff/fail-lint", "frontal-ruff", false],
  ["ruff-fail-format", "ruff/fail-format", "frontal-ruff", false],
  ["rustfmt-pass", "rustfmt/pass", "frontal-rustfmt", true],
  ["rustfmt-fail", "rustfmt/fail", "frontal-rustfmt", false],
  ["clippy-pass", "clippy/pass", "frontal-clippy", true],
  ["clippy-fail", "clippy/fail", "frontal-clippy", false],
  ["go-vet-pass", "go-vet/pass", "frontal-go-vet", true],
  ["go-vet-fail", "go-vet/fail", "frontal-go-vet", false],
  ["buf-lint-pass", "buf-lint/pass", "frontal-buf-lint", true],
  ["buf-lint-fail", "buf-lint/fail", "frontal-buf-lint", false],
  ["commit-msg-pass", "commit-msg/pass", "frontal-commit-msg", true],
  ["commit-msg-fail", "commit-msg/fail", "frontal-commit-msg", false],
];

function setupRepo(fixtureDir, repoDir) {
  cpSync(fixtureDir, repoDir, { recursive: true });
  execFileSync("git", ["init", "-q", "--initial-branch=main"], {
    cwd: repoDir,
  });
  execFileSync("git", ["config", "user.email", "test@test.com"], {
    cwd: repoDir,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });
  // Copy hooks/ so relative paths in entry commands work
  cpSync(join(REPO_ROOT, "hooks"), join(repoDir, "hooks"), { recursive: true });
  // The biome hook resolves its config (biome.jsonc) and the ultracite preset
  // through node_modules, so the throwaway repo needs both: a copy of the
  // config and a symlink to this repo's node_modules.
  cpSync(join(REPO_ROOT, "biome.jsonc"), join(repoDir, "biome.jsonc"));
  symlinkSync(join(REPO_ROOT, "node_modules"), join(repoDir, "node_modules"));
  execFileSync("git", ["add", "-A"], { cwd: repoDir });
}

function runHook(hook, repoDir, allFiles, extraArgs = []) {
  // Every hook entry is of the form `sh -c '<command>'`.  pre-commit
  // executes it by appending the file list (or the commit-msg file) as
  // positional params after the command string.  The first positional
  // param lands in `$0`, the rest in `$@`.
  //
  // To avoid a double shell wrapper (which would consume the positional
  // param as its own $0 and drop it), parse out the inner command and
  // run `sh -c <command> [placeholder-$0] <files...>` directly.
  //
  // `sh -c 'cmd' a b c` assigns a→$0, b→$1, c→$2.  Hooks that reference
  // `"$@"` (biome, ruff) expect *all* filenames there, so we pass a dummy
  // placeholder for $0 and let the real files start at $1.  The commit-msg
  // hook is the exception: it reads a single positional param as `$0`, so
  // for that hook we pass the message path bare (it becomes $0, matching
  // how pre-commit invokes commit-msg hooks).
  const m = hook.entry.match(SH_C_RE);
  if (!m) {
    throw new Error(`unexpected entry format: ${hook.entry}`);
  }
  const { command } = m.groups;

  let files = [];
  if (hook.is_commit_msg) {
    files = extraArgs;
  } else if (hook.pass_filenames) {
    files = [...hook.staged(allFiles), ...extraArgs];
  }

  // Prepend the repo's node_modules/.bin to PATH so locally-installed tools
  // (biome) are found even when they are not on the system PATH.
  const env = {
    ...process.env,
    PATH: `${join(repoDir, "node_modules", ".bin")}:${process.env.PATH}`,
  };

  // For commit-msg the single param is the message path and must land in $0.
  // For file-based hooks a placeholder occupies $0 so "$@" sees every file.
  const positional = hook.is_commit_msg ? files : ["$0-placeholder", ...files];

  const result = spawnSync("sh", ["-c", command, ...positional], {
    cwd: repoDir,
    shell: false,
    encoding: "utf8",
    timeout: 60_000,
    env,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function main() {
  const args = process.argv.slice(2);
  const filter = args.find((a) => !a.startsWith("--"));
  const debug = args.includes("--debug");
  const cases = filter ? CASES.filter(([id]) => id === filter) : CASES;

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const results = [];

  for (const [caseId, fixturePath, hookId, expectPass] of cases) {
    const fixtureDir = join(FIXTURES, fixturePath);
    if (!existsSync(fixtureDir)) {
      results.push({
        caseId,
        status: "SKIP",
        reason: `fixture not found: ${fixturePath}`,
      });
      skipped += 1;
      continue;
    }

    const hook = HOOKS[hookId];

    // Skip when the underlying tool is not installed on this machine.
    if (!HOOK_TOOLS[hookId]()) {
      results.push({
        caseId,
        hookId,
        status: "SKIP",
        reason: "tool not installed",
      });
      skipped += 1;
      continue;
    }

    const repoDir = mkdtempSync(join(tmpdir(), `hook-test-${caseId}-`));

    try {
      setupRepo(fixtureDir, repoDir);
      const allFiles = listFiles(fixtureDir);

      const extraArgs = hook.is_commit_msg
        ? [join(repoDir, "message.txt")]
        : [];
      const result = runHook(hook, repoDir, allFiles, extraArgs);

      const actualPass = result.status === 0;
      const ok = actualPass === expectPass;

      if (debug) {
        process.stderr.write(
          `\n===== ${caseId} (exit ${result.status}, expected ${expectPass ? "pass" : "fail"}) =====\n`
        );
        process.stderr.write(
          `--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}\n`
        );
      }

      results.push({
        caseId,
        hookId,
        expectPass,
        actualPass,
        status: ok ? "PASS" : "FAIL",
        exitCode: result.status,
        output: (result.stderr || result.stdout).trim().slice(0, 300),
      });

      if (ok) {
        passed += 1;
      } else {
        failed += 1;
      }
    } catch (error) {
      results.push({ caseId, hookId, status: "ERROR", reason: error.message });
      failed += 1;
    } finally {
      if (debug) {
        process.stderr.write(`\n[debug] repo kept at ${repoDir}\n`);
      } else {
        rmSync(repoDir, { recursive: true, force: true });
      }
    }
  }

  // Report
  const width = Math.max(...results.map((r) => r.caseId.length), 20);
  for (const r of results) {
    let mark = "FAIL";
    if (r.status === "PASS") {
      mark = "ok  ";
    } else if (r.status === "SKIP") {
      mark = "SKIP";
    }
    let detail;
    if (r.status === "PASS") {
      detail = `${r.hookId} exit=${r.exitCode} expected_pass=${r.expectPass}`;
    } else {
      detail = r.reason;
    }
    console.log(`  ${mark}  ${r.caseId.padEnd(width)}  ${detail}`);
  }

  const total = results.length;
  console.log(
    `\n${passed}/${total} cases passed, ${failed} failed, ${skipped} skipped\n`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main();
