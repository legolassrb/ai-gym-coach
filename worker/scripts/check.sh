#!/usr/bin/env bash
# Smoke-check a deployed (or --local) worker: health, auth, and the Claude key.
#
#   scripts/check.sh [--local]
set -uo pipefail

API="$(dirname "${BASH_SOURCE[0]}")/api.sh"
fail=0

echo "== /api/health"
"$API" "$@" GET /api/health || fail=1

echo "== /api/diag"
diag="$("$API" "$@" GET /api/diag)" || { echo "$diag"; fail=1; }
echo "$diag"
case "$diag" in
  *'"API key'*) echo "OK: worker has an Anthropic API key" ;;
  *) echo "PROBLEM: ANTHROPIC_API_KEY is not an sk-ant-api key; run: npx wrangler secret put ANTHROPIC_API_KEY"; fail=1 ;;
esac

exit $fail
