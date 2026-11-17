# Changelog

## 1.0.2 — 2026-11-17

### Fixed

- **`frontal-go-vet`: skip empty modules.**  Modules whose sources are
  entirely generated (e.g. proto/contract modules whose `gen/` tree is
  gitignored) have no packages on a fresh clone, and `go vet ./...` fails
  with "matched no packages" on content the author never wrote.
  `run-checks.mjs` skips exactly those: `go list ./...` exiting 0 with
  empty stdout means the pattern matched nothing.  A broken module (bad
  `go.mod`, unresolvable dependency) makes `go list` exit non-zero and is
  NOT skipped, so it still fails the gate.  The same skip is replicated in
  `lefthook-remote.yml`'s shell bridge (`/tmp/.frontal-golist.$$`).
- **`frontal-buf-lint`: section-scoped workspace-module parsing.**
  `hooks/buf-lint-scoped.mjs` previously collected every `  - path:` line
  in the root `buf.yaml`, including entries under `deps:`.  The parser is
  now section-scoped: only `  - path:` lines inside the top-level
  `modules:` section are collected.  `readWorkspaceModules` is exported for
  unit testing, and the hook's entry-point guard (`IS_ENTRY`) prevents the
  main body from running on import.
- **`lefthook-remote.yml` buf comment corrected.**  The v1.0.1 comment
  claimed the node hook's regex over-matched; both the node hook and the
  shell bridge are now section-scoped and consistent.

### Added

- **`buf-lint-pass-deps-not-modules` fixture + buf-parse unit tests.**
  A clean two-module v2 workspace (`api/proto` + `gen/proto`, both
  lint-clean) exercises workspace detection and root `buf lint`.
  Four parser unit tests pin the section-scoping (deps-bait,
  blank/comment lines, no-modules, v1 ordering).  An end-to-end
  deps-bait fixture is unbuildable: buf 1.70 rejects `- path:` under
  `deps:` in both v1 and v2 manifests.

Verified: all 17 hook test cases + 4 buf-parse unit tests pass.

## 1.0.1 — 2026-11-16

### Fixed

- `lefthook-remote.yml` is now fully self-contained.  Lefthook executes each
  `run:` with the **consumer** repo as cwd (the remote checkout lives under
  `.git/lefthook-remotes/` and is not on the execution path), so the v1.0.0
  bridge's `node hooks/*.mjs` references could never resolve.  The four scoped
  gates (`frontal-clippy`, `frontal-go-vet`, `frontal-buf-lint`,
  `frontal-commit-msg`) are now inlined as plain POSIX sh that walks the
  consumer's own `Cargo.toml` / `go.mod` / `buf.yaml`.
- Commit-message `Revert "..."` exemption: the double-quoted case pattern
  `"Revert ""*"` silently failed to match under `sh`; replaced with the
  single-quoted form `'Revert "'*`.
- Clippy flag construction: the `-p` flags are now accumulated separately and
  combined once (`clippy -p a -p b --all-targets -- -D warnings`) instead of
  being prepended to an existing command string, which duplicated the word
  `clippy`.
- Walk-up loops are bounded by the path's own component depth (no `while
  true`); they terminate when `dir` reaches `.`.
- Buf workspace-module detection: the bridge now parses only the top-level
  `modules:` list in the root `buf.yaml` (awk, section-scoped), so `deps:`
  entries — bare BSR references like `- buf.build/foo/bar` — can no longer be
  misread as workspace modules.  `hooks/buf-lint-scoped.mjs` documents this
  intent but its single regex over-matches; the bridge implements the
  documented behavior (both still pass the test suite).

Verified end-to-end under `sh` (dash): all four scoped gates + rustfmt +
ruff pass and fail correctly in fixture repos (including a v2 buf workspace
fixture matching frontal's own `buf.yaml` layout); 13/13 commit-message
cases.

## 1.0.0 — 2026-11-16

Initial release.  Frontal's git-hook gates, published as a pre-commit hook
collection and a lefthook remote config.

### Hooks

- `frontal-biome` — Biome check (check-only) on staged JS/TS/JSON files
- `frontal-ruff` — `ruff check` + `ruff format --check` on staged Python files
- `frontal-rustfmt` — `rustfmt --edition 2024 --check` on staged Rust files only
- `frontal-clippy` — `cargo clippy --all-targets -D warnings` scoped per crate
  workspace
- `frontal-go-vet` — `go vet ./...` in each Go module that owns a staged Go file
- `frontal-buf-lint` — `buf lint` for each proto module that owns a staged
  `.proto` file
- `frontal-commit-msg` — Conventional Commits validation (replaces commitlint)

### Other

- `hooks/ensure-tool.mjs` — every hook fails loudly when its tool is missing
- `lefthook-remote.yml` — lefthook bridge with identical commands
- `tests/` — 15-case test suite with pass/fail fixtures per hook
- Shared excludes: `vendor/`, `gen/`, `generated/`, `node_modules/`
- `.pre-commit-hooks.yaml` — hook definitions for pre-commit consumers
- GitHub Actions release workflow (tag-triggered)
- Repo self-lints with Biome via the ultracite preset
  (`biome.jsonc` extends `ultracite/biome/core`; `@biomejs/biome` +
  `ultracite` as devDependencies, `npm run check` / `npm run format`)
