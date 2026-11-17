#!/bin/sh
# frontend cargo clippy (scoped) — published pre-commit hook (frontal-clippy)
#
# pre-commit (`language: script`) execs this script directly, resolving it to
# an absolute path in the hook CHECKOUT, with the CONSUMER repo as cwd.  No
# file args are passed (pass_filenames: false); the scoped runner resolves
# each staged .rs file's owning crate workspace itself.
#
# We resolve our scripts against the checkout as an ABSOLUTE path (the parent
# of the directory this file lives in) and do NOT change cwd — clippy-scoped
# is a consumer-root tool (it calls `git rev-parse --show-toplevel` from the
# process cwd), so it runs with cwd = the consumer repo.
set -e

checkout="$(cd -- "$(dirname -- "$0")/.." && pwd)"
exec sh -c 'node "$1/hooks/ensure-tool.mjs" cargo && node "$1/hooks/clippy-scoped.mjs"' -- "$checkout"
