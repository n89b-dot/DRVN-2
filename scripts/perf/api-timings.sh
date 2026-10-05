#!/usr/bin/env bash
# Times the requests the public pages send, through a real PostgREST, as a
# signed-out visitor. psql timings miss how PostgREST passes arguments (as a
# joined row, not literals), which changes the plan — measure here.
#   API=http://127.0.0.1:55442 VEHICLE=<makeId-modelId> bash scripts/perf/api-timings.sh
set -uo pipefail
API="${API:?Set API to the throwaway PostgREST, e.g. http://127.0.0.1:55442}"
case "$API" in http://127.0.0.1:5544[0-9]|http://localhost:5544[0-9]) ;; *) echo "Throwaway PostgREST only" >&2; exit 1 ;; esac
VEHICLE="${VEHICLE:-}"
# LEGACY=1 sends searches the way the app did before migration 20261010100000,
# for a before/after on a database that does not have it.
if [ "${LEGACY:-}" = "1" ]; then MSEARCH=marketplace_browse_rows; USEARCH=explore_update_rows; else MSEARCH=marketplace_search_browse_rows; USEARCH=explore_update_search_rows; fi
BROWSE='"p_vehicle":"","p_vyear":0,"p_ymin":0,"p_ymax":9999,"p_fit":false'
CARD="select=id,title,description,created_at,price_cents,condition,location,source_car_id,brand,seller_id"
t() { # label method path [json] [prefer]
  local label="$1" method="$2" path="$3" body="${4:-}" prefer="${5:-}" out
  if [ -n "$body" ]; then
    out=$(curl -s -o /dev/null -w "%{http_code} %{time_total}" --max-time "${MAX_TIME:-180}" -X "$method" "$API$path" -H "Content-Type: application/json" -H "Prefer: $prefer" -d "$body")
  else
    out=$(curl -s -o /dev/null -w "%{http_code} %{time_total}" --max-time "${MAX_TIME:-180}" -X "$method" "$API$path")
  fi
  printf '%-44s %s  %6.0f ms\n' "$label" "${out%% *}" "$(echo "${out##* } * 1000" | bc -l)"
}
t "marketplace: newest page        "   POST "/rpc/marketplace_browse_rows?$CARD&order=created_at.desc,id.asc&offset=0&limit=24" "{\"p_query\":\"\",$BROWSE}"
t "  with exact count: newest page"   POST "/rpc/marketplace_browse_rows?$CARD&order=created_at.desc,id.asc&offset=0&limit=24" "{\"p_query\":\"\",$BROWSE}" count=exact
t "marketplace: category, cheapest"    POST "/rpc/marketplace_browse_rows?$CARD&category=eq.wheels-tires&subcategory=eq.wheels&order=price_cents.asc,id.asc&offset=0&limit=24" "{\"p_query\":\"\",$BROWSE}"
t "  with exact count: category, cheapest"    POST "/rpc/marketplace_browse_rows?$CARD&category=eq.wheels-tires&subcategory=eq.wheels&order=price_cents.asc,id.asc&offset=0&limit=24" "{\"p_query\":\"\",$BROWSE}" count=exact
t "marketplace: text search"           POST "/rpc/$MSEARCH?$CARD&order=created_at.desc,id.asc&offset=0&limit=24" "{\"p_query\":\"brembo brake kit\",$BROWSE}"
t "  with exact count: text search"           POST "/rpc/$MSEARCH?$CARD&order=created_at.desc,id.asc&offset=0&limit=24" "{\"p_query\":\"brembo brake kit\",$BROWSE}" count=exact
t "marketplace: narrow text search"    POST "/rpc/$MSEARCH?$CARD&order=created_at.desc,id.asc&offset=0&limit=24" "{\"p_query\":\"akrapovic #4242\",$BROWSE}"
t "  with exact count: narrow text search"    POST "/rpc/$MSEARCH?$CARD&order=created_at.desc,id.asc&offset=0&limit=24" "{\"p_query\":\"akrapovic #4242\",$BROWSE}" count=exact
t "marketplace: part number search"    POST "/rpc/$MSEARCH?$CARD&order=created_at.desc,id.asc&offset=0&limit=24" "{\"p_query\":\"PN-4242\",$BROWSE}"
t "  with exact count: part number search"    POST "/rpc/$MSEARCH?$CARD&order=created_at.desc,id.asc&offset=0&limit=24" "{\"p_query\":\"PN-4242\",$BROWSE}" count=exact
[ -n "$VEHICLE" ] && t "marketplace: vehicle filter"    POST "/rpc/marketplace_browse_rows?$CARD&order=created_at.desc,id.asc&offset=0&limit=24" "{\"p_query\":\"\",\"p_vehicle\":\"$VEHICLE\",\"p_vyear\":0,\"p_ymin\":0,\"p_ymax\":9999,\"p_fit\":false}"
[ -n "$VEHICLE" ] && t "  with exact count: vehicle filter"    POST "/rpc/marketplace_browse_rows?$CARD&order=created_at.desc,id.asc&offset=0&limit=24" "{\"p_query\":\"\",\"p_vehicle\":\"$VEHICLE\",\"p_vyear\":0,\"p_ymin\":0,\"p_ymax\":9999,\"p_fit\":false}" count=exact
t "marketplace: category counts"       POST "/rpc/marketplace_category_counts" "{}"
t "marketplace: brand counts"          POST "/rpc/marketplace_brand_counts" "{}"
t "marketplace: conditions in use"     POST "/rpc/marketplace_browse_rows?select=condition&limit=1000" "{}"
t "explore: wall page one (view)"      GET  "/feed_events?select=kind,id,happened_at&kind=in.(car,update,part)&order=happened_at.desc,id.desc&offset=0&limit=25"
[ "${LEGACY:-}" = "1" ] || t "explore: wall page one (function)"  POST "/rpc/feed_event_page" '{"p_kinds":["car","update","part"],"p_limit":25,"p_offset":0}'
[ "${LEGACY:-}" = "1" ] || t "explore: wall page ten (function)"  POST "/rpc/feed_event_page" '{"p_kinds":["car","update","part"],"p_limit":25,"p_offset":225}'
t "explore: search builds"             POST "/rpc/explore_build_rows?select=id,created_at&is_public=eq.true&offset=0&limit=25" '{"p_query":"make7 coilovers"}'
t "explore: search builds, newest"     POST "/rpc/explore_build_rows?select=id,created_at&is_public=eq.true&order=created_at.desc,id.asc&offset=0&limit=25" '{"p_query":"make7 coilovers"}'
t "explore: search builds, narrow"     POST "/rpc/explore_build_rows?select=id,created_at&is_public=eq.true&offset=0&limit=25" '{"p_query":"2015 make12"}'
t "explore: search updates"            POST "/rpc/$USEARCH?select=id,published_at&offset=0&limit=25" '{"p_query":"dyno day","p_make":"","p_model":"","p_make_id":0,"p_model_id":0,"p_ymin":0,"p_ymax":9999}'
t "explore: search updates, newest"    POST "/rpc/$USEARCH?select=id,published_at&order=published_at.desc,id.asc&offset=0&limit=25" '{"p_query":"dyno day","p_make":"","p_model":"","p_make_id":0,"p_model_id":0,"p_ymin":0,"p_ymax":9999}'
t "explore: search updates, narrow"    POST "/rpc/$USEARCH?select=id,published_at&offset=0&limit=25" '{"p_query":"#4242","p_make":"","p_model":"","p_make_id":0,"p_model_id":0,"p_ymin":0,"p_ymax":9999}'
t "explore: updates for a model"        POST "/rpc/explore_update_rows?select=id,published_at&order=published_at.desc,id.asc&offset=0&limit=25" '{"p_query":"","p_make":"Make5","p_model":"Model3","p_make_id":900005,"p_model_id":900503,"p_ymin":0,"p_ymax":9999}'
t "explore: trending models"           POST "/rpc/trending_models" '{"p_days":45,"p_limit":10}'
t "explore: suggested builders"        POST "/rpc/suggested_builders" '{"p_limit":8}'
