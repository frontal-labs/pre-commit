# Frontal Pre-Commit Hooks

Frontal's git-hook gates, published as a [pre-commit](https://pre-commit.com) hook
collection and a [lefthook](https://github.com/evilmartians/lefthook) remote
config. Every hook fails loudly when its tool is missing — no silent passes.

## Hooks

| ID | Description | Tool |
|---|---|---|
| `frontal-biome` | Biome check (check-only) on staged JS/TS/JSON files | `pnpm exec biome` |
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
    rev: v1.0.0
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
pre-commit install
```

Pick only the hooks you need.  All hooks are optional; include just the ones
that apply to your repo.

## Usage with lefthook

Add a `remotes:` entry to your `lefthook.yml`:

```yaml
remotes:
  - git_url: https://github.com/frontal-labs/pre-commit
    ref: v1.0.0
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
(`pnpm` + `biome`, `rustfmt`, `cargo clippy`, `go`, `buf`, etc.).

## Tool requirements

Each hook requires its tool on `PATH`:

- **frontal-biome**: `pnpm` (runs `biome` via `pnpm exec`)
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
# Run the full test suite (15 cases; 2 skipped if biome is not installed)
node tests/run-hooks.test.mjs

# Run a single case
node tests/run-hooks.test.mjs clippy-fail --debug
```

Fixtures live in `tests/fixtures/`.  Each fixture is a minimal repo shape that
the hook must accept (pass) or reject (fail).

## License

[MIT](LICENSE.md)
