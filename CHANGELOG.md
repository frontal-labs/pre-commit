# Changelog

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
