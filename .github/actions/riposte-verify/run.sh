#!/usr/bin/env bash
# Runs riposte-sarif with the action's inputs. They arrive as INPUT_* environment variables (action.yml maps them) and are
# only ever passed as quoted arguments, never interpolated into a script.
set -euo pipefail
if [ -z "${INPUT_CLI:-}" ]; then
  echo "riposte-verify: no checker: set the cli input, or let the build step run" >&2
  exit 3
fi
args=(--files "${INPUT_FILES:-}" --ruleset "${INPUT_RULESET:-invoice}" --out "${INPUT_SARIF_FILE:-riposte.sarif}"
  --proof-dir "${INPUT_PROOF_DIR:-riposte-proofs}" --fail-on "${INPUT_FAIL_ON:-insufficient-data}" --root "${GITHUB_WORKSPACE:-$PWD}")
if [ -n "${INPUT_CATEGORY:-}" ]; then args+=(--category "$INPUT_CATEGORY"); fi
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then args+=(--summary "$GITHUB_STEP_SUMMARY"); fi
if [ -n "${GITHUB_OUTPUT:-}" ]; then args+=(--github-output "$GITHUB_OUTPUT"); fi
exec node "$INPUT_CLI" "${args[@]}"
