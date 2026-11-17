#!/bin/sh
# frontend go vet (scoped) — published pre-commit hook (frontal-go-vet)
#
# pre-commit (`language: script`) execs this script directly, resolving it to
# an absolute path in the hook CHECKOUT, with the CONSUMER repo as cwd.  No
# file args are passed (pass_filenames: false); the scoped runner resolves
# each staged Go file's owning module itself.
#
# We resolve our scripts against the checkout as an ABSOLUTE path (the parent
# of the directory this file lives in) and do NOT change cwd — go-vet-scoped
# is a consumer-root tool (it calls `git rev-parse --show-toplevel` from the
# process cwd), so it runs with cwd = the consumer repo.
set -e

checkout="$(cd -- "$(dirname -- "$0")/.." && pwd)"
exec sh -c 'node "$1/hooks/ensure-tool.mjs" go && node "$1/hooks/go-vet-scoped.mjs"' -- "$checkout"
