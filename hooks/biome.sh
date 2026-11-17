#!/bin/sh
# frontend biome check — published pre-commit hook (frontal-biome)
#
# pre-commit (`language: script`) execs this script directly, resolving it to
# an absolute path in the hook CHECKOUT, with the CONSUMER repo as cwd.  The
# staged files arrive as the script's positional args ($1..$n); there is no
# `--` placeholder (the script's own path is $0).
#
# We resolve our scripts against the checkout as an ABSOLUTE path (the parent
# of the directory this file lives in) and do NOT change cwd — biome resolves
# its config and files relative to the consumer repo.  "$@" is the staged
# file list, passed straight through.
set -e

checkout="$(cd -- "$(dirname -- "$0")/.." && pwd)"
# Pin biome's configuration to the CONSUMER repo.  We pass the config FILE
# path (not a directory) to --config-path: the directory form still lets
# biome walk upward for a project root, which — in any layout where the hook
# checkout sits under a directory that also carries a biome config — makes
# biome lint the checkout's own files instead of the consumer's.  A file path
# is used verbatim, so biome's project root is exactly the consumer repo.
#
# The consumer's config is biome.jsonc (or biome.json) at the repo root,
# which is the cwd pre-commit gives us.  If neither exists, fall back to the
# directory form so biome applies its defaults.
config_path="$PWD"
for candidate in "$PWD/biome.jsonc" "$PWD/biome.json"; do
  if [ -f "$candidate" ]; then
    config_path="$candidate"
    break
  fi
done

# The inner sh receives $1=checkout, $2=config path, and $3..$n = the staged
# files.  Capture the first two, then `shift 2` so `"$@"` is exactly the file
# list (not the checkout/config we already consumed).
exec sh -c '_co="$1"; _cfg="$2"; shift 2; node "$_co/hooks/ensure-tool.mjs" biome && biome check --no-errors-on-unmatched --config-path="$_cfg" "$@"' -- "$checkout" "$config_path" "$@"
