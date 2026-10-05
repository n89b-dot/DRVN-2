#!/usr/bin/env bash
# Fill a throwaway Typesense with the volume seed's parts for sale, built by
# the same database function the search worker uses
# (search_listing_documents), in batches through the bulk import.
# THROWAWAY ONLY: the engine must be on localhost and the database one of
# scripts/perf/fresh-db.sh's ports.
#   ENGINE=http://127.0.0.1:8109 KEY=perf-key LIMIT=200000 bash scripts/perf/load-engine.sh
set -euo pipefail
ENGINE="${ENGINE:?Set ENGINE to the throwaway Typesense, e.g. http://127.0.0.1:8109}"
KEY="${KEY:?Set KEY to its API key}"
case "$ENGINE" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "Local engine only" >&2; exit 1 ;; esac
export PGPASSWORD="${PGPASSWORD:-postgres}" PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-55441}" PGUSER="${PGUSER:-supabase_admin}" PGDATABASE="${PGDATABASE:-postgres}"
case "$PGPORT" in 55440|55441|55443|55445) ;; *) echo "Throwaway database only" >&2; exit 1 ;; esac
LIMIT="${LIMIT:-100000000}"
BATCH="${BATCH:-20000}"
cd "$(dirname "$0")/../.."

# The collection, from the app's own schema.
schema=$(node -e '
  const src = require("fs").readFileSync("src/lib/marketplace/search/typesense.ts", "utf8");
  const body = src.slice(src.indexOf("export const COLLECTION_SCHEMA = {") + "export const COLLECTION_SCHEMA = ".length);
  const obj = body.slice(0, body.indexOf("\n};") + 2).replace(/name: COLLECTION,/, "name: \"drvn-listings\",");
  console.log(JSON.stringify(eval("(" + obj + ")")));')
curl -s -o /dev/null -X DELETE "$ENGINE/collections/drvn-listings" -H "X-TYPESENSE-API-KEY: $KEY" || true
curl -sf -X POST "$ENGINE/collections" -H "X-TYPESENSE-API-KEY: $KEY" -H "Content-Type: application/json" -d "$schema" >/dev/null

tmp=$(mktemp); after="00000000-0000-0000-0000-000000000000"; loaded=0
while [ "$loaded" -lt "$LIMIT" ]; do
  ids=$(psql -Atqc "select coalesce(string_agg(id::text, ',' order by id), '') from (select id from public.listings where status = 'active' and id > '$after' order by id limit $BATCH) s")
  [ -z "$ids" ] && break
  psql -Atqc "select doc from public.search_listing_documents('{$ids}'::uuid[])" > "$tmp"
  out=$(curl -sf -X POST "$ENGINE/collections/drvn-listings/documents/import?action=upsert" -H "X-TYPESENSE-API-KEY: $KEY" -H "Content-Type: text/plain" --data-binary @"$tmp")
  bad=$(grep -vc '"success":true' <<< "$out" || true)
  [ "$bad" != "0" ] && { echo "import refused $bad documents" >&2; grep -v '"success":true' <<< "$out" | head -3 >&2; exit 1; }
  after="${ids##*,}"; loaded=$((loaded + $(tr ',' '\n' <<< "$ids" | wc -l)))
  echo "loaded $loaded"
done
rm -f "$tmp"
