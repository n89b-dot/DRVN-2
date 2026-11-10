#!/usr/bin/env bash
# Plan 2 item A6: the whole guard-build proof of a baseline, in one command.
#
#   bash scripts/baseline/prove.sh <baseline.sql> [out dir]
#   bash scripts/baseline/prove.sh --generate <baseline.sql> [out dir]   # write the baseline first, from database A
#
# It builds two throwaway databases the way CI's sql-guard job builds one
# (scripts/disposable-db.sh): A on 55440 from every file in
# supabase/migrations/, B on 55441 from the baseline alone. Then, in order,
# and stopping at the first that fails:
#
#   1. the four comparisons of A and B are empty      (scripts/baseline/compare.sh)
#   2. the comparison can fail: every deliberate fault is reported, and B is
#      whole again after each                          (scripts/baseline/fault-drill.sh)
#   3. the migration runner's --record-only check reads the baseline and finds
#      every object it creates on A                    (scripts/baseline/record-only-check.mjs)
#   4. the generated types file is unchanged against B (scripts/generate-database-types.mjs --check)
#   5. the SQL guards pass against B                   (scripts/test-sql-guards.sh)
#
# Step 5 leaves rows in B, so it is last. Nothing here touches shared dev,
# staging or a local `supabase start` stack. Needs Docker, psql and pg_dump 17.
set -uo pipefail

generate=0
if [ "${1:-}" = "--generate" ]; then generate=1; shift; fi
baseline="${1:?path of the baseline file}"
out="${2:-$(mktemp -d)}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$out"
export PGPASSWORD=postgres
A="postgresql://supabase_admin:postgres@127.0.0.1:55440/postgres"
B="postgresql://supabase_admin:postgres@127.0.0.1:55441/postgres"

step() { printf '\n== %s\n' "$*"; }
fail() { printf 'prove: %s\n' "$*" >&2; exit 1; }

step "A: every migration file"
bash "$root/scripts/disposable-db.sh" start 55440 >"$out/build-A.log" 2>&1 || { cat "$out/build-A.log"; fail "database A did not build"; }
head -1 "$out/build-A.log"

if [ "$generate" = 1 ]; then
  step "The baseline, generated from A"
  (cd "$root" && DRVN_SCHEMA_DATABASE_URL="$A" node scripts/baseline/build-baseline.mjs --out "$baseline") || fail "the generator failed"
fi
[ -f "$baseline" ] || fail "no baseline at $baseline"
shasum -a 256 "$baseline" | tee "$out/baseline.sha256"

step "B: the baseline alone"
bash "$root/scripts/disposable-db.sh" start 55441 "$baseline" >"$out/build-B.log" 2>&1 || { cat "$out/build-B.log"; fail "database B did not build from the baseline"; }
head -1 "$out/build-B.log"

step "1. Is B the database A?"
bash "$root/scripts/baseline/compare.sh" both "$A" "$B" "$out/compare" | tee "$out/1-compare.log"
[ "${PIPESTATUS[0]}" -eq 0 ] || fail "A and B differ"

step "2. Can the comparison fail?"
bash "$root/scripts/baseline/fault-drill.sh" "$A" "$B" "$out/drill" | tee "$out/2-fault-drill.log"
[ "${PIPESTATUS[0]}" -eq 0 ] || fail "the fault drill did not pass"

step "3. Does the runner's --record-only check read the baseline, and find all of it on A?"
(cd "$root" && node scripts/baseline/record-only-check.mjs "$baseline" "$A") | tee "$out/3-record-only.log"
[ "${PIPESTATUS[0]}" -eq 0 ] || fail "--record-only would refuse the baseline"

step "4. Generated types against B"
(cd "$root" && DRVN_TYPES_DATABASE_URL="$B" node scripts/generate-database-types.mjs --check) 2>&1 | tail -3 | tee "$out/4-types.log"
[ "${PIPESTATUS[0]}" -eq 0 ] || fail "the generated types differ against B"

step "5. SQL guards against B"
(cd "$root" && PGHOST=127.0.0.1 PGPORT=55441 bash scripts/test-sql-guards.sh) >"$out/5-guards.log" 2>&1; guards=$?
tail -3 "$out/5-guards.log"
[ "$guards" -eq 0 ] || fail "a SQL guard failed against B (see $out/5-guards.log)"

printf '\nProven on the guard build. Evidence kept in %s\n' "$out"
