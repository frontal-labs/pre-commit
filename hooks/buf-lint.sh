#!/bin/sh
# frontend buf lint (scoped) — published pre-commit hook (frontal-buf-lint)
#
# pre-commit (`language: script`) execs this script directly, resolving it to
# an absolute path in the hook CHECKOUT, with the CONSUMER repo as cwd.  No
# file args are passed (pass_filenames: false); the scoped runner resolves
# each staged .proto file's owning buf module itself.
#
# We resolve our scripts against the checkout as an ABSOLUTE path (the parent
# of the directory this file lives in) and do NOT change cwd — buf-lint-scoped
# is a consumer-root tool (it calls `git rev-parse --show-toplevel` from the
# process cwd), so it runs with cwd = the consumer repo.
set -e

checkout="$(cd -- "$(dirname -- "$0")/.." && pwd)"
exec sh -c 'node "$1/hooks/ensure-tool.mjs" buf && node "$1/hooks/buf-lint-scoped.mjs"' -- "$checkout"
