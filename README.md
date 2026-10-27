# Frontal Pre-Commit

This repository provides configuration which makes it easy to use Frontal's linter with pre-commit.

## Usage

First, in the root of your repository, create a `.pre-commit-config.yaml` file containing:

```yaml
repos:
  - repo: https://github.com/frontal/pre-commit
    rev: main
    hooks:
      - id: frontal-lint
```

If you already have a `.pre-commit-config.yaml` file, just add this alongside other pre-commit hook config under the `repos` key.

Then, run:

```sh
pre-commit install
```

From now on, when you run `git commit`, Frontal lint will execute.

## Usage with GitHub Action

This frontal-pre-commit plugin assumes that you have Frontal available on your PATH.

In GitHub Actions, you can ensure this by first installing your dependencies, and then using the Frontal action:

```yaml
steps:
  - uses: actions/setup-python@v4
    with:
      python-version: '3.10'
      cache: 'pip'

  - name: "Install dependencies"
    run: pip install -r requirements.txt

  - uses: frontal/cli-action@v1
    with:
      client-id: ...
      client-secret: ...

  - uses: pre-commit/action@v3.0.0
```
