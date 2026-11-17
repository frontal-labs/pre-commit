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
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(TEST_DIR);
const FIXTURES = join(TEST_DIR, "fixtures");

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
  if (result.error !== undefined) {
    // Only a missing executable (ENOENT) means the tool is genuinely absent
    // and the case should be skipped.  Other startup errors (EACCES =
    // permission denied, ELOOP = too many symlinks, ...) mean the executable
    // exists but cannot be launched; surface them as test errors instead of
    // silently skipping.
    if (result.error.code === "ENOENT") {
      return false;
    }
    throw new Error(
      `failed to launch ${cmd}: ${result.error.code ?? result.error.message}`
    );
  }
  return result.status === 0;
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

// Every published hook is `language: script`: pre-commit resolves `entry` to
// an absolute path in the hook CHECKOUT and executes it directly (not via
// `sh -c`), with the CONSUMER repo as cwd.  The wrapper resolves its node
// scripts against the checkout as an absolute path (derived from its own
// location) without changing the consumer's working directory.  The test
// repo's `hooks/` copy IS the simulated checkout, so `REPO_ROOT` (the source
// of that copy) is the checkout the wrapper resolves its scripts against.
const HOOKS = {
  "frontal-biome": {
    script: "hooks/biome.sh",
    staged: (files) =>
      files.filter(
        (f) => TS_FILE_RE.test(f) && !f.startsWith("packages/design-system/")
      ),
    pass_filenames: true,
  },
  "frontal-ruff": {
    script: "hooks/ruff.sh",
    staged: (files) =>
      files.filter((f) => PY_FILE_RE.test(f) && !EXCLUDED_PATH_RE.test(f)),
    pass_filenames: true,
  },
  "frontal-rustfmt": {
    script: "hooks/rustfmt.sh",
    staged: () => [],
    pass_filenames: false,
  },
  "frontal-clippy": {
    script: "hooks/clippy.sh",
    staged: () => [],
    pass_filenames: false,
  },
  "frontal-go-vet": {
    script: "hooks/go-vet.sh",
    staged: () => [],
    pass_filenames: false,
  },
  "frontal-buf-lint": {
    script: "hooks/buf-lint.sh",
    staged: () => [],
    pass_filenames: false,
  },
  "frontal-commit-msg": {
    script: "hooks/commit-msg.sh",
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
  // v2 workspace with two modules (api/proto, gen/proto). The staged file
  // is in api/proto; the hook must classify it as in-workspace and run
  // `buf lint` from the repo root, which lints every workspace module.
  // Both modules are lint-clean, so the root lint passes. (buf rejects
  // `  - path:` lines under `deps:` in every version, so an end-to-end
  // deps-bait fixture is unbuildable; the section-scoping of
  // readWorkspaceModules is pinned by the buf-parse unit tests below.)
  [
    "buf-lint-pass-deps-not-modules",
    "buf-lint/workspace-deps",
    "frontal-buf-lint",
    true,
  ],
  ["commit-msg-pass", "commit-msg/pass", "frontal-commit-msg", true],
  ["commit-msg-fail", "commit-msg/fail", "frontal-commit-msg", false],
  // A CJK subject that is 74 UTF-16 units (passes the 100-unit cap) but 160
  // UTF-8 bytes. Guards the shared checker's String.length measurement: a
  // regression to counting bytes (like `wc -c` did in the lefthook bridge)
  // would wrongly reject this subject, and the bridge is kept in sync with it.
  [
    "commit-msg-pass-utf16",
    "commit-msg/pass-utf16",
    "frontal-commit-msg",
    true,
  ],
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
  // Copy hooks/ — the simulated hook CHECKOUT the wrappers resolve against.
  cpSync(join(REPO_ROOT, "hooks"), join(repoDir, "hooks"), { recursive: true });
  // A consumer-root marker.  The wrappers resolve their scripts against the
  // CHECKOUT (their own directory's parent), so a consumer-root `hooks/` file
  // is invisible to them.  If a wrapper resolved scripts against the consumer
  // cwd instead, it would find this file and the test would fail — proving
  // checkout-resolution.
  mkdirSync(join(repoDir, "hooks"), { recursive: true });
  writeFileSync(
    join(repoDir, "hooks", "__consumer_marker__.sh"),
    "not-a-hook\n"
  );
  // The biome hook resolves its config (biome.jsonc) and the ultracite preset
  // through node_modules.  We build a SELF-CONTAINED node_modules (a real
  // directory tree, not a symlink) containing only the packages biome needs:
  // a symlink to REPO_ROOT's node_modules would let biome's `includes: ["**"]`
  // walk back to REPO_ROOT and lint its own files (including uncommitted
  // working-tree edits), which is not hermetic.  Real copies cannot be walked
  // out of.
  const nmDir = join(repoDir, "node_modules");
  mkdirSync(nmDir, { recursive: true });
  // Copy the ultracite preset and its dependencies.
  const ultracitePkg = JSON.parse(
    readFileSync(
      join(REPO_ROOT, "node_modules", "ultracite", "package.json"),
      "utf8"
    )
  );
  const ultraciteDeps = {
    ...(ultracitePkg.dependencies ?? {}),
    ...(ultracitePkg.peerDependencies ?? {}),
  };
  cpSync(
    join(REPO_ROOT, "node_modules", "ultracite"),
    join(nmDir, "ultracite"),
    { recursive: true }
  );
  for (const dep of Object.keys(ultraciteDeps)) {
    const src = join(REPO_ROOT, "node_modules", dep);
    if (existsSync(src)) {
      cpSync(src, join(nmDir, dep), { recursive: true });
    }
  }
  // Provide node_modules/.bin/biome so the test's PATH (which prepends
  // repoDir/node_modules/.bin) can find the biome executable.  Copy the real
  // biome CLI package + its platform binary instead of symlinking: a symlink
  // into REPO_ROOT would let biome resolve its location to the source repo,
  // which is not hermetic.
  const binDir = join(nmDir, ".bin");
  mkdirSync(binDir, { recursive: true });
  const biomePkgDir = join(REPO_ROOT, "node_modules", "@biomejs", "biome");
  if (existsSync(biomePkgDir)) {
    cpSync(biomePkgDir, join(nmDir, "@biomejs", "biome"), {
      recursive: true,
    });
    const platformDir = join(
      REPO_ROOT,
      "node_modules",
      `@biomejs/cli-${process.platform}-${process.arch}`
    );
    if (existsSync(platformDir)) {
      cpSync(
        platformDir,
        join(nmDir, `@biomejs/cli-${process.platform}-${process.arch}`),
        {
          recursive: true,
        }
      );
    }
    symlinkSync(
      join(nmDir, "@biomejs", "biome", "bin", "biome"),
      join(binDir, "biome")
    );
  }
  // Write a minimal, STANDALONE biome.jsonc for the consumer.  Intentionally
  // no `extends`: ultracite's core preset uses `files.includes: ["**"]` plus
  // `vcs.useIgnoreFile: true`, and when merged a consumer config's own
  // `includes` the preset's `**` still applies — which would make biome
  // lint the consumer's copied hooks/ (carrying REPO_ROOT's working-tree
  // lint state) and drag in gitignore machinery.  A standalone config with
  // an explicit file list keeps the consumer fully hermetic: biome only
  // ever sees the staged fixture files.
  writeFileSync(
    join(repoDir, "biome.jsonc"),
    `${JSON.stringify(
      {
        linter: { enabled: true },
        formatter: { enabled: true, indentStyle: "space", indentWidth: 2 },
        files: {
          includes: ["**", "!**/node_modules", "!**/hooks"],
        },
      },
      null,
      2
    )}\n`
  );
  execFileSync("git", ["add", "-A"], { cwd: repoDir });
}

function runHook(hook, repoDir, allFiles, extraArgs = []) {
  // `language: script`: pre-commit execs the entry script directly (not via
  // `sh -c`), resolving it to an absolute path in the checkout, with the
  // CONSUMER repo as cwd.  `$0` is the script's own path; the staged files /
  // the commit-msg path arrive as positional args $1…$n — there is no `--`
  // placeholder.  The wrapper resolves its node scripts against the checkout
  // (its own directory's parent) WITHOUT changing cwd, so the scoped tools
  // see the consumer repo as their project root.
  //
  //   - File-based hooks (biome, ruff): the staged files are the positional
  //     args ($1…$n); the wrapper's `"$@"` is exactly that list.
  //   - pass_filenames: false hooks (rustfmt, clippy, go-vet, buf-lint): no
  //     file args — they read staged state from git themselves.
  //   - commit-msg: the message path is the single positional arg ($1).
  //
  // We mirror this by invoking the wrapper (an absolute path in the
  // REPO_ROOT checkout) directly, with cwd = consumer repo (repoDir).
  const scriptPath = join(REPO_ROOT, hook.script);
  if (!existsSync(scriptPath)) {
    throw new Error(`wrapper script not found: ${scriptPath}`);
  }

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

  // No `--` placeholder: the staged files (or the commit-msg path) are the
  // script's positional args $1..$n, exactly as `language: script` delivers
  // them (the script's own path is $0).
  const args = [...files];
  const result = spawnSync(scriptPath, args, {
    cwd: repoDir,
    shell: false,
    encoding: "utf8",
    timeout: 60_000,
    env,
  });
  return {
    status: result.status,
    error: result.error,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function testReadWorkspaceModules(readWorkspaceModules) {
  const cases = [
    [
      // Bait: indented `  - path:` lines outside the modules section.
      [
        "version: v2",
        "deps:",
        "  - path: legacy-bait",
        "  - buf.build/googleapis/googleapis",
        "modules:",
        "  - path: api",
        "  - path: gen",
        "lint:",
        "  use: [STANDARD]",
      ],
      ["api", "gen"],
    ],
    [
      // Modules section with trailing blank/comment lines.
      [
        "version: v2",
        "modules:",
        "  - path: api",
        "",
        "  # comment",
        "  - path: gen/",
      ],
      ["api", "gen"],
    ],
    [
      // No modules key at all (standalone module manifest).
      ["version: v2", "module: buf.build/x/y"],
      [],
    ],
    [
      // deps: section before modules: — the v1-era ordering.
      [
        "version: v1",
        "deps:",
        "  - buf.build/googleapis/googleapis",
        "modules:",
        "  - path: a",
      ],
      ["a"],
    ],
  ];

  const failures = cases.map(([lines, expected]) => {
    const dir = mkdtempSync(join(tmpdir(), "buf-parse-"));
    try {
      writeFileSync(join(dir, "buf.yaml"), `${lines.join("\n")}\n`);
      const got = [...readWorkspaceModules(dir)].sort();
      const want = [...expected].sort();
      const ok = JSON.stringify(got) === JSON.stringify(want);
      console.log(
        `  ${ok ? "ok  " : "FAIL"}  buf-parse: got=[${got}] want=[${want}]`
      );
      return !ok;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  return failures.filter(Boolean).length;
}

async function main() {
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
    // A genuinely missing executable (ENOENT) is skipped; any other startup
    // error (e.g. EACCES) is a test error, not a skip.
    let toolMissing;
    try {
      toolMissing = !HOOK_TOOLS[hookId]();
    } catch (error) {
      results.push({
        caseId,
        hookId,
        status: "ERROR",
        reason: error.message,
      });
      failed += 1;
      continue;
    }
    if (toolMissing) {
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

      if (debug) {
        process.stderr.write(
          `\n===== ${caseId} (exit ${result.status ?? "n/a"}, signal ${result.signal ?? "none"}, expected ${expectPass ? "pass" : "fail"}) =====\n`
        );
        process.stderr.write(
          `--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}\n`
        );
      }

      // Only classify PASS/FAIL when the process completed with an exit
      // status.  A spawn error or signal termination (e.g. timeout kill)
      // is an execution problem, not a hook result, so report it as ERROR.
      if (result.error !== undefined) {
        results.push({
          caseId,
          hookId,
          status: "ERROR",
          reason: `execution error: ${result.error.message}`,
          output: (result.stderr || result.stdout).trim().slice(0, 300),
        });
        failed += 1;
        continue;
      }
      if (result.status === null && result.signal !== null) {
        results.push({
          caseId,
          hookId,
          status: "ERROR",
          reason: `terminated by signal: ${result.signal}`,
          output: (result.stderr || result.stdout).trim().slice(0, 300),
        });
        failed += 1;
        continue;
      }

      const actualPass = result.status === 0;
      const ok = actualPass === expectPass;

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

  // Unit-test the section-scoped buf.yaml parser in buf-lint-scoped.mjs.
  // A dynamic import is required because the file is ESM and exports
  // readWorkspaceModules for this purpose.  The hook's top-level body is
  // guarded by an entry-point check so the import is safe.
  const bufMod = await import(join(REPO_ROOT, "hooks", "buf-lint-scoped.mjs"));
  const bufParseFailures = testReadWorkspaceModules(
    bufMod.readWorkspaceModules
  );
  if (bufParseFailures > 0) {
    console.log(`\n${bufParseFailures} buf-parse unit test(s) failed\n`);
    process.exitCode = 1;
  } else {
    console.log("\nbuf-parse: 4/4 unit tests passed\n");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
