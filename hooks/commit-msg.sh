#!/bin/sh
# frontend commit-msg (Conventional Commits) — published pre-commit hook
# (frontal-commit-msg)
#
# pre-commit (`language: script`) execs this script directly, resolving it to
# an absolute path in the hook CHECKOUT, with the CONSUMER repo as cwd.  The
# commit message file arrives as the script's first positional arg ($1); the
# script's own path is $0.  We resolve our script against the checkout as an
# ABSOLUTE path (the parent of the directory this file lives in) and pass the
# message path to the checker as its first argument.
set -e

checkout="$(cd -- "$(dirname -- "$0")/.." && pwd)"
exec node "$checkout/hooks/check-commit-message.mjs" "$1"
