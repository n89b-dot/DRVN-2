#!/usr/bin/env bash
# A disposable Postgres with every migration applied and the volume seed
# loaded. THROWAWAY ONLY: it deletes and recreates its own container.
#   PARTS=2000000 bash scripts/perf/fresh-db.sh
#   UPTO=20261010100100 ...   stop after that migration (a "before" database)
# Postgres 17 (supabase/config.toml's major_version) on 127.0.0.1:55441, with
# settings sized for a 4 GB database server: production-shaped plans, not
# laptop defaults.
set -euo pipefail
NAME="${NAME:-drvn-scale-db}"
PORT="${PORT:-55441}"
PARTS="${PARTS:-60000}"
IMAGE="${IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.165}"
case "$PORT" in 55441|55443|55445) ;; *) echo "Throwaway ports only (55441, 55443, 55445)" >&2; exit 1 ;; esac
case "$NAME" in drvn-scale-*|drvn-plans-*) ;; *) echo "Container name must start drvn-scale- or drvn-plans-" >&2; exit 1 ;; esac
cd "$(dirname "$0")/../.."
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --shm-size=1g -e POSTGRES_PASSWORD=postgres -p "127.0.0.1:$PORT:5432" "$IMAGE" \
  postgres -D /etc/postgresql -c shared_buffers=1GB -c effective_cache_size=3GB -c work_mem=8MB \
  -c maintenance_work_mem=512MB -c max_wal_size=8GB -c checkpoint_timeout=30min \
  -c max_parallel_maintenance_workers=2 -c random_page_cost=1.1 >/dev/null
export PGPASSWORD=postgres PGHOST=127.0.0.1 PGPORT="$PORT" PGUSER=supabase_admin PGDATABASE=postgres
until psql -Atqc 'select 1' >/dev/null 2>&1; do sleep 2; done
sleep 5 # the image restarts once after its init scripts
until psql -Atqc 'select 1' >/dev/null 2>&1; do sleep 2; done
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/ci_shim.sql >/dev/null 2>&1
for f in supabase/migrations/*.sql; do
  v="$(basename "$f")"; v="${v%%_*}"
  if [ -n "${UPTO:-}" ] && [[ "$v" > "$UPTO" ]]; then break; fi
  psql -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || { echo "migration failed: $f" >&2; psql -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null; exit 1; }
done
psql -q -c "alter role authenticator with password 'postgres'"
psql -q -v parts="$PARTS" -f scripts/perf/seed-volume.sql

# A real PostgREST in front of it, on PORT+1: scripts/perf/api-timings.sh.
docker network create drvn-scale-net >/dev/null 2>&1 || true
docker network connect drvn-scale-net "$NAME" 2>/dev/null || true
docker rm -f "$NAME-rest" >/dev/null 2>&1 || true
docker run -d --name "$NAME-rest" --network drvn-scale-net -p "127.0.0.1:$((PORT + 1)):3000" \
  -e PGRST_DB_URI="postgres://authenticator:postgres@$NAME:5432/postgres" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_DB_POOL=10 \
  -e PGRST_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long \
  public.ecr.aws/supabase/postgrest:v16.1 >/dev/null
echo "PostgREST: http://127.0.0.1:$((PORT + 1))"
