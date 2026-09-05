#!/usr/bin/env bash
# An intentionally narrow drill: ONLY a dedicated loopback container on 55441.
set -euo pipefail
: "${DRVN_RESTORE_DUMP:?Supply a local, synthetic backup archive}"
: "${DRVN_RESTORE_DISPOSABLE:?Set to local-container-55441}"
[ "$DRVN_RESTORE_DISPOSABLE" = local-container-55441 ] || exit 1
export PGPASSWORD=postgres
target='postgresql://supabase_admin:postgres@127.0.0.1:55441/postgres'
started=$(date +%s)
psql "$target" -v ON_ERROR_STOP=1 -q -c 'drop schema if exists public,auth,storage,extensions cascade'
pg_restore --section=pre-data --no-owner --exit-on-error --dbname="$target" "$DRVN_RESTORE_DUMP"
psql "$target" -v ON_ERROR_STOP=1 -q <<'SQL'
create extension if not exists pg_trgm with schema public;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_stat_statements with schema extensions;
SQL
pg_restore --section=data --no-owner --exit-on-error --dbname="$target" "$DRVN_RESTORE_DUMP"
pg_restore --section=post-data --no-owner --exit-on-error --dbname="$target" "$DRVN_RESTORE_DUMP"
psql "$target" -v ON_ERROR_STOP=1 -q <<'SQL'
-- Restored environments cannot invoke configured financial endpoints.
truncate public.job_config;
select count(*) as restored_users from auth.users;
select count(*) as restored_order_snapshots from public.order_items where commercial_snapshot is not null;
select count(*) as restored_storage_records from storage.objects;
select count(*) as restored_queue_records from public.remediation_jobs;
select count(*) as row_security_tables from pg_tables where schemaname='public' and rowsecurity;
SQL
printf 'Restore completed in %s seconds. Object bytes require their separate archive.\n' "$(( $(date +%s) - started ))"
