#!/usr/bin/env bash
# No hosted or existing application database is accepted by this rehearsal.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
report=${1:?Usage: bash scripts/local-recovery-rehearsal.sh REPORT.json}
image='supabase/postgres:15.14.1.158'
source_name=drvn-recovery-source
target_name=drvn-recovery-target
for name in "$source_name" "$target_name"; do
 if docker inspect "$name" >/dev/null 2>&1; then
  echo "Refusing to replace existing container: $name" >&2; exit 1
 fi
done
scratch=$(mktemp -d /tmp/drvn-recovery.XXXXXX)
created_source=false
created_target=false
cleanup() {
 if $created_target; then docker stop "$target_name" >/dev/null; fi
 if $created_source; then docker stop "$source_name" >/dev/null; fi
 rm -rf "$scratch"
}
trap cleanup EXIT
started=$(date +%s)
docker run --rm -d --name "$source_name" -e POSTGRES_PASSWORD=postgres "$image" >/dev/null
created_source=true
docker run --rm -d --name "$target_name" -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55441:5432 "$image" >/dev/null
created_target=true
for name in "$source_name" "$target_name"; do
 ready=false
 for attempt in {1..30}; do
  if docker exec "$name" pg_isready -h 127.0.0.1 -U supabase_admin >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
 done
 $ready || { echo "Database failed to start: $name" >&2; exit 1; }
done
source_sql() { docker exec -i "$source_name" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"; }
target_sql() { docker exec -i "$target_name" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"; }
source_sql -q < supabase/tests/ci_shim.sql > "$scratch/schema.log" 2>&1
migrations=0
for file in supabase/migrations/*.sql; do
 if ! source_sql -q < "$file" >> "$scratch/schema.log" 2>&1; then tail -20 "$scratch/schema.log" >&2; exit 1; fi
 migrations=$((migrations+1))
done
source_sql -q < scripts/fixtures/recovery-seed.sql
source_sql -At < scripts/fixtures/recovery-fingerprint.sql > "$scratch/source.jsonl"
docker exec "$source_name" pg_dump -U supabase_admin -d postgres -Fc --no-owner --schema=public --schema=private --schema=auth --schema=storage --schema=extensions > "$scratch/database.dump"
# Database backups exclude Storage bytes. Archive them separately at the same
# synthetic recovery point; the manifest also binds bytes to a restored row.
mkdir -p "$scratch/objects/dispute-evidence/recovery-fixture" "$scratch/restored-objects"
printf 'Synthetic DRVN recovery evidence\n' > "$scratch/objects/dispute-evidence/recovery-fixture/evidence.txt"
tar -cf "$scratch/objects.tar" -C "$scratch/objects" .
DRVN_RESTORE_DUMP="$scratch/database.dump" DRVN_RESTORE_DISPOSABLE=local-container-55441 bash scripts/local-restore-drill.sh > "$scratch/restore.log" 2>&1 || { tail -20 "$scratch/restore.log" >&2; exit 1; }
target_sql -q < supabase/tests/restore_integrity.sql
target_sql -At < scripts/fixtures/recovery-fingerprint.sql > "$scratch/target.jsonl"
cmp "$scratch/source.jsonl" "$scratch/target.jsonl"
[ "$(target_sql -At -c 'select count(*) from public.job_config')" = 0 ]
[ "$(target_sql -At -c "select count(*) from storage.objects where bucket_id='dispute-evidence' and name='recovery-fixture/evidence.txt'")" = 1 ]
# A fresh image may not install pg_cron at all. If present it must be idle.
if [ "$(target_sql -At -c "select to_regclass('cron.job') is not null")" = t ]; then
 [ "$(target_sql -At -c 'select count(*) from cron.job where active')" = 0 ]
fi
tar -xf "$scratch/objects.tar" -C "$scratch/restored-objects"
cmp "$scratch/objects/dispute-evidence/recovery-fixture/evidence.txt" "$scratch/restored-objects/dispute-evidence/recovery-fixture/evidence.txt"
node - "$scratch" "$report" "$migrations" "$started" <<'JS'
const fs=require('node:fs');const crypto=require('node:crypto');
const [scratch,report,migrations,started]=process.argv.slice(2);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const tables=fs.readFileSync(scratch+'/target.jsonl','utf8').trim().split('\n').map(JSON.parse);
fs.writeFileSync(report,JSON.stringify({observedAt:new Date().toISOString(),scope:'Fresh synthetic local database and separate object archive; not hosted recovery, provider reconciliation or approved RPO/RTO',migrations:Number(migrations),elapsedSeconds:Math.round(Date.now()/1000-Number(started)),matchingTables:tables.length,matchingRows:tables.reduce((n,t)=>n+t.rows,0),databaseArchiveSha256:hash(scratch+'/database.dump'),object:{bucket:'dispute-evidence',path:'recovery-fixture/evidence.txt',sha256:hash(scratch+'/restored-objects/dispute-evidence/recovery-fixture/evidence.txt'),restoredReferenceVerified:true},outboundConfigCleared:true,activeSchedules:0,restoreIntegrity:'passed',tableFingerprints:'matched'},null,2)+'\n');
JS
printf 'Local coordinated database/object rehearsal passed: %s\n' "$report"
