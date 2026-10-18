#!/usr/bin/env bash
# The B1 (graph foundation) gate at volume. THROWAWAY ONLY.
#
#   NAME=drvn-scale-b1 PORT=55445 PARTS=2000000 UPTO=20261018100200 bash scripts/perf/fresh-db.sh
#   PORT=55445 OUT=scripts/perf/results/b1 bash scripts/perf/b1-gate.sh
#
# Starts from a seeded database at the schema before B1, adds the graph
# volume (seed-graph.sql), and then:
#   1. before: a checksum of listing_vehicle_fit, query-plans.sql, the API
#      timings (MODE=after: the app's current requests) and write-cost.sql;
#   2. applies every B1 migration (2026102010-14), timing each;
#   3. after: the same checksum, plans, timings and write cost;
#   4. the new reads: 20,000 brand-scoped links (seed-graph-links.sql), an
#      hourly grow_products run applying them after 1,000 writes, a
#      full run, product_coverage, price_comparables through PostgREST for
#      the worst-case product (MEGA-1), a popular one (HOT-k) and a one-off,
#      the admin review page's read, and generations for every seeded model
#      (re-resolving every catalogued car) followed by the checksum again.
# Results land in $OUT/*.txt|tsv for docs/performance/query-plans.md.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PGPASSWORD=postgres PGHOST=127.0.0.1 PGPORT="${PORT:-55445}" PGUSER=supabase_admin PGDATABASE=postgres
case "$PGPORT" in 55441|55443|55445) ;; *) echo "Throwaway ports only" >&2; exit 1 ;; esac
API="http://127.0.0.1:$((PGPORT + 1))"
OUT="${OUT:-scripts/perf/results/b1}"
mkdir -p "$OUT"
SECRET="${JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long}"
q() { psql -Atqc "$1"; }
fit_sum() { q "set statement_timeout = 0; select count(*) || ' rows, checksum ' || coalesce(sum(hashtextextended(t::text, 0)), 0) from public.listing_vehicle_fit t"; }

if [ "$(q "select to_regclass('public.products') is null")" = "t" ]; then
  echo "== graph seed"
  psql -q -f scripts/perf/seed-graph.sql > "$OUT/seed-graph.txt" 2>&1
  echo "== before"
  fit_sum | tee "$OUT/fit-before.txt"
  psql -f scripts/perf/query-plans.sql 2>&1 | grep -E '^== |Execution Time' > "$OUT/plans-before.txt"
  MODE=after API="$API" OUT="$OUT/api-before.tsv" bash scripts/perf/api-timings.sh > /dev/null
  psql -f scripts/perf/write-cost.sql > "$OUT/write-cost-before.txt" 2>&1
  echo "== applying B1"
  : > "$OUT/migrations.txt"
  for f in supabase/migrations/2026102010*.sql supabase/migrations/2026102011*.sql supabase/migrations/2026102012*.sql \
           supabase/migrations/2026102013*.sql supabase/migrations/2026102014*.sql; do
    [ -f "$f" ] || continue
    start=$(perl -MTime::HiRes=time -e "print time")
    psql -q -v ON_ERROR_STOP=1 -f "$f" > /dev/null 2> "$OUT/migration.err" || { cat "$OUT/migration.err"; exit 1; }
    printf '%s\t%.1f s\n' "$(basename "$f")" "$(echo "$(perl -MTime::HiRes=time -e "print time") - $start" | bc -l)" | tee -a "$OUT/migrations.txt"
  done
  q "notify pgrst, 'reload schema'" # PostgREST picks up the new functions
  sleep 2
fi

echo "== after"
fit_sum | tee "$OUT/fit-after.txt"
psql -f scripts/perf/query-plans.sql 2>&1 | grep -E '^== |Execution Time' > "$OUT/plans-after.txt"
MODE=after API="$API" OUT="$OUT/api-after.tsv" bash scripts/perf/api-timings.sh > /dev/null
psql -f scripts/perf/write-cost.sql > "$OUT/write-cost-after.txt" 2>&1

echo "== new reads"
{
  psql -q -f scripts/perf/seed-graph-links.sql

  # An hourly run: mark a run as just started, write 1,000 listings, run.
  q "insert into public.product_grow_runs(result) values (jsonb_build_object('started_at', now() - interval '2 minutes', 'marker', true))"
  q "update public.listings set price_cents = price_cents + 1 where id in (select id from public.listings where status = 'active' order by id limit 1000)" > /dev/null
  echo "hourly run: $(q "select public.grow_products() - 'coverage'")"
  echo "full run:   $(q "set statement_timeout = 0; select public.grow_products(true) - 'coverage'")"
  echo "coverage:   $(q "set statement_timeout = 0; select public.product_coverage()")"
  psql -Atc '\timing on' -c "select 1 from (select public.product_coverage()) x" | grep Time | sed 's/^/product_coverage /'
} | tee "$OUT/grow.txt"

MEMBER=$(q "select owner_id from public.cars order by owner_id limit 1")
TOKEN=$(node -e 'const c=require("crypto");const b=s=>Buffer.from(JSON.stringify(s)).toString("base64url");const h=b({alg:"HS256",typ:"JWT"}),p=b({sub:process.argv[1],role:process.argv[3],aud:"authenticated",exp:Math.floor(Date.now()/1e3)+86400});console.log(h+"."+p+"."+c.createHmac("sha256",process.argv[2]).update(h+"."+p).digest("base64url"))' "$MEMBER" "$SECRET" authenticated)
SERVICE=$(node -e 'const c=require("crypto");const b=s=>Buffer.from(JSON.stringify(s)).toString("base64url");const h=b({alg:"HS256",typ:"JWT"}),p=b({role:"service_role",exp:Math.floor(Date.now()/1e3)+86400});console.log(h+"."+p+"."+c.createHmac("sha256",process.argv[1]).update(h+"."+p).digest("base64url"))' "$SECRET")
ONE_OFF=$(q "select part_number from public.listings where status = 'sold' and part_number like 'PN-%' order by id limit 1")
ONE_OFF_BRAND=$(q "select brand from public.listings where part_number = '$ONE_OFF' limit 1")
time_api() { # label token body path
  local i out times=()
  curl -s -o /dev/null -X POST "$API$4" -H "Authorization: Bearer $2" -H "Content-Type: application/json" -d "$3"
  for i in 1 2 3; do
    out=$(curl -s -o /dev/null -w "%{http_code} %{time_total}" -X POST "$API$4" -H "Authorization: Bearer $2" -H "Content-Type: application/json" -d "$3")
    times+=("$(echo "${out##* } * 1000" | bc -l)")
  done
  printf '%-48s %s %6.0f ms\n' "$1" "${out%% *}" "$(printf '%s\n' "${times[@]}" | sort -n | sed -n 2p)"
}
{
  time_api "comparables: MEGA-1 (~6,000 sales)" "$TOKEN" '{"p_brand":"Brembo","p_part_number":"MEGA-1"}' /rpc/price_comparables
  time_api "comparables: HOT-5 (~40 sales, for sale too)" "$TOKEN" '{"p_brand":"Brembo","p_part_number":"HOT-5"}' /rpc/price_comparables
  time_api "comparables: a one-off part" "$TOKEN" "{\"p_brand\":\"$ONE_OFF_BRAND\",\"p_part_number\":\"$ONE_OFF\"}" /rpc/price_comparables
  out=$(curl -s -o /dev/null -w "%{http_code} %{time_total}" "$API/product_identity_reviews?select=id,kind,number_compact,product_ids&status=eq.open&order=created_at.asc&limit=25" -H "Authorization: Bearer $SERVICE" -H "Prefer: count=exact")
  printf '%-48s %s %6.0f ms\n' "admin: open reviews page (count=exact)" "${out%% *}" "$(echo "${out##* } * 1000" | bc -l)"
  echo "comparables MEGA-1: $(curl -s -X POST "$API/rpc/price_comparables" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"p_brand":"Brembo","p_part_number":"MEGA-1"}')"
  echo "open reviews: $(q "select string_agg(kind || ' ' || n, ', ') from (select kind, count(*) n from public.product_identity_reviews where status = 'open' group by kind) r")"
} | tee "$OUT/reads.txt"

echo "== generations for every seeded model"
{
  psql -Atc '\timing on' -c "insert into public.vehicle_generations(model_id, name, year_start, year_end)
    select m.id, g.name, g.y0, g.y1 from public.catalog_models m
    cross join (values ('Gen1', 1985, 2004), ('Gen2', 2003, 2015), ('Gen3', 2014, null)) g(name, y0, y1)
    where m.id >= 900000" | grep -E 'Time|INSERT' | sed 's/^/generations insert (re-resolves cars): /'
  echo "cars resolved: $(q "select count(*) filter (where generation_id is not null) || ' of ' || count(*) filter (where catalog_model_id is not null) from public.cars")"
  echo "fit after generations: $(fit_sum)"
} | tee "$OUT/generations.txt"

echo "fit before: $(cat "$OUT/fit-before.txt" 2>/dev/null)"
echo "fit after:  $(cat "$OUT/fit-after.txt")"
