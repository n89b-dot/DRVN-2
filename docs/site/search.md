# DRVN search

> How search works, end to end — approachable, not mysterious. One coherent
> ecosystem, two surfaces with different intent:
>
> - **Marketplace search** — transactional inventory retrieval.
>   Code: `src/lib/marketplace/search/` and the `q` branch of
>   `src/lib/marketplace/query.ts`.
> - **Explore search** — community/content/object discovery over Builds,
>   Updates, Accounts and Parts. Code: `src/lib/explore/search/`, the
>   `/explore` route, and `src/app/api/explore/suggest/`.
>
> They share infrastructure (the provider doctrine, the Typesense transport,
> Postgres-canonical truth) but deliberately not ranking, filters or result
> presentation.

## The one rule

PostgreSQL is canonical truth. A search provider only ever produces a **ranked
candidate id set**; the normal Postgres query then applies every filter and
the sort on top. No commerce decision — pricing, availability, reservation —
ever reads an index, and no visibility decision trusts an index either:
Explore results re-check visibility during hydration.

## Marketplace: two lanes

One search box, two behaviors, split by a pure classifier
(`search/normalize.ts`, unit-tested against the brief's examples):

- **Human discovery** — `mk8 intake`, `bilstein b16`, `golf r downpipe`.
  Multi-word or low-digit terms. **Word-wise, not phrase-wise** (the pg_trgm
  RPC `search_listing_ids`, rewritten in migration 0048): each word matches
  independently against title, description, compatibility notes or the
  category slug, and a word with no direct hit can still match by
  word-similarity against the title (≥ 0.45), so `garret turbo` forgives the
  missing *t*. Ranking: more matched words first, then direct title hits,
  then whole-query title similarity. Digit-bearing words also union in
  identifier candidates, so `bilstein b16` still hits part numbers.
- **Identifier discovery** — `11427566327`, `11-42-7-566-327`, `CP9660-2S4`.
  A single token with ≥5 alphanumerics and ≥2 digits. **Never
  fuzzy-corrected**: a typo in a part number must not "helpfully" match a
  different part. Matching is an exact substring over compact forms.

### Part-number normalization

Both sides normalize to the *compact form*: lowercase, every non-alphanumeric
stripped. Listings store it as the generated column
`listings.part_number_compact` (0033); seller-supplied alternates live in
`listing_part_numbers.number_compact` (0042). `11-42-7-566-327` and
`11427566327` are the same search.

### Aliases & interchange

`part_number_links` (0042) is an **internal** graph of typed relationships
(`alternate`, `supersedes`, `superseded_by`, `aftermarket_equivalent`,
`interchange`, `same_product`). The identifier lane expands a queried compact
one hop through the graph, so an old OEM number finds a listing entered under
its successor. Users never see or manage the graph; rows are written by
imports/admin tooling (service-role only), each with internal source metadata.

## Explore: one family per ranking

Explore searches four object families and **ranks each within itself** — one
relevance score cannot honestly compare a person, a build, a post and a
listing, so the All scope presents grouped results and each group hands off
to its scope.

Canonical truth is three word-wise pg_trgm RPCs (migration 0057), mirroring
`search_listing_ids`' shape, with visibility enforced *inside* each function
(they're called through the service-role client):

- **`search_car_ids`** — public builds only. Matches name, make/model/year,
  tags, about, and the structured installed-mod text (brand, product, part
  number from `mod_items`) — so `Bilstein B16 Golf R` finds a build through a
  mod even though Explore exposes no Modification filter. Search interprets
  content broadly; filters constrain intentionally.
- **`search_update_ids`** — published posts, on a public build **or on no
  build at all** (W-5, migration 198000 — the cars join is outer). Matches
  title, intro, the extracted body text (below), and the owning car's
  vehicle identity where there is one. `title` has been nullable since W-1,
  so it is coalesced before scoring; a titleless quick post is found through
  its caption, which is the body text.
- **`search_profile_ids`** — a deliberately narrow identity projection:
  username, display name, headline. `@kaito` and `kaito` both work (the `@`
  is stripped). Suspended and nameless profiles never surface. **Never**
  location, bio, garage contents, follower data — accounts are discoverable
  by identity, not queryable as a people directory.

**Parts on Explore are marketplace search wholesale** — same provider, same
identifier semantics, same filters, same hydration (`fetchListings`).
`search_listing_ids` matches `listings.brand` alongside the title, part
number and description (M-6, migration 190000): brand is a column, a facet
(`marketplace_brand_counts`) and a saved-search key, and adding it to the
query without adding it to `SAVED_SEARCH_KEYS` would have made saved searches
silently drop the refinement and their alerts over-match.

### Update body extraction

`activity_posts.body` is an ActivityBlock[] document. Search never indexes
the raw JSON: `activity_post_search_text(body)` (0057) extracts exactly the
user-visible text — text blocks, mod labels/details, performance notes — into
the stored generated column `activity_posts.search_text`. The TypeScript
mirror (`src/lib/explore/search/extract.ts`, unit-tested) builds the same
text for engine documents. Changing the extractor means changing both and
re-creating the generated column (drop + add in a migration), then reindexing.

### Filters (Advanced Search)

Deliberately simple, scope-dependent (`src/lib/explore/search/params.ts` is
the single URL vocabulary — parser, href builder, scope-transition cleaning,
all unit-tested):

| Scope   | Refinements |
| ------- | ----------- |
| All     | Vehicle · Year · Sort |
| Builds  | Vehicle · Year · Sort |
| Updates | Vehicle · Year · Sort |
| Parts   | Vehicle · Year · Category · Condition · Price · Fits my garage · Sort |
| Accounts | none — by design |

- **Vehicle** is canonical catalog identity (0041): the URL carries
  `vehicle=<makeId>` or `<makeId>-<modelId>`; `resolveVehicleFilter`
  (`src/lib/vehicles/catalog.ts`) validates it. Builds/Updates match by
  catalog reference where present, exact-string ilike on the frozen
  snapshots otherwise. For listings the same param is implemented centrally
  in `fetchListings` through the seller-stated routes only (declared fitment
  rows or the source car) — no Explore-only fitment interpretation.
- **Year** (`ymin` / `ymax`) is a fact about the car on every scope:
  `cars.year` for Builds, the owning car for Updates, the source car for
  Parts (a listing with no source car drops out while a bound is set).
- **No location refinement on Explore.** There is deliberately **no location
  column on cars**, and Explore does not filter by the owning account's
  profile location. The Marketplace keeps its own listing-location filter on
  `/marketplace`.
- **Sort** is small on purpose: Relevance (default while a query is active) /
  Newest, plus the marketplace's price sorts on Parts.

Scope changes shed incompatible filters by construction: both the parser and
the href builder run through the same allow-list, so a pasted URL and a tab
switch land on the same valid state. Browse mode (no query, no refinement) is
the untouched Explore feed — search never replaces it silently.

### Autocomplete

`GET /api/explore/suggest?q=` returns at most 3 builds + 3 updates + 2
accounts + 3 parts as direct destinations. Every lane is public, parts
included, matching the feed taxonomy (PRD 2026-09 E-5) — the endpoint reads no
session at all. A part whose source car is private is still named; only the
link to that car is withheld. An update with no car skips the public-car gate
entirely — publishing it is the whole of its visibility — and is offered
under its own headline with "Update" where the build name would go. The client is `SuggestingSearchField`
(`src/components/ui/search-suggest.tsx`): ARIA combobox over the `.combo`
popover, ≥2-character threshold enforced on both sides, 150 ms debounce,
stale requests aborted, Enter without a selection submits the GET form.
Suggestions orient; the results page answers.

## Providers

Both surfaces use the same seam: `searchIds(...)` returns ranked ids (`[]` =
genuinely nothing) or `null` = "can't answer" → the caller falls through to
its own `ilike` lane. Search can degrade; it cannot break the product.

- **postgres** — always available (`marketplace/search/postgres.ts`,
  `explore/search/postgres.ts`). **Typesense is optional; Postgres search is
  first-class and must stay correct on its own.**
- **typesense** — optional, self-hosted, enabled by `TYPESENSE_URL` +
  `TYPESENSE_API_KEY`; shared transport in `src/lib/search/typesense.ts`
  (plain `fetch`, 3 s timeouts, fail-soft). Marketplace keeps the
  `drvn-listings` collection (`num_typos=0` on part numbers — the identifier
  rule; identifier queries are ALWAYS answered by Postgres). Explore adds
  `drvn-cars`, `drvn-updates`, `drvn-profiles` — one collection per family so
  rankings stay separate. Only public/published/eligible material is ever
  indexed; engine hits are unioned with Postgres' answer so a
  not-yet-indexed object stays findable; **any failure falls back to
  Postgres**.

## Indexing lifecycle

- **Listings** — `syncListingToSearch(listingId)`
  (`marketplace/search/indexing.ts`) runs fire-and-forget after
  create/edit/status change in the sell actions. Non-active listings are
  deleted from the index.
- **Explore objects** — `syncCarToSearch` / `syncUpdateToSearch` /
  `syncProfileToSearch` (`explore/search/indexing.ts`), fire-and-forget from
  the garage actions (create/edit/delete car, mods saved, visibility
  toggled), the composer actions (publish/edit/delete), profile settings and
  onboarding. Ineligibility deletes: a car flipping private also sweeps its
  posts from the index; flipping public resyncs them. Suspension state is
  applied on the next profile sync or reindex.
- **Never on the critical path** — every sync is `void`-called after the
  mutation succeeds; an index failure is reported, never surfaced.
- **Full rebuilds** — `node scripts/reindex-search.mjs` (listings) and
  `node scripts/reindex-explore.mjs` (cars/updates/profiles) recreate the
  collections from Postgres and bulk-import. Run after enabling the engine,
  changing a schema, or to recover from corruption. The engine is a
  disposable projection: delete the collection and reindex; nothing else
  references it.

## Result hydration

Search windows hydrate through the same paths the feeds use — one
implementation, not two:

- Builds/Updates → `hydrateFeedItems` (`src/lib/feed.ts`): `(kind, id)`
  windows in rank order, bounded batched enrichment, and the final
  visibility gate (a post whose car went private is dropped even if an index
  offered it).
- Parts → `fetchListings`/`hydrateListingCards` (`src/lib/marketplace/query.ts`).
- Accounts → a narrow profile projection (id, username, display name,
  avatar, headline, profile type) — the complete public surface account
  search may touch.

## Adding a searchable field or domain

1. Add the column/data to Postgres (the truth).
2. Postgres lane: extend the relevant RPC (0048/0057 pattern — word-wise
   scoring over an explicit blob; keep visibility clauses inside the
   function).
3. Engine: add the field to the collection schema + document type, include
   it in `query_by`, update the sync helper and reindex script.
4. Reindex.
5. For a **new domain**: give it its own RPC, its own collection, its own
   result representation — never merge it into another family's ranking.
   Wire its write paths to a sync helper and the reindex script, and decide
   its privacy projection explicitly before indexing anything.

## Observability

Every first-page search captures coarse analytics
(`src/lib/analytics.ts`): `search_performed` (marketplace: lane + result
count) and `explore_search_performed` (scope, has_query, filter count,
result count, zero-result flag). Never query text, never account-level
detail — discovery must not become a surveillance dataset. Engine failures
land in monitoring via `reportError` with automatic fallback. Result-click
ranking telemetry is deliberately absent: DRVN has no client-side capture,
and adding one for search wasn't worth the doctrine change.
