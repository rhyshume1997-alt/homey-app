#!/usr/bin/env bash
# Applies supabase/tests/bootstrap.sql + migrations to a Postgres and runs the RLS tests.
# DATABASE_URL set (CI): use it. Otherwise create a throwaway local cluster.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT=54329
TMP=""
RUNAS=()

cleanup() {
  if [ -n "$TMP" ]; then
    "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$TMP"
  fi
}
trap cleanup EXIT

if [ -z "${DATABASE_URL:-}" ]; then
  TMP="$(mktemp -d)"
  if [ "$(id -u)" = "0" ]; then
    # initdb/postgres refuse to run as root: use an unprivileged user.
    PGUSER_OS=nobody
    chown "$PGUSER_OS" "$TMP"
    RUNAS=(runuser -u "$PGUSER_OS" --)
  fi
  chmod 700 "$TMP"
  "${RUNAS[@]}" "$PGBIN/initdb" -D "$TMP/data" -U postgres --auth=trust -E UTF8 >/dev/null
  "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -w -l "$TMP/pg.log" \
    -o "-p $PORT -k $TMP -c listen_addresses=''" start >/dev/null
  "$PGBIN/createdb" -h "$TMP" -p "$PORT" -U postgres ourhome_test
  export ADMIN_DATABASE_URL="postgresql://postgres@localhost/ourhome_test?host=$TMP&port=$PORT"
else
  export ADMIN_DATABASE_URL="$DATABASE_URL"
fi

PSQL="$PGBIN/psql"
command -v "$PSQL" >/dev/null 2>&1 || PSQL="psql"

"$PSQL" "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/bootstrap.sql"
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
  "$PSQL" "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

# The tests connect as superuser (fixtures, catalog checks) and SET ROLE to API roles.
cd "$ROOT"
npx vitest run --config vitest.rls.config.ts "$@"
