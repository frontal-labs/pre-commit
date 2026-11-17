# Frontal Pre-Commit Hooks

Frontal's git-hook gates, published as a [pre-commit](https://pre-commit.com) hook
collection and a [lefthook](https://github.com/evilmartians/lefthook) remote
config. Every hook fails loudly when its tool is missing — no silent passes.

## Hooks

| ID | Description | Tool |
|---|---|---|
| `frontal-biome` | Biome check (check-only) on staged JS/TS/JSON files | `biome` |
| `frontal-ruff` | `ruff check` + `ruff format --check` on staged Python files | `ruff` |
| `frontal-rustfmt` | `rustfmt --edition 2024 --check` on staged Rust files only | `rustfmt` |
| `frontal-clippy` | `cargo clippy --all-targets -D warnings` scoped to the crate workspaces that own staged Rust files | `cargo clippy` |
| `frontal-go-vet` | `go vet ./...` in each Go module that owns a staged Go file | `go` |
| `frontal-buf-lint` | `buf lint` for each proto module that owns a staged `.proto` file | `buf` |
| `frontal-commit-msg` | Conventional Commits validation (replaces commitlint) | `node` |

Shared excludes: `vendor/`, `gen/`, `generated/`, `node_modules/`.

## Usage with pre-commit

Add to your `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/frontal-labs/pre-commit
    rev: v1.0.2
    hooks:
      - id: frontal-biome
      - id: frontal-ruff
      - id: frontal-rustfmt
      - id: frontal-clippy
      - id: frontal-go-vet
      - id: frontal-buf-lint
      - id: frontal-commit-msg
```

Then run:

```sh
# pre-commit stage hooks (biome, ruff, rustfmt, clippy, go-vet, buf-lint)
pre-commit install

# commit-msg stage hook (frontal-commit-msg)
pre-commit install --hook-type commit-msg
```

Each hook's stage is declared in `.pre-commit-hooks.yaml` (all pre-commit
hooks use `stages: [pre-commit]`, `frontal-commit-msg` uses
`stages: [commit-msg]`), so the commit-msg dispatcher must be installed
separately with `pre-commit install --hook-type commit-msg` — otherwise
`frontal-commit-msg` is never registered.  If you drop `frontal-commit-msg`
from your config, the second install line is not needed.

Pick only the hooks you need.  All hooks are optional; include just the ones
that apply to your repo.

## Usage with lefthook

Add a `remotes:` entry to your `lefthook.yml`:

```yaml
remotes:
  - git_url: https://github.com/frontal-labs/pre-commit
    ref: v1.0.2
    configs: [lefthook-remote.yml]
```

The remote config mirrors every gate in the pre-commit collection with
identical commands.

## CI (GitHub Actions)

```yaml
steps:
  - uses: actions/checkout@v4

  - uses: actions/setup-node@v4
    with:
      node-version: '22'

  - uses: actions/setup-python@v5
    with:
      python-version: '3.13'

  - name: Install ruff
    run: pip install ruff

  - name: Run pre-commit
    uses: pre-commit/action@v3.0.0
```

Adjust the install steps for whichever tools your enabled hooks require
(`biome`, `rustfmt`, `cargo clippy`, `go`, `buf`, etc.).

## Tool requirements

Each hook requires its tool on `PATH`:

- **frontal-biome**: `biome` (`npx @biomejs/biome` or a global install)
- **frontal-ruff**: `ruff`
- **frontal-rustfmt**: `rustfmt`
- **frontal-clippy**: `cargo` + the `clippy` component (`rustup component add clippy`)
- **frontal-go-vet**: `go`
- **frontal-buf-lint**: `buf`
- **frontal-commit-msg**: `node` (>= 20)

If a tool is missing, the hook exits non-zero with a clear message instead of
skipping silently.

## Development

```sh
npm install            # dev deps: @biomejs/biome + ultracite (needed for biome cases)
npm test               # full suite: 15 cases (biome skipped if its tool is missing)
npm run check          # biome self-check of this repo's hooks/ + tests/
node tests/run-hooks.test.mjs clippy-fail --debug   # single case, keep the repo
```

This repo lints and formats its own `hooks/` and `tests/` with the same
ultracite preset the `frontal-biome` hook runs for consumers
(`biome.jsonc` extends `ultracite/biome/core`).

Fixtures live in `tests/fixtures/`.  Each fixture is a minimal repo shape that
the hook must accept (pass) or reject (fail).

## License

[MIT](LICENSE.md)
