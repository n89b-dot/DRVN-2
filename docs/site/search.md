# Marketplace search

> How search works, end to end — approachable, not mysterious (brief §B3).
> Code: `src/lib/marketplace/search/` and the `q` branch of
> `src/lib/marketplace/query.ts`.

## The one rule

PostgreSQL is canonical truth. A search provider only ever produces a **ranked
candidate id set**; the normal Postgres query then applies every filter
(category, condition, price, location, fitment) and the sort on top. No
commerce decision — pricing, availability, reservation — ever reads an index.

## Two lanes

One search box, two behaviors, split by a pure classifier
(`search/normalize.ts`, unit-tested against the brief's examples):

- **Human discovery** — `mk8 intake`, `bilstein b16`, `golf r downpipe`.
  Multi-word or low-digit terms. **Word-wise, not phrase-wise** (the pg_trgm
  RPC `search_listing_ids`, rewritten in migration 0048): each word matches
  independently against title, description, compatibility notes or the
  category slug, and a word with no direct hit can still match by
  word-similarity against the title (≥ 0.45), so `garret turbo` forgives the
  missing *t*. Ranking: more matched words first, then direct title hits,
  then whole-query title similarity — `porsche seats` puts the Porsche
  buckets above other seats instead of (as before 0048) requiring the
  contiguous phrase and returning nothing. Digit-bearing words also union in
  identifier candidates, so `bilstein b16` still hits part numbers.
- **Identifier discovery** — `11427566327`, `11-42-7-566-327`, `CP9660-2S4`.
  A single token with ≥5 alphanumerics and ≥2 digits. **Never
  fuzzy-corrected**: a typo in a part number must not "helpfully" match a
  different part. Matching is an exact substring over compact forms.

## Part-number normalization

Both sides normalize to the *compact form*: lowercase, every non-alphanumeric
stripped. Listings store it as the generated column
`listings.part_number_compact` (0033); seller-supplied alternates live in
`listing_part_numbers.number_compact` (0042). `11-42-7-566-327` and
`11427566327` are the same search.

## Aliases & interchange

`part_number_links` (0042) is an **internal** graph of typed relationships
(`alternate`, `supersedes`, `superseded_by`, `aftermarket_equivalent`,
`interchange`, `same_product`). The identifier lane expands a queried compact
one hop through the graph, so an old OEM number finds a listing entered under
its successor. Users never see or manage the graph; rows are written by
imports/admin tooling (service-role only), each with internal source metadata.

## Providers

`getSearchProvider()` (`search/provider.ts`) returns:

- **postgres** — always available. The two lanes above.
- **typesense** — optional, self-hosted, enabled by `TYPESENSE_URL` +
  `TYPESENSE_API_KEY`. Chosen over Meilisearch for per-field alphanumeric typo
  control: the search sets `num_typos=0` on the `part_numbers` field, which is
  exactly DRVN's identifier rule. Reached over plain `fetch` (no client
  dependency). Identifier queries are ALWAYS answered by Postgres; engine hits
  are unioned with Postgres' answer so a not-yet-indexed listing stays
  findable; **any failure falls back to Postgres**.

The contract: `searchIds(query, {limit})` returns ranked ids (`[]` = genuinely
nothing) or `null` = "can't answer" → the caller falls through, ending at the
legacy `ilike` clause. Search can degrade; it cannot break the marketplace.

## Indexing lifecycle

- **Per-listing sync** — `syncListingToSearch(listingId)`
  (`search/indexing.ts`) runs fire-and-forget after create/edit/status change
  in the sell actions. Non-active listings are deleted from the index. No-op
  without an engine configured.
- **Full rebuild** — `node scripts/reindex-search.mjs` recreates the
  collection from Postgres (schema = `COLLECTION_SCHEMA` in
  `search/typesense.ts`) and bulk-imports every active listing. Run it after
  enabling the engine, changing the schema, or to recover from corruption.
- **Failure recovery** — the engine is a disposable projection: delete the
  collection and reindex. Nothing else references it.

## Adding a searchable field

1. Add the column/data to Postgres (the truth).
2. Postgres lane: extend the RPC or the identifier queries.
3. Engine: add the field to `COLLECTION_SCHEMA` + `ListingSearchDocument`,
   include it in `query_by`, update `buildListingDocument`/reindex script.
4. Reindex.

## Observability

Every first-page search captures a `search_performed` analytics event with the
lane and result count (coarse only — see `src/lib/analytics.ts`); engine
failures land in monitoring via `reportError` with automatic fallback.
