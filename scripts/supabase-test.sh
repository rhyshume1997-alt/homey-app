#!/usr/bin/env bash
# Local Supabase stack for the real-API suite (tests/supabase/**).
#   bash scripts/supabase-test.sh start   start the stack (services we do not need are excluded)
#   bash scripts/supabase-test.sh env     write .env.supabase-test.local from `supabase status -o env`
#   bash scripts/supabase-test.sh run     (default) start if needed, write env, run vitest, stop what we started
#   bash scripts/supabase-test.sh stop    stop the stack and discard its data
# Loopback only: refuses to write the env file (so the tests cannot run) unless both the API and DB
# URLs point at 127.0.0.1. Never aim this at a hosted project.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env.supabase-test.local"
SUPABASE="${SUPABASE_BIN:-supabase}"
EXCLUDE="studio,mailpit,realtime,edge-runtime,logflare,vector,imgproxy,postgres-meta,supavisor"

cmd_start() {
  (cd "$ROOT" && "$SUPABASE" start -x "$EXCLUDE")
}

cmd_stop() {
  rm -f "$ENV_FILE"
  (cd "$ROOT" && "$SUPABASE" stop --no-backup)
}

pick() { # pick KEY... : first non-empty value of `KEY="value"` lines in $RAW
  local k v
  for k in "$@"; do
    v="$(printf '%s\n' "$RAW" | sed -n "s/^${k}=\"\{0,1\}\(.*[^\"]\)\"\{0,1\}\$/\1/p" | head -n1)"
    if [ -n "$v" ]; then printf '%s' "$v"; return 0; fi
  done
  return 0
}

cmd_env() {
  rm -f "$ENV_FILE"
  RAW="$(cd "$ROOT" && "$SUPABASE" status -o env 2>/dev/null)"
  local api db anon service
  api="$(pick API_URL)"
  db="$(pick DB_URL)"
  anon="$(pick ANON_KEY PUBLISHABLE_KEY)"
  service="$(pick SERVICE_ROLE_KEY SECRET_KEY)"
  if [ -z "$api" ] || [ -z "$db" ] || [ -z "$anon" ] || [ -z "$service" ]; then
    echo "supabase-test: could not read API_URL/DB_URL/keys from 'supabase status -o env'. Is the stack running?" >&2
    exit 1
  fi
  if ! printf '%s' "$api" | grep -Eq '^https?://127\.0\.0\.1[:/]'; then
    echo "supabase-test: refusing non-loopback API URL (must be 127.0.0.1)." >&2
    exit 1
  fi
  if ! printf '%s' "$db" | grep -Eq '^postgres(ql)?://[^@]*@127\.0\.0\.1[:/]'; then
    echo "supabase-test: refusing non-loopback DB URL (must be 127.0.0.1)." >&2
    exit 1
  fi
  umask 077
  {
    echo "SUPABASE_TEST_API_URL=$api"
    echo "SUPABASE_TEST_DB_URL=$db"
    echo "SUPABASE_TEST_ANON_KEY=$anon"
    echo "SUPABASE_TEST_SERVICE_ROLE_KEY=$service"
  } > "$ENV_FILE"
}

cmd_run() {
  local started=0
  if ! (cd "$ROOT" && "$SUPABASE" status >/dev/null 2>&1); then
    cmd_start
    started=1
  fi
  if [ "$started" = "1" ]; then
    trap 'cmd_stop || true' EXIT
  fi
  cmd_env
  cd "$ROOT"
  npx vitest run --config vitest.supabase.config.ts "$@"
}

sub="${1:-run}"
[ "$#" -gt 0 ] && shift
case "$sub" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  env) cmd_env ;;
  run) cmd_run "$@" ;;
  *) echo "usage: $0 {start|stop|env|run}" >&2; exit 2 ;;
esac
