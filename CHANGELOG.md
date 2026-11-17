# Changelog

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
