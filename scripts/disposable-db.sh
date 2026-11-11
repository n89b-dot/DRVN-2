#!/usr/bin/env bash
# A throwaway Postgres built the way CI's sql-guard job builds one: the pinned
# supabase/postgres image, supabase/tests/ci_shim.sql, then every file in
# supabase/migrations/ applied in name order as supabase_admin. Use it to
# regenerate supabase/schema/ (npm run db:schema), run the SQL guards, or
# check the generated types, without touching shared dev or staging.
#
#   bash scripts/disposable-db.sh start [port]   # default 55440; rebuilds if it exists
#   bash scripts/disposable-db.sh start <port> <file.sql>…   # the image, the shim, then only these files
#   bash scripts/disposable-db.sh stop  [port]
#
# The second form is how a baseline is proven (plan 2 item A6): one database
# from every migration file, another from the baseline alone, then
# scripts/baseline/compare.sh.
#
# It listens on 127.0.0.1 only and holds nothing worth keeping. Needs Docker
# (on the Mac: `colima start` first) and psql.
set -euo pipefail

action="${1:-}"
port="${2:-55440}"
case "$port" in
  55440|55441|55442) ;;
  *) echo "Use port 55440, 55441 or 55442 (the ports the repo's scripts accept as disposable)." >&2; exit 1 ;;
esac
name="drvn-disposable-$port"
# The image the sql-guard job pins by digest (.github/workflows/ci.yml).
image="${DRVN_DISPOSABLE_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.165}"
root="$(cd "$(dirname "$0")/.." && pwd)"
export PGPASSWORD=postgres

case "$action" in
  start)
    docker rm -f "$name" >/dev/null 2>&1 || true
    docker run -d --name "$name" -e POSTGRES_PASSWORD=postgres -p "127.0.0.1:$port:5432" "$image" >/dev/null
    for _ in $(seq 1 90); do
      if psql -h 127.0.0.1 -p "$port" -U supabase_admin -d postgres -X -tAc "select 1" >/dev/null 2>&1; then ready=1; break; fi
      sleep 2
    done
    [ "${ready:-}" = 1 ] || { echo "The database did not start." >&2; exit 1; }
    # The image restarts Postgres once while it initialises; wait for the second start.
    sleep 3
    until psql -h 127.0.0.1 -p "$port" -U supabase_admin -d postgres -X -tAc "select 1" >/dev/null 2>&1; do sleep 1; done
    psql -h 127.0.0.1 -p "$port" -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 -f "$root/supabase/tests/ci_shim.sql" 2>&1 | grep -v 'already exists, skipping' || true
    count=0
    if [ $# -gt 2 ]; then files=("${@:3}"); what="given file(s)"; else files=("$root"/supabase/migrations/*.sql); what="migrations"; fi
    for file in "${files[@]}"; do
      [ -f "$file" ] || { echo "No such file: $file" >&2; exit 1; }
      if ! output=$(psql -h 127.0.0.1 -p "$port" -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 -f "$file" 2>&1); then
        echo "$output" >&2
        echo "Failed applying $file" >&2
        exit 1
      fi
      count=$((count + 1))
    done
    echo "Built $name on 127.0.0.1:$port from $count $what."
    echo "  schema:  DRVN_SCHEMA_DATABASE_URL=postgresql://supabase_admin:postgres@127.0.0.1:$port/postgres npm run db:schema"
    echo "  guards:  PGHOST=127.0.0.1 PGPORT=$port PGPASSWORD=postgres bash scripts/test-sql-guards.sh   (after the schema: guards leave rows behind)"
    ;;
  stop)
    docker rm -f "$name" >/dev/null 2>&1 && echo "Removed $name." || echo "$name was not running."
    ;;
  *)
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
