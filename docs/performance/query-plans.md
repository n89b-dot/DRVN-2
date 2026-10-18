# Query plans at volume

## A search through the browse function (October 17, 2026)

`marketplace_browse_rows(p_query, …)` still answered a search with
`p_query = '' or id in (select marketplace_search_ids(p_query))`. Through
PostgREST (fact 4 under "Why" below) that ran the search once per part for
sale, and since typo-tolerant search (`20261011130000`) a run costs ~15 ms:
the operations drill's 1,100 matching parts hit the signed-out 3-second
limit on every CI run. The saved-search worker still searched this way.

Two changes. The app sends every text search to the search entry point:
`listingRowsQuery` (the pages' offset fallback and the saved-search worker)
uses `marketplace_search_browse_rows` whenever there are words. And migration
`20261017150000_browse_rows_search_once.sql` restates the browse function
as a UNION ALL of the browse query (no words) and
`marketplace_search_browse_rows` (words), each branch gated on `p_query`
alone, so through PostgREST the search runs once and a browse never runs it.
`supabase/tests/browse_rows_search_once_guard.sql` builds PostgREST's own
statement and counts the runs (Postgres' per-function call count; four runs
for one query before, one after); `tests/operations/browse-search.test.ts`
asks it through the API.

Measured on a disposable database with the volume seed at 60,000 parts
(35,900 for sale), Postgres 17, as a signed-out visitor, PostgREST's
statement (ms; "timeout" at 10 s in psql, HTTP 500 at 3 s through the API):

| `marketplace_browse_rows` called as PostgREST calls it | before | after |
|---|---|---|
| Search, a common word (1,451 parts), exact count | timeout | 88 |
| Search, a common word, page without a count | timeout | 65 |
| Search, a rare word (136 parts), exact count | timeout (> 2 min) | 63 |
| Search + vehicle filter, exact count | timeout | 120 |
| Saved-search worker: 3 days of new parts, with words | timeout | 61 |
| Saved-search worker: 3 days of new parts, no words | 6 | 1 |
| No words, exact count | 36 | 41 |
| Conditions in use (no arguments, 1,000 rows) | 4 | 1 |
| No words, newest 24, no count | 0.9 | 31 |
| Through the API: the drill's 1,100 parts, page + count | 500 at 3 s | 56–160 |

The last-but-one row is the price. A UNION ALL branch carrying its own WHERE
is planned as a subquery: the caller's filters still reach its indexes, but
an `ORDER BY … LIMIT` sorts every matching part instead of stopping at the
24th read off an index. No app request reads the function that way:
marketplace pages and counts go through `marketplace_page` /
`marketplace_count` (`20261011110000`), and what still calls it (the
conditions sample, the worker's date window, the offset fallback for a
database without `marketplace_page`) reads no sorted page of the whole
catalogue. Keeping both — one function, the browse branch read off an index
and the search run once — is not possible in an inlined SQL function: only a
branch with no WHERE of its own is flattened, and the branch that doesn't
apply can only be skipped by a test of its own. `scripts/perf/query-plans.sql`
still reads browse pages through this function in psql; at 2M those rows now
measure a sort, not the pages the app serves.

## Two million parts (October 2026)

**Measured 5 October 2026** on disposable databases seeded at three sizes
with `scripts/perf/seed-volume.sql` (`PARTS=…`):

| | 200k | 600k | 2M |
|---|---|---|---|
| Parts (for sale) | 200,000 (120,000) | 600,000 (360,000) | 2,000,000 (1,200,000) |
| Cars | 40,000 | 120,000 | 400,000 |
| Updates | 400,000 | 1,200,000 | 4,000,000 |
| Members (1% suspended) | 15,000 | 45,000 | 150,000 |
| Database | 1.1 GB | 3.4 GB | 11 GB |

Skewed like a real catalogue, because the skew is what breaks plans: the top
make holds 29% of cars, the top brand 22% of parts out of 400, a few members
own many cars, and title words follow a Zipf curve (most words rare, a few in
every title). Postgres 17 (what `supabase/config.toml` declares) in a 6 GB
Docker VM on an 8 GB Mac, `shared_buffers` 1 GB; every timing is through a
real PostgREST (v16.1), the median of three after a warm-up, as a signed-out
visitor unless it says member. The 2M database is bigger than the memory it
runs in, so a cold read is a real disk read: read these as orders of
magnitude and as before/after, not as what production will serve. "Timeout"
is the 3-second statement limit for visitors (8 s for members): the request
fails and the page shows its error.

### What breaks first, as the catalogue grows

At **200,000 parts** the vehicle filter and "fits my garage" already failed
for every car, and broad text searches took 1–3 s. By **600,000** every
Explore page failed (the card hydration timed out), so did suggested
builders, and filtered marketplace views took 1–2 s. At **2M** almost
everything a shopper does failed: category pages, every filter, every search,
and the category and brand totals every marketplace page shows.

### Before and after

| Request (ms; "page / count") | 200k before | 200k after | 600k before | 600k after | 2M before | 2M after |
|---|---|---|---|---|---|---|
| Marketplace, newest, page 1 | 12 | 5 | 11 | 8 | 67 | 12 |
| Marketplace, page 101 | 14 | 5 | 59 | 7 | 16 | 12 |
| Marketplace, page 1,001 | 36 | 4 | 84 | 4 | 1,912 | 10 |
| Category, cheapest first | 13 | 9 | 71 | 61 | timeout | 6 |
| Brand filter (Brembo) + count | 402 | 3 / 5 | 1,989 | 9 / 8 | timeout | 6 / 8 |
| A rare brand + count | — | 5 / 3 | — | 6 / 4 | — | 6 / 6 |
| Price range + count | 315 | 4 / 8 | 1,059 | 5 / 8 | timeout | 6 / 11 |
| Condition + count | 168 | 3 / 15 | 1,015 | 4 / 23 | timeout | 8 / 20 |
| Vehicle, commonest car + count | timeout | 4 / 8 | timeout | 7 / 10 | timeout | 9 / 9 |
| Vehicle, commonest car, 2015 + count | timeout | 4 / 7 | timeout | 6 / 11 | timeout | 8 / 12 |
| Vehicle, uncommon car + count | timeout | 4 / 3 | timeout | 6 / 5 | timeout | 6 / 5 |
| Fits my garage + count (member) | timeout | 34 / 9 | timeout | 10 / 13 | timeout | 21 / 28 |
| Category counts | 58 | 3 | 219 | 3 | timeout | 3 |
| Brand counts | 63 | 3 | 187 | 5 | timeout | 4 |
| Conditions in use | 6 | 2 | 6 | 3 | 34 | 3 |
| Explore wall, page 1 | 13 | 7 | 35 | 5 | 222 | 12 |
| Explore wall, page 100 | 17 | 9 | 48 | 15 | 180 | 17 |
| Explore card hydration | 573 | 16 | timeout | 20 | timeout | 35 |
| Explore updates for the commonest model | 210 | 70 | 1,916 | 11 | timeout | 16 |
| Explore updates for a rare model | — | 5 | — | 6 | — | 16 |
| Explore builds for the commonest model | — | 4 | — | 5 | — | 8 |
| Explore trending models | 104 | 2 | 1,212 | 3 | timeout | 4 |
| Explore suggested builders | 851 | 3 | timeout | 3 | timeout | 5 |

Every page and count a shopper sends is now under 150 ms at every size, the
largest at 2M being 35 ms. "After" at 2M is the median of three full runs;
the 2M database is larger than the memory it runs in, so a request that finds
its pages evicted can take several times longer (the worst single runs were
2–5x these medians).

Text search, when no search engine is configured — the Postgres path, which
at this size is the fallback for an engine outage (engine timings are below):

| Postgres search (no engine; ms) | 200k before | 200k after | 600k before | 600k after | 2M before | 2M after |
|---|---|---|---|---|---|---|
| Search: three common words | 2,737 | 110 / 55 | timeout | 31 / 145 | timeout | 29 / 28 |
| Search: one very common word | 1,090 | 123 / 54 | timeout | 35 / 166 | timeout | 27 / 26 |
| Search: a mid-frequency word | 312 | 272 / 196 | 1,859 | 287 / 573 | timeout | 1,080 / 723 |
| Search: a rare word | 191 | 275 / 181 | 903 | 245 / 364 | timeout | 334 / 189 |
| Search: brand + listing number | 306 | 437 / 372 | 1,631 | 579 / 756 | timeout | 2,400 / 1,528 |
| Search: part number | 101 | 111 / 58 | 6 | 79 / 160 | 17 | 79 / 43 |
| Explore: search builds | 506 | 510 | 2,049 | 2,051 | timeout | timeout |
| Explore: search updates, common phrase | 2,613 | timeout | timeout | timeout | timeout | timeout |
| Explore: search updates, rare word | 103 | 147 | 1,366 | 1,027 | timeout | timeout |

The capped search answers common words in about 30 ms at 2M (they fill the
1,001 cap within a few thousand parts) and rare ones in a few hundred; words
in a few thousand parts are the slow case (up to 2.4 s at 2M on a cold
cache), because each match is read from disk to sort them by date. At small
sizes it is slightly slower than before for rare words (it first scans the
newest 30,000 parts). Explore's own searches are not capped yet and still
time out at 2M without the engine. The search engine is the answer for both.

Before = the app and database as on `perf/query-plans` (PR #18). After = the
five migrations below and the app that uses them. Where the app now sends a
page and its count as two requests side by side, "after" shows both.

### What changed, and why it scales

1. **The vehicle filter starts from the vehicle**
   (`20261011100000_listing_vehicle_fit.sql`). The filter used to ask, for
   every part for sale, "does this fit?" — several lookups a part, before the
   first page. Each part for sale now carries a few rows saying which makes
   and models it fits (`listing_vehicle_fit`, kept by triggers), and the
   page reads the rows for the chosen car straight off an index, newest or
   cheapest first. `marketplace_match_evidence` is still the definition: the
   new path is held to it part for part.
2. **Pages are read from where the last one ended, and counts stop at
   10,000** (`20261011110000_marketplace_pages_and_counts.sql`). Skipping to
   page 1,001 read 24,000 parts; reading from the last part shown reads 25.
   Counting every match read every match; counting to 10,001 reads at most
   that. `marketplace_page` is PL/pgSQL and writes the shopper's choices
   into its query, so a common car and a rare one each get the plan that
   suits them (PostgREST otherwise hands them to the planner as unknowns).
   A brand filter compares a stored lower-cased copy of the brand: under row
   security `ILIKE` and `lower()` can't use an index ("not leakproof"), and a
   rare brand's page walked the whole catalogue; the same reason gives cars a
   lower-cased make and model.
3. **Totals and rankings are read from small tables**
   (`20261011120000_precomputed_aggregates.sql`): category, brand and
   condition counts refreshed every 30 seconds, trending every two minutes,
   suggested builders every ten minutes, by pg_cron — each refresh reads a compact
   covering index (0.6–2 s, 1.6 s and 3.6 s at 2M). The Explore cards look
   their rows up by key; the Explore wall and the Updates vehicle filter read
   one page at a time.
4. **The read rule on updates asks about each update's car by key**
   (`20261011121000_update_read_rule_per_row.sql`). It hashed every public
   car on every request that read updates — 100+ ms at 2M, growing with cars.
   Who may see what is unchanged.
5. **Text search belongs to the search engine at this size**
   (`20261011130000_search_engine_at_scale.sql`). The engine returns a page
   of ids and an exact count; Postgres re-reads those ids under the caller's
   row security. Postgres' own search stays as the fallback, capped at the
   newest 1,001 matches the filters allow. It forgives typos from a word
   list (`search_words`: every word of four letters or more in the titles
   and brands of parts for sale, 27,000 words at 2M, refreshed hourly in
   ~10–16 s): a word not on it is searched alongside its closest listed word
   ("brmbo" also searches "brembo"), a ~5 ms lookup on a trigram index.

### Sameness

Every replacement was compared with what it replaced before it shipped:

- `vehicle_fit_guard.sql`: 376 comparisons of the new vehicle filter and
  "fits my garage" against `marketplace_match_evidence`, over parts built to
  sit on each edge of the rule, before and after changing parts, fitments,
  cars and suspensions. Breaking any of four parts of the rule fails it.
  `scripts/perf/compare-vehicle-fit.sql` repeats it at 2M: at 600,000 parts, 8 comparisons (7 vehicles and years, and a member's garage) covering 65,192 parts, all identical; at 2M the one that finished (a rare vehicle, 2,182 parts) was identical — the old function takes ~25 minutes a vehicle at that size.
- `marketplace_pages_guard.sql` and `scripts/perf/compare-pages.sql`: pages
  by skipping and by position, forwards and back, and capped counts, against
  `marketplace_browse_rows` queried the way the app used to. 416 checks in
  the guard; 768 at 20,000 parts; 768 at 600,000 parts — all agree.
- `precomputed_aggregates_guard.sql`: each table against the function it
  replaced, the cards against their old answer, the wall by position against
  the wall by skipping.
- `update_read_rule_guard.sql` passes against the old policy and the new.
- The search engine's vehicle and year filters were checked against
  Postgres' rule on the same 200,000 parts: identical counts for every
  vehicle and year tried.

What changes on purpose, and nothing else:

| Change | What a shopper sees |
|---|---|
| Filtered views count to 10,000 | "10,000+ parts found" instead of the exact number past 10,000 |
| Tie-break follows the sort | Parts with exactly the same price (or listing time) can swap places among themselves |
| Postgres search capped (engine down only) | The newest 1,000 matches the filters allow; "1,000+ parts found"; sorting such a search by price sorts those 1,000; a misspelt word is also searched as the closest word in part titles and brands, and the page says "Including results for …" |
| Old `?page=N` links past page 417 | An empty page with "Back to page one" (pages reached by Next/Previous have no limit) |
| Totals and rankings precomputed | Category/brand counts up to 30 seconds behind, trending two minutes, suggested builders ten minutes (plus the app's existing caches: counts one minute, trending five) |
| Engine search (when hosted) | Engine matching and typo tolerance; exact counts; results in the marketplace's usual order |

### Writes

`scripts/perf/write-cost.sql` at 200,000 parts, median ms per operation, all
triggers firing:

| Write | Before | After | Ratio |
|---|---|---|---|
| Create a part (with 2 fitments, 3 photos) | 1.34 ms | 1.16–1.33 ms | ≤ 1.0x |
| Change the price | 0.33 ms | 0.48–0.62 ms | 1.5–1.9x |
| Take off sale and put back (two updates) | 0.62 ms | 0.99–1.09 ms | 1.6–1.8x |
| Edit title and description | 0.32 ms | 0.34–0.38 ms | 1.1x |
| A counted view | 0.31 ms | 0.30–0.33 ms | 1.0x |

(Two runs after; the range is run-to-run noise.)

A counted view no longer queues a search re-index (it did, every time), and
an ordinary profile edit no longer queues re-indexing of everything the
member owns.

### The search engine

Typesense was already wired as an optional provider. At millions of parts it
has to be the primary path for text search; Postgres can rank a rare word
quickly but not a common one, and its capped fallback is for outages.

What was done:

- **Every write reaches it, in batches.** Database triggers already queued a
  re-index for every part, fitment, part number, car, mod, update and
  profile change; a car's parts are now also queued when its make, model,
  year or visibility changes (nothing re-indexed them before). The worker
  claimed ten documents a run, every two minutes — about 7,000 a day, less
  than a 2M-part catalogue changes, and a full rebuild would have taken
  months. It now claims up to 500 at a time, builds their documents in one
  database call (`search_listing_documents`) and imports them in one request,
  for up to two minutes a run.
- **The engine filters with the page's own rules**: for sale, category,
  subcategory, condition, brand, price, source-car year, and the vehicle rule
  (`fit_keys`, `fit_year_keys`, `fit_any_year`, built from
  `listing_vehicle_fit`). On 200,000 parts its vehicle and year counts were
  identical to Postgres' for every vehicle tried. A private car's make and
  model are no longer put into a part's document.
- **The engine's page is re-checked**: `marketplace_page(p_ids => …)` returns
  those ids that still pass every rule, as the caller may see them, in the
  engine's order; the count is the engine's (exact). Garage fit and place
  ("location") searches, and any engine failure, use Postgres.
- **Explore's Builds and Updates searches** use the engine too, with the
  car's catalogue ids, make, model and year in the documents for the vehicle
  and year filters.
- **No more full Postgres search behind every engine query.** Both adapters
  used to union Postgres' answer in behind the engine's "so index lag never
  hides an object"; that ran the very search that times out. With batched
  indexing a new part reaches the engine within a few minutes.

Measured with a local Typesense 30.2 holding 200,000 part documents (the
2M set does not fit in this Mac's Docker VM beside the database):

| Engine search, 200,000 parts indexed | Matches | Engine | Page (engine + Postgres re-check) |
|---|---|---|---|
| brembo brake kit | 5,497 | 40 ms | 83 ms |
| kit | 49,394 | 127 ms | 175 ms |
| a mid-frequency word | 1,430 | 27 ms | 37 ms |
| a rare word | 1 | 34 ms | 44 ms |
| brembo, in one category | 5,416 | 29 ms | 36 ms |
| kit, fits the commonest car | 4,360 | 69 ms | 84 ms |
| kit, fits the commonest car in 2015 | 2,419 | 42 ms | 82 ms |
| coilovers, $100-$500 | 3,170 | 68 ms | 80 ms |
| Explore builds: make7 coilovers | 5,555 | 42 ms | 114 ms |
| Explore updates: dyno day | 33,380 | 24 ms | 31 ms |

**What hosting it needs.** Memory is the cost: Typesense keeps its index in
RAM, 2–3x the searchable text ([system requirements](https://typesense.org/docs/guide/system-requirements.html)).
Measured here, about 3.3 KB per part document and 0.8 KB per car or update,
so roughly 4 GB for 1.2M parts for sale plus ~3.5 GB for 4M updates and
400,000 cars — an 8 GB node at the 2M scale, a few hundred MB today.
Options: [Typesense Cloud](https://cloud.typesense.org/pricing/calculator)
(billed by node size per hour; a 3-node high-availability cluster costs about
three single nodes; the smallest single node is about $22 a month), or a
self-managed VM running the official image, with someone owning upgrades and
backups. Either way the app needs `TYPESENSE_URL` and `TYPESENSE_API_KEY` set
on the server only, and the existing pg_cron job `drvn-search-worker` must be
able to reach `/api/jobs/search`. Recommended: a separate search-only key for
queries and an admin key for the worker (today one key does both). A full
reindex of 2M parts through the batched worker is ~4,000 batches.


### What is still slow, and what breaks next beyond 2M

Still slow at 2M, with reasons:

- **Postgres text search without the engine**: 30 ms for common words, about
  0.2 s for rare ones, up to ~3 s for some mid-frequency words on a cold
  cache — a word in a few thousand parts has to be read from disk one part at
  a time to sort by date. It is the outage path; the engine is the path.
- **Explore searches without the engine**: unchanged and still time out at
  2M for broad words (they are not capped yet).
- **A garage-fit count for a member with many popular cars**: 40–320 ms.

Next, beyond 2M:

1. **Minute-by-minute totals**: the refresh reads the whole parts-for-sale
   index each minute (0.6–2 s at 2M). At ~20M it becomes ~15 s a minute; the
   next design is counters kept by triggers through an append-only delta
   table, folded in by the same job.
2. **The backfill and the two table rewrites** (`listings.brand_key`,
   `cars.make_key`) block the tables while they run: seconds today, about 8
   minutes each at 2M on this laptop. Applied to a catalogue this size they
   would need a quiet window, or be done online in batches (plain columns
   filled in batches instead of generated ones).
3. **Search engine memory** grows with every part, update and car: plan the
   node size with the catalogue, and a high-availability cluster once search
   is primary.
4. **Index weight on parts**: 22 indexes, 1.7 GB at 2M, 2.3x the table. Some
   saw no use at all in these runs (the description trigram index alone is
   264 MB, superseded by the search-document index). Check
   `pg_stat_user_indexes` in production over a few weeks before dropping
   any; once the engine is primary the trigram indexes can go too.
5. **Hot rows**: each part writes several rows elsewhere (fit rows, search
   jobs, images). Write cost stayed under 2x here; at much higher write
   rates the search queue (one row per change) wants batching at the source.
6. **Connections**: `marketplace_page` plans each request afresh (1–9 ms of
   planning) — the price of the right plan for each car. Under Supabase's
   pooler that is fine; it is CPU per request to keep an eye on.


## Sixty thousand parts (4 October 2026)

**Measured 4 October 2026** on a disposable database seeded to roughly 100×
the invited beta — 5,000 members, 12,000 cars, 60,000 parts (36,000 for
sale), 120,000 updates — through a real PostgREST, as a signed-out visitor.
How to reproduce: `scripts/perf/README.md`.

These are Docker-on-a-laptop timings. Read them as orders of magnitude and
as before/after, not as what production will serve. "Timeout" is the anon
role's 3-second statement limit: the request fails.

### What was wrong

Until this was run, nobody had looked at a query plan with more than a few
hundred rows in the tables. At volume, search did not work at all.

| Request | Before | After |
|---|---|---|
| Marketplace, newest page | 768 ms | 12 ms |
| Marketplace, category sorted by price | 662 ms | 11 ms |
| Marketplace, text search (broad: matches 40% of parts) | timeout | 1,010 ms |
| Marketplace, text search (narrower) | timeout | 275 ms |
| Marketplace, part-number search | 2,243 ms | 14 ms |
| Marketplace, vehicle filter | timeout | 86 ms |
| Marketplace, "fits my garage" (member, psql) | 18.7 s | 2.9 s |
| Marketplace, condition choices | 699 ms | 21 ms |
| Explore wall, page one | 1,006 ms | 101 ms |
| Explore, search builds | timeout | 112–253 ms |
| Explore, search updates (broad: matches 30% of updates) | timeout (123 s in psql) | 743 ms |
| Explore, search updates (narrow) | timeout | 60 ms |

Car and profile pages were already fine: every read on them is an indexed
lookup taking under 5 ms at this volume. The listing page had one read that
was not — "updates that tagged this part" timed out and held the page for
3 s on every view; read from the tag rows instead it takes 30 ms.

### The shared cache, checked in a production build

A production build was run against the seeded database with a tracer under
Next's fetch cache counting requests that really reach the database, signed
out:

| Page | First view | Second view |
|---|---|---|
| Marketplace | 19 requests, 1.5 s | 1 request, 0.10 s |
| Explore | 6 requests, 2.6 s | 0 requests, 0.03 s |
| Car | 9 requests, 0.14 s | 0 requests, 0.02 s |
| Listing | 31 requests, 0.28 s | 2 requests, 0.05 s |
| Profile | 22 requests, 0.14 s | 0 requests, 0.03 s |

(The one request left is the beta-access switch, which is deliberately not
cached; the listing's second is a private source car that answers "none".)

- **Age limit.** A car renamed directly in the database kept its old name
  inside the 60 seconds and showed the new one on the first view after 68.
- **Cleared by writes.** A signed Stripe event sent to the webhook made the
  next marketplace view read everything again.
- Not exercised end to end: a server action's clear (it is the same call,
  covered by the unit tests and the import guard), and a signed-in member's
  pages, which do not use the cache at all.

### Why

1. **Search read every row.** The word-matching functions compared every
   car, update and part against every search word. The trigram indexes that
   existed could not be used by the way the functions were written.
2. **Row security hid the indexes anyway.** A text match is not a
   "leakproof" operator, so under row security Postgres must run the
   visibility rule on every row before it may use a text index.
3. **Wrapper functions were optimisation fences.** A SQL function with a
   `SET` clause or a `WITH` body is planned on its own; the caller's
   `ORDER BY … LIMIT 24` only applies after it has produced every row.
4. **PostgREST does not call functions the way psql does.** Arguments
   arrive as a joined row, so `p_query = '' OR id IN (search…)` re-ran the
   search for every part. An exact count wraps the call in a CTE that is
   read twice, so the whole result is always produced.
5. **`auth.uid()` compared directly to a column stops the index being
   used** under row security; `(select auth.uid())` does not.

Migration `20261010100100_search_and_feed_at_scale.sql` fixes 1–3 and 5 in
the functions these pages use, and adds separate search entry points for 4.
Search returns exactly what it did before, in the same order: 20 searches
(292,725 rows) and 17 marketplace searches and filters (41,066 rows) were
compared row for row against the old functions on the seeded database, and
`supabase/tests/search_at_volume_guard.sql` keeps a small version of that check
in CI together with the visibility rules the definer functions now carry.

The app sends searches to the new entry points and pages the Explore wall
through `feed_event_page`. Each falls back to the old path if the function
is missing, so the code is safe to deploy before the migration.

### The read rules (migration 20261010095900)

The read policies on parts, cars and part photos called
`is_suspended()` / `profile_is_visible()` once per row — two
security-definer calls the planner cannot fold into the query. They now
test the seller against the set of suspended members, fetched once per
query (`suspended_profile_ids()`). Who may see what is unchanged
(`supabase/tests/read_rules_guard.sql` states it for a visitor, another
member, the seller and the suspended member, and passes against the old
policies too).

| Request | Search migration only | With the read rules |
|---|---|---|
| Marketplace newest page, with its exact count | 653 ms | 77 ms |
| Marketplace category, with its exact count | 592 ms | 47 ms |
| Category counts | 675 ms | 32 ms |
| Brand counts | 401 ms | 72 ms |
| Explore wall, page one | 101 ms | 11 ms |
| Explore: suggested builders | 903 ms | 177 ms |
| Explore: trending models | 207 ms | 23 ms |

The one new exposure: `suspended_profile_ids()` must be callable by clients
(a policy runs as the caller) and returns every suspended member's id in one
call. `is_suspended(id)` was already callable one id at a time and member
ids are public, so the same answer was already obtainable; it is now one
request instead of one per member. Ids only.

### What is still slow, and why

| Request | Now | Cause |
|---|---|---|
| Vehicle filter with exact count | 2–3 s, sometimes timeout | A fitment lookup per part to count them all. The page of parts itself takes 83 ms; it is the "N parts found" that is slow. |
| "Fits my garage" | about 3 s | The same lookups, for each car in the garage. |
| Broad searches (a third of the catalogue matches) | 0.7–1.2 s | Ranking a third of the catalogue. |

Divide by about 100 for the invited beta: none of these is noticeable there.

At the scale where broad search cost matters, search belongs on the search
engine: the Typesense provider is already wired (`src/lib/search/`), and
PostgreSQL stays the fallback.
