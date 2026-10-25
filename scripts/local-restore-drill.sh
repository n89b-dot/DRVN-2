#!/usr/bin/env bash
# An intentionally narrow drill: ONLY a dedicated loopback container on 55441.
set -euo pipefail
: "${DRVN_RESTORE_DUMP:?Supply a local, synthetic backup archive}"
: "${DRVN_RESTORE_DISPOSABLE:?Set to local-container-55441}"
[ "$DRVN_RESTORE_DISPOSABLE" = local-container-55441 ] || exit 1
# Refuse to erase an unrelated local Postgres instance, even on the same port.
[ "$(docker port drvn-recovery-target 5432/tcp)" = "127.0.0.1:55441" ] || exit 1
# Use the target image's matching client, not a newer host pg_restore.
psql_target() { docker exec -i -e PGPASSWORD=postgres drvn-recovery-target psql -U supabase_admin -d postgres "$@"; }
restore_section() { docker exec -i -e PGPASSWORD=postgres drvn-recovery-target pg_restore --section="$1" --no-owner --exit-on-error --dbname=postgres -U supabase_admin < "$DRVN_RESTORE_DUMP"; }
started=$(date +%s)
psql_target -v ON_ERROR_STOP=1 -q -c 'drop schema if exists public,private,auth,storage,extensions cascade'
# Roles are cluster-level: the archive carries grants to agent_worker
# (20261021100100) but not the role, so a fresh target needs it first or
# pre-data stops at the first GRANT. Same shape as the migration: no login.
psql_target -v ON_ERROR_STOP=1 -q -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'agent_worker') then create role agent_worker nologin noinherit; end if; end \$\$"
restore_section pre-data
psql_target -v ON_ERROR_STOP=1 -q <<'SQL'
create extension if not exists pg_trgm with schema public;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_stat_statements with schema extensions;
SQL
restore_section data
restore_section post-data
psql_target -v ON_ERROR_STOP=1 -q <<'SQL'
-- Restored environments cannot invoke configured financial endpoints.
truncate public.job_config;
select count(*) as restored_users from auth.users;
select count(*) as restored_order_snapshots from public.order_items where commercial_snapshot is not null;
select count(*) as restored_storage_records from storage.objects;
select count(*) as restored_queue_records from public.remediation_jobs;
select count(*) as row_security_tables from pg_tables where schemaname='public' and rowsecurity;
SQL
printf 'Restore completed in %s seconds. Object bytes require their separate archive.\n' "$(( $(date +%s) - started ))"
