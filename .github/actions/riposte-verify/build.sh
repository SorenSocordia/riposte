#!/usr/bin/env bash
# Builds riposte-sarif from this action's own repository (where the runner downloaded the action, not the caller's
# checkout): npm ci at its root, from the package-lock.json the repository ships, then the adapters bundle. Writes
# cli=<path> to $GITHUB_OUTPUT. With no package-lock.json there it stops, exit 1, and says so: it never falls back to an
# install that resolves dependencies on the day it runs.
set -euo pipefail
root="$(cd "$GITHUB_ACTION_PATH/../../.." && pwd)"
cd "$root"
if [ ! -f package-lock.json ]; then
  msg="riposte-verify: $root has no package-lock.json, so the checker is not built: this step installs only with npm ci, from the lockfile. Pin the action to a commit whose tree ships package-lock.json, or build riposte-sarif yourself and pass its path as the cli input."
  echo "::error title=riposte-verify::$msg"
  echo "$msg" >&2
  exit 1
fi
npm ci --no-audit --no-fund
npm run build -w riposte-adapters
cli="$root/packages/adapters/bin/riposte-sarif.mjs"
if [ ! -f "$cli" ]; then
  echo "riposte-verify: the build did not produce $cli" >&2
  exit 1
fi
echo "cli=$cli" >> "$GITHUB_OUTPUT"
