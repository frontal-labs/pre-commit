#!/bin/sh
# frontend ruff (check + format) — published pre-commit hook (frontal-ruff)
#
# pre-commit (`language: script`) execs this script directly, resolving it to
# an absolute path in the hook CHECKOUT, with the CONSUMER repo as cwd.  The
# staged files arrive as the script's positional args ($1..$n); there is no
# `--` placeholder (the script's own path is $0).
#
# We resolve our scripts against the checkout as an ABSOLUTE path (the parent
# of the directory this file lives in) and do NOT change cwd — ruff resolves
# its config and files relative to the consumer repo.  "$@" is the staged
# file list, passed straight through.
set -e

checkout="$(cd -- "$(dirname -- "$0")/.." && pwd)"
# The inner sh receives $1=checkout and $2..$n = the staged files.  Capture
# $1, then shift so "$@" is exactly the file list (not the checkout path we
# already consumed).
exec sh -c '_co="$1"; shift; node "$_co/hooks/ensure-tool.mjs" ruff && ruff check "$@" && ruff format --check "$@"' -- "$checkout" "$@"
