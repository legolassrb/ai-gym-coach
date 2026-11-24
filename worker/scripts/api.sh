#!/usr/bin/env bash
# Call the gym coach API signed in as a user (signs in, then sends the session token).
#
#   scripts/api.sh [--local] METHOD PATH [JSON_BODY]
#
#   scripts/api.sh GET /api/diag
#   scripts/api.sh GET /api/progress
#   scripts/api.sh POST /api/plan '{"location":"home","minutes":30}'
#   scripts/api.sh --local GET /api/admin/users
#
# Config: GYM_API_URL, GYM_USER and GYM_PASSWORD, from the environment or
# worker/.api.env (gitignored). A missing password is prompted for.
# --local uses http://localhost:8787 instead of GYM_API_URL.
set -euo pipefail

WORKER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() { sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }

# Read KEY=value from a dotenv-style file without sourcing it.
read_var() { [ -f "$1" ] || return 0; sed -n "s/^$2=//p" "$1" | tail -1 | sed 's/^["'\'']//; s/["'\'']$//'; }

local_mode=0
if [ "${1:-}" = "--local" ]; then local_mode=1; shift; fi
[ $# -ge 2 ] || usage

method="$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')"
path="$2"
body="${3:-}"
case "$path" in /*) ;; *) path="/$path" ;; esac

user="${GYM_USER:-$(read_var "$WORKER_DIR/.api.env" GYM_USER)}"
pass="${GYM_PASSWORD:-$(read_var "$WORKER_DIR/.api.env" GYM_PASSWORD)}"
if [ "$local_mode" = 1 ]; then
  url="http://localhost:8787"
else
  url="${GYM_API_URL:-$(read_var "$WORKER_DIR/.api.env" GYM_API_URL)}"
  if [ -z "$url" ]; then
    echo "GYM_API_URL is not set. Add it to $WORKER_DIR/.api.env, e.g.:" >&2
    echo "  GYM_API_URL=https://ai-gym-coach-api.<subdomain>.workers.dev" >&2
    exit 1
  fi
fi
url="${url%/}"

token=""
if [ "$path" != "/api/health" ]; then
  if [ -z "$user" ]; then
    echo "GYM_USER is not set. Add GYM_USER (and optionally GYM_PASSWORD) to $WORKER_DIR/.api.env" >&2
    exit 1
  fi
  if [ -z "$pass" ]; then
    read -rsp "Password for $user: " pass </dev/tty; echo >&2
  fi
  login="$(jq -n --arg u "$user" --arg p "$pass" '{username:$u,password:$p}')"
  token="$(curl -sS -H "Content-Type: application/json" --data "$login" "$url/api/auth/login" | jq -r '.token // empty')"
  if [ -z "$token" ]; then
    echo "Sign-in failed for $user at $url" >&2
    exit 1
  fi
fi

args=(-sS -X "$method" -H "Authorization: Bearer $token" -w '\n%{http_code}')
[ -n "$body" ] && args+=(-H "Content-Type: application/json" --data "$body")

out="$(curl "${args[@]}" "$url$path")"
status="${out##*$'\n'}"
resp="${out%$'\n'*}"

if command -v jq >/dev/null && printf '%s' "$resp" | jq -e . >/dev/null 2>&1; then
  printf '%s' "$resp" | jq .
else
  printf '%s\n' "$resp"
fi
echo "HTTP $status" >&2
[ "${status:0:1}" = 2 ]
