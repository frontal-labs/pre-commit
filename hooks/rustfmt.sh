#!/bin/sh
# frontend rustfmt (staged) — published pre-commit hook (frontal-rustfmt)
#
# pre-commit (`language: script`) execs this script directly, resolving it to
# an absolute path in the hook CHECKOUT, with the CONSUMER repo as cwd.  No
# file args are passed (pass_filenames: false); the staged Rust file list is
# re-read from git so that renames ("old new" pairs) do not confuse rustfmt.
#
# We resolve our scripts against the checkout as an ABSOLUTE path (the parent
# of the directory this file lives in) and do NOT change cwd — `git diff` and
# `rustfmt` must operate on the consumer repo's staged files.
set -e

checkout="$(cd -- "$(dirname -- "$0")/.." && pwd)"
node "$checkout/hooks/ensure-tool.mjs" rustfmt
rust_files=$(git diff --cached --name-only --diff-filter=ACMR -- "*.rs" | grep -vE "(^|/)gen/" || true)
if [ -n "$rust_files" ]; then
  printf "%s\n" "$rust_files" | xargs rustfmt --edition 2024 --check
fi
