#!/usr/bin/env bash
# Times the requests the marketplace and Explore pages send, through a real
# PostgREST, the way the app sends them. psql timings miss how PostgREST
# passes arguments (as a joined row, not literals) and how it counts (a CTE
# read twice), which change the plan — measure here.
#
#   API=http://127.0.0.1:55442 bash scripts/perf/api-timings.sh
#
# Runs every request as a signed-out visitor, then the member requests as a
# signed-in member with a garage. MODE=after sends the requests the app sends
# once migrations 20261011100000-130000 are applied (pages by position,
# capped counts, totals from tables); the default is the app before them. Each request is sent once to warm up, then
# RUNS times (default 3); the median is reported. OUT=<file> also writes
# "label<TAB>http status<TAB>median ms" for the tables in
# docs/performance/query-plans.md. The seeded database's own psql (PGPORT, as
# scripts/perf/fresh-db.sh leaves it) picks the ids, words and member.
set -uo pipefail
API="${API:?Set API to the throwaway PostgREST, e.g. http://127.0.0.1:55442}"
case "$API" in http://127.0.0.1:5544[0-9]|http://localhost:5544[0-9]) ;; *) echo "Throwaway PostgREST only" >&2; exit 1 ;; esac
export PGPASSWORD="${PGPASSWORD:-postgres}" PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-55441}" PGUSER="${PGUSER:-supabase_admin}" PGDATABASE="${PGDATABASE:-postgres}"
case "$PGPORT" in 55441|55443|55445) ;; *) echo "Throwaway database only" >&2; exit 1 ;; esac
SECRET="${JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long}"
RUNS="${RUNS:-3}"
OUT="${OUT:-/dev/null}"
: > "$OUT"
q() { psql -Atqc "$1"; }

# The words, ids and people the requests use, chosen from the data itself.
syl="array['ka','ri','to','ven','mo','sa','lu','dra','pe','xo','ni','bel','ta','ru','qui','zo','mar','fe','li','gor','na','vi','sel','du','rak','po','ten','shi','wo','ly']"
word() { q "select s[1 + $1 % 30] || s[1 + ($1 / 30) % 30] || s[1 + ($1 / 900) % 30] from (select $syl s) a"; }
MID_WORD=$(word 40)        # Zipf rank 40: about one title in 300
RARE_WORD=$(word 20000)    # Zipf rank 20,000: a handful of titles
NUM=$(q "select (count(*) * 0.37)::bigint from public.listings")
RARE_BRAND=$(q "select brand from public.listings where status = 'active' and brand is not null group by brand order by count(*), brand limit 1")
BIG_VEHICLE="900001-900101"   # the most common make and model
SMALL_VEHICLE="900012-901203" # a mid-table make, an uncommon model
PAGE_IDS=$(q "select string_agg('\"' || id || '\"', ',') from (select id from public.listings where status = 'active' order by created_at desc limit 24) s")
BIG_SELLERS=$(q "select string_agg('\"' || seller_id || '\"', ',') from (select seller_id from public.listings where status = 'active' group by 1 order by count(*) desc limit 3) s")
POST_IDS=$(q "select string_agg('\"' || id || '\"', ',') from (select id from public.activity_posts where published_at is not null order by published_at desc limit 12) s")
CAR_IDS=$(q "select string_agg('\"' || id || '\"', ',') from (select id from public.cars where is_public order by created_at desc limit 12) s")
# A member with two or three cars, one of them the most common make and model.
MEMBER=$(q "select owner_id from public.cars group by owner_id having count(*) between 2 and 3 and bool_or(make = 'Make1' and model = 'Model1') order by owner_id limit 1")
TOKEN=$(node -e 'const c=require("crypto");const b=s=>Buffer.from(JSON.stringify(s)).toString("base64url");const h=b({alg:"HS256",typ:"JWT"}),p=b({sub:process.argv[1],role:"authenticated",aud:"authenticated",exp:Math.floor(Date.now()/1e3)+86400});console.log(h+"."+p+"."+c.createHmac("sha256",process.argv[2]).update(h+"."+p).digest("base64url"))' "$MEMBER" "$SECRET")
AUTH=""

one() { # method path body prefer -> "status seconds"
  local args=(-s -o /dev/null -w "%{http_code} %{time_total}" --max-time "${MAX_TIME:-60}" -X "$1" "$API$2")
  [ -n "$AUTH" ] && args+=(-H "Authorization: Bearer $AUTH")
  [ -n "$3" ] && args+=(-H "Content-Type: application/json" -d "$3")
  [ -n "$4" ] && args+=(-H "Prefer: $4")
  curl "${args[@]}"
}
t() { # label method path [json] [prefer]
  local label="$1" status times=() out i
  one "$2" "$3" "${4:-}" "${5:-}" >/dev/null
  for ((i = 0; i < RUNS; i++)); do
    out=$(one "$2" "$3" "${4:-}" "${5:-}"); status="${out%% *}"
    times+=("$(echo "${out##* } * 1000" | bc -l)")
  done
  local median; median=$(printf '%s\n' "${times[@]}" | sort -n | awk '{a[NR]=$1} END {printf "%.0f", a[int((NR+1)/2)]}')
  printf '%-52s %s %7s ms\n' "$label" "$status" "$median"
  printf '%s\t%s\t%s\n' "$label" "$status" "$median" >> "$OUT"
}

BROWSE='"p_vehicle":"","p_vyear":0,"p_ymin":0,"p_ymax":9999,"p_fit":false'
CARD="select=id,title,description,created_at,price_cents,shipping_cents,shipping_mode,allows_collection,condition,location,source_car_id,part_number,brand,part_miles,part_miles_unit,seller_id"
NEWEST="order=created_at.desc,id.asc"
rows() { echo "/rpc/marketplace_browse_rows?$CARD&$1&limit=24"; }
srch() { echo "/rpc/marketplace_search_browse_rows?$CARD&$NEWEST&offset=0&limit=24"; }
veh() { echo "{\"p_query\":\"\",\"p_vehicle\":\"$1\",\"p_vyear\":${2:-0},\"p_ymin\":0,\"p_ymax\":9999,\"p_fit\":false}"; }

marketplace() {
  t "marketplace: newest, page 1"                POST "$(rows "$NEWEST&offset=0")" "{\"p_query\":\"\",$BROWSE}"
  t "marketplace: newest, page 101"              POST "$(rows "$NEWEST&offset=2400")" "{\"p_query\":\"\",$BROWSE}"
  t "marketplace: newest, page 1001"             POST "$(rows "$NEWEST&offset=24000")" "{\"p_query\":\"\",$BROWSE}"
  t "marketplace: category, cheapest, page 1"    POST "$(rows "category=eq.wheels-tires&subcategory=eq.wheels&order=price_cents.asc,id.asc&offset=0")" "{\"p_query\":\"\",$BROWSE}"
  t "marketplace: brand filter (Brembo) + count" POST "$(rows "brand=ilike.Brembo&$NEWEST&offset=0")" "{\"p_query\":\"\",$BROWSE}" count=exact
  t "marketplace: price range + count"           POST "$(rows "price_cents=gte.10000&price_cents=lte.50000&$NEWEST&offset=0")" "{\"p_query\":\"\",$BROWSE}" count=exact
  t "marketplace: condition + count"             POST "$(rows "condition=eq.used&$NEWEST&offset=0")" "{\"p_query\":\"\",$BROWSE}" count=exact
  t "marketplace: vehicle, common + count"       POST "$(rows "$NEWEST&offset=0")" "$(veh $BIG_VEHICLE)" count=exact
  t "marketplace: vehicle, common, 2015 + count" POST "$(rows "$NEWEST&offset=0")" "$(veh $BIG_VEHICLE 2015)" count=exact
  t "marketplace: vehicle, uncommon + count"     POST "$(rows "$NEWEST&offset=0")" "$(veh $SMALL_VEHICLE)" count=exact
  t "search: broad (brembo brake kit) + count"   POST "$(srch)" "{\"p_query\":\"brembo brake kit\",$BROWSE}" count=exact
  t "search: one common word (kit) + count"      POST "$(srch)" "{\"p_query\":\"kit\",$BROWSE}" count=exact
  t "search: mid word ($MID_WORD) + count"       POST "$(srch)" "{\"p_query\":\"$MID_WORD\",$BROWSE}" count=exact
  t "search: rare word ($RARE_WORD) + count"     POST "$(srch)" "{\"p_query\":\"$RARE_WORD\",$BROWSE}" count=exact
  t "search: narrow (akrapovic #$NUM) + count"   POST "$(srch)" "{\"p_query\":\"akrapovic #$NUM\",$BROWSE}" count=exact
  t "search: part number (PN-$NUM) + count"      POST "$(srch)" "{\"p_query\":\"PN-$NUM\",$BROWSE}" count=exact
  t "marketplace: category counts"               POST "/rpc/marketplace_category_counts" "{}"
  t "marketplace: brand counts"                  POST "/rpc/marketplace_brand_counts" "{}"
  t "marketplace: conditions in use"             POST "/rpc/marketplace_browse_rows?select=condition&limit=1000" "{}"
  t "cards: cover photos"                        GET  "/listing_images?select=listing_id,url,position&listing_id=in.(${PAGE_IDS//\"/})&order=position"
  t "cards: watch counts"                        POST "/rpc/listing_watch_counts" "{\"p_listings\":[$PAGE_IDS]}"
  t "cards: biggest sellers' ratings"            GET  "/reviews?select=reviewee_id,rating&reviewee_id=in.(${BIG_SELLERS//\"/})"
  t "cards: biggest sellers' active counts"      POST "/rpc/seller_active_counts" "{\"p_sellers\":[$BIG_SELLERS]}"
}
explore() {
  t "explore: wall, page 1"                      POST "/rpc/feed_event_page" '{"p_kinds":["car","update","part"],"p_limit":25,"p_offset":0}'
  t "explore: wall, page 10"                     POST "/rpc/feed_event_page" '{"p_kinds":["car","update","part"],"p_limit":25,"p_offset":225}'
  t "explore: wall, page 100"                    POST "/rpc/feed_event_page" '{"p_kinds":["car","update","part"],"p_limit":25,"p_offset":2475}'
  t "explore: card hydration"                    POST "/rpc/feed_hydration" "{\"p_post_ids\":[$POST_IDS],\"p_car_ids\":[$CAR_IDS],\"p_listing_ids\":[$PAGE_IDS]}"
  t "explore: search builds (make7 coilovers)"   POST "/rpc/explore_build_rows?select=id,created_at&is_public=eq.true&offset=0&limit=25" '{"p_query":"make7 coilovers"}'
  t "explore: search builds, rare word"          POST "/rpc/explore_build_rows?select=id,created_at&is_public=eq.true&offset=0&limit=25" "{\"p_query\":\"$RARE_WORD\"}"
  t "explore: search updates (dyno day)"         POST "/rpc/explore_update_search_rows?select=id,published_at&offset=0&limit=25" '{"p_query":"dyno day","p_make":"","p_model":"","p_make_id":0,"p_model_id":0,"p_ymin":0,"p_ymax":9999}'
  t "explore: search updates, rare word"         POST "/rpc/explore_update_search_rows?select=id,published_at&offset=0&limit=25" "{\"p_query\":\"$RARE_WORD\",\"p_make\":\"\",\"p_model\":\"\",\"p_make_id\":0,\"p_model_id\":0,\"p_ymin\":0,\"p_ymax\":9999}"
  t "explore: updates for the commonest model"   POST "/rpc/explore_update_rows?select=id,published_at&order=published_at.desc,id.asc&offset=0&limit=25" '{"p_query":"","p_make":"Make1","p_model":"Model1","p_make_id":900001,"p_model_id":900101,"p_ymin":0,"p_ymax":9999}'
  t "explore: builds for the commonest model"    GET  "/cars?select=id,created_at&is_public=eq.true&or=(catalog_model_id.eq.900101,and(make.ilike.Make1,model.ilike.Model1))&order=created_at.desc,id.asc&offset=0&limit=25"
  t "explore: builds for a rare model"           GET  "/cars?select=id,created_at&is_public=eq.true&or=(catalog_model_id.eq.903709,and(make.ilike.Make37,model.ilike.Model9))&order=created_at.desc,id.asc&offset=0&limit=25"
  t "explore: trending models"                   POST "/rpc/trending_models" '{"p_days":45,"p_limit":10}'
  t "explore: suggested builders"                POST "/rpc/suggested_builders" '{"p_limit":8}'
}

# ── After 20261011100000-130000: the requests the app sends now ─────────
pos() { # offset -> "created_at|id" of the part at that depth, newest first
  q "select created_at::text || '|' || id from public.listings where status = 'active' and seller_id not in (select public.suspended_profile_ids()) order by created_at desc, id desc offset $1 limit 1"
}
P101=$(pos 2399); P1001=$(pos 23999)
PAGE="/rpc/marketplace_page?$CARD"
after_args() { echo "\"p_after_created\":\"${1%%|*}\",\"p_after_id\":\"${1##*|}\""; }
marketplace_after() {
  t "marketplace: newest, page 1"                POST "$PAGE" '{"p_limit":25}'
  t "marketplace: newest, page 101 (by position)" POST "$PAGE" "{\"p_limit\":25,$(after_args "$P101")}"
  t "marketplace: newest, page 1001 (by position)" POST "$PAGE" "{\"p_limit\":25,$(after_args "$P1001")}"
  t "marketplace: old ?page=101 link (skipping)" POST "$PAGE" '{"p_limit":25,"p_offset":2400}'
  t "marketplace: category, cheapest, page 1"    POST "$PAGE" '{"p_category":"wheels-tires","p_subcategory":"wheels","p_sort":"price_asc","p_limit":25}'
  t "marketplace: brand filter (Brembo)"         POST "$PAGE" '{"p_brand":"Brembo","p_limit":25}'
  t "  its count (capped)"                       POST "/rpc/marketplace_count" '{"p_brand":"Brembo"}'
  t "marketplace: rare brand ($RARE_BRAND)"       POST "$PAGE" "{\"p_brand\":\"$RARE_BRAND\",\"p_limit\":25}"
  t "  its count (capped)"                       POST "/rpc/marketplace_count" "{\"p_brand\":\"$RARE_BRAND\"}"
  t "marketplace: price range"                   POST "$PAGE" '{"p_min_cents":10000,"p_max_cents":50000,"p_limit":25}'
  t "  its count (capped)"                       POST "/rpc/marketplace_count" '{"p_min_cents":10000,"p_max_cents":50000}'
  t "marketplace: condition"                     POST "$PAGE" '{"p_condition":"used","p_limit":25}'
  t "  its count (capped)"                       POST "/rpc/marketplace_count" '{"p_condition":"used"}'
  t "marketplace: vehicle, common"               POST "$PAGE" "{\"p_vehicle\":\"$BIG_VEHICLE\",\"p_limit\":25}"
  t "  its count (capped)"                       POST "/rpc/marketplace_count" "{\"p_vehicle\":\"$BIG_VEHICLE\"}"
  t "marketplace: vehicle, common, 2015"         POST "$PAGE" "{\"p_vehicle\":\"$BIG_VEHICLE\",\"p_vyear\":2015,\"p_limit\":25}"
  t "  its count (capped)"                       POST "/rpc/marketplace_count" "{\"p_vehicle\":\"$BIG_VEHICLE\",\"p_vyear\":2015}"
  t "marketplace: vehicle, uncommon"             POST "$PAGE" "{\"p_vehicle\":\"$SMALL_VEHICLE\",\"p_limit\":25}"
  t "  its count (capped)"                       POST "/rpc/marketplace_count" "{\"p_vehicle\":\"$SMALL_VEHICLE\"}"
  t "marketplace: vehicle + category, cheapest"  POST "$PAGE" "{\"p_vehicle\":\"$BIG_VEHICLE\",\"p_category\":\"engine\",\"p_sort\":\"price_asc\",\"p_limit\":25}"
  for w in "brembo brake kit" "kit" "$MID_WORD" "$RARE_WORD" "akrapovic #$NUM" "PN-$NUM"; do
    t "search (Postgres, capped): $w"            POST "$PAGE" "{\"p_query\":\"$w\",\"p_limit\":25}"
    t "  its count (capped)"                     POST "/rpc/marketplace_count" "{\"p_query\":\"$w\"}"
  done
  t "marketplace: category counts (table)"       POST "/rpc/marketplace_category_counts" "{}"
  t "marketplace: brand counts (table)"          POST "/rpc/marketplace_brand_counts" "{}"
  t "marketplace: conditions in use (table)"     GET  "/marketplace_facet_counts?select=key&facet=eq.condition"
  t "cards: cover photos"                        GET  "/listing_images?select=listing_id,url,position&listing_id=in.(${PAGE_IDS//\"/})&order=position"
  t "cards: watch counts"                        POST "/rpc/listing_watch_counts" "{\"p_listings\":[$PAGE_IDS]}"
  t "cards: biggest sellers' ratings"            GET  "/reviews?select=reviewee_id,rating&reviewee_id=in.(${BIG_SELLERS//\"/})"
  t "cards: biggest sellers' active counts"      POST "/rpc/seller_active_counts" "{\"p_sellers\":[$BIG_SELLERS]}"
}
WALL10=$(q "select happened_at::text || '|' || id from public.feed_event_page(array['car','update','part'], 1, 224)")
WALL100=$(q "select happened_at::text || '|' || id from public.feed_event_page(array['car','update','part'], 1, 2474)")
explore_after() {
  t "explore: wall, page 1"                      POST "/rpc/feed_event_page" '{"p_kinds":["car","update","part"],"p_limit":26,"p_offset":0}'
  t "explore: wall, page 10 (by position)"       POST "/rpc/feed_event_page" "{\"p_kinds\":[\"car\",\"update\",\"part\"],\"p_limit\":26,\"p_before_at\":\"${WALL10%%|*}\",\"p_before_id\":\"${WALL10##*|}\"}"
  t "explore: wall, page 100 (by position)"      POST "/rpc/feed_event_page" "{\"p_kinds\":[\"car\",\"update\",\"part\"],\"p_limit\":26,\"p_before_at\":\"${WALL100%%|*}\",\"p_before_id\":\"${WALL100##*|}\"}"
  t "explore: card hydration"                    POST "/rpc/feed_hydration" "{\"p_post_ids\":[$POST_IDS],\"p_car_ids\":[$CAR_IDS],\"p_listing_ids\":[$PAGE_IDS]}"
  t "explore: search builds (make7 coilovers)"   POST "/rpc/explore_build_rows?select=id,created_at&is_public=eq.true&offset=0&limit=25" '{"p_query":"make7 coilovers"}'
  t "explore: search builds, rare word"          POST "/rpc/explore_build_rows?select=id,created_at&is_public=eq.true&offset=0&limit=25" "{\"p_query\":\"$RARE_WORD\"}"
  t "explore: search updates (dyno day)"         POST "/rpc/explore_update_search_rows?select=id,published_at&offset=0&limit=25" '{"p_query":"dyno day","p_make":"","p_model":"","p_make_id":0,"p_model_id":0,"p_ymin":0,"p_ymax":9999}'
  t "explore: search updates, rare word"         POST "/rpc/explore_update_search_rows?select=id,published_at&offset=0&limit=25" "{\"p_query\":\"$RARE_WORD\",\"p_make\":\"\",\"p_model\":\"\",\"p_make_id\":0,\"p_model_id\":0,\"p_ymin\":0,\"p_ymax\":9999}"
  t "explore: updates for the commonest model"   POST "/rpc/explore_update_page?select=id,published_at" '{"p_make":"Make1","p_model":"Model1","p_make_id":900001,"p_model_id":900101,"p_limit":26}'
  t "explore: updates for a rare model"          POST "/rpc/explore_update_page?select=id,published_at" '{"p_make":"Make37","p_model":"Model9","p_make_id":900037,"p_model_id":903709,"p_limit":26}'
  t "explore: builds for the commonest model"    GET  "/cars?select=id,created_at&is_public=eq.true&or=(catalog_model_id.eq.900101,and(make_key.eq.make1,model_key.eq.model1))&order=created_at.desc,id.asc&offset=0&limit=25"
  t "explore: builds for a rare model"           GET  "/cars?select=id,created_at&is_public=eq.true&or=(catalog_model_id.eq.903709,and(make_key.eq.make37,model_key.eq.model9))&order=created_at.desc,id.asc&offset=0&limit=25"
  t "explore: trending models (table)"           POST "/rpc/trending_models" '{"p_days":45,"p_limit":10}'
  t "explore: suggested builders (table)"        POST "/rpc/suggested_builders" '{"p_limit":8}'
}

echo "# visitor"
if [ "${MODE:-}" = "after" ]; then marketplace_after; explore_after; else marketplace; explore; fi
echo "# member $MEMBER"
AUTH="$TOKEN"
if [ "${MODE:-}" = "after" ]; then
t "member: marketplace newest, page 1"           POST "$PAGE" '{"p_limit":25}'
t "member: fits my garage"                       POST "$PAGE" '{"p_fit":true,"p_limit":25}'
t "  its count (capped)"                         POST "/rpc/marketplace_count" '{"p_fit":true}'
t "member: fits my garage + category, cheapest"  POST "$PAGE" '{"p_fit":true,"p_category":"engine","p_sort":"price_asc","p_limit":25}'
t "member: vehicle, common"                      POST "$PAGE" "{\"p_vehicle\":\"$BIG_VEHICLE\",\"p_limit\":25}"
t "member: search (Postgres, capped)"            POST "$PAGE" '{"p_query":"brembo brake kit","p_limit":25}'
t "member: suggested builders (table)"           POST "/rpc/suggested_builders" "{\"p_viewer\":\"$MEMBER\",\"p_limit\":8}"
t "member: explore wall, page 1"                 POST "/rpc/feed_event_page" "{\"p_kinds\":[\"car\",\"update\",\"part\"],\"p_limit\":26,\"p_offset\":0,\"p_exclude_owner\":\"$MEMBER\"}"
exit 0
fi
t "member: marketplace newest, page 1"           POST "$(rows "$NEWEST&offset=0")" "{\"p_query\":\"\",$BROWSE}"
t "member: fits my garage + count"               POST "$(rows "$NEWEST&offset=0")" '{"p_query":"","p_vehicle":"","p_vyear":0,"p_ymin":0,"p_ymax":9999,"p_fit":true}' count=exact
t "member: vehicle, common + count"              POST "$(rows "$NEWEST&offset=0")" "$(veh $BIG_VEHICLE)" count=exact
t "member: search broad + count"                 POST "$(srch)" "{\"p_query\":\"brembo brake kit\",$BROWSE}" count=exact
t "member: suggested builders"                   POST "/rpc/suggested_builders" "{\"p_viewer\":\"$MEMBER\",\"p_limit\":8}"
t "member: explore wall, page 1"                 POST "/rpc/feed_event_page" "{\"p_kinds\":[\"car\",\"update\",\"part\"],\"p_limit\":25,\"p_offset\":0,\"p_exclude_owner\":\"$MEMBER\"}"
