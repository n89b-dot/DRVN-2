# Query plans at volume

**Measured 4 October 2026** on a disposable database seeded to roughly 100×
the invited beta — 5,000 members, 12,000 cars, 60,000 parts (36,000 for
sale), 120,000 updates — through a real PostgREST, as a signed-out visitor.
How to reproduce: `scripts/perf/README.md`.

These are Docker-on-a-laptop timings. Read them as orders of magnitude and
as before/after, not as what production will serve. "Timeout" is the anon
role's 3-second statement limit: the request fails.

## What was wrong

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

## The shared cache, checked in a production build

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

## Why

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

Migration `20261008100000_search_and_feed_at_scale.sql` fixes 1–3 and 5 in
the functions these pages use, and adds separate search entry points for 4.
Search returns exactly what it did before, in the same order: 20 searches
(292,725 rows) and 17 marketplace searches and filters (41,066 rows) were
compared row for row against the old functions on the seeded database, and
`supabase/tests/search_scale_guard.sql` keeps a small version of that check
in CI together with the visibility rules the definer functions now carry.

The app sends searches to the new entry points and pages the Explore wall
through `feed_event_page`. Each falls back to the old path if the function
is missing, so the code is safe to deploy before the migration.

## What is still slow, and why

| Request | Now | Cause |
|---|---|---|
| Any marketplace view with filters, exact count | 600–1,000 ms | Counting means checking visibility on every matching part, and each check is two function calls. Unfiltered views no longer count (they use the category counts already on the page). |
| Vehicle filter with exact count | timeout | Same, plus a fitment lookup per part. The page of parts itself takes 86 ms; it is the "N parts found" that cannot be answered in time. |
| Category and brand counts | 400–700 ms | Same per-row visibility cost. Read through the 60-second shared cache, so paid at most once a minute. |
| Explore: suggested builders | 900 ms | Aggregates every public car and update for every member on each call. |
| Broad searches | 0.7–1.2 s | A search matching a third of the catalogue has to rank a third of the catalogue. |

Divide by about 100 for the invited beta: none of these is noticeable there.
They become noticeable somewhere around 10,000–20,000 parts for sale.

The common cause of the first three is that the read policies on `listings`
and `cars` call `is_suspended()` / `profile_is_visible()` once per row. Those
are security-definer functions the planner cannot fold into the query, at
about 6 µs a call. Replacing them with something the planner can hash (a
small table of suspended member ids the policies join to) would cut every
count and every full scan by roughly three-quarters. That is a change to the
security policies themselves and was deliberately left out of this pass.

At the scale where broad search cost matters, search belongs on the search
engine: the Typesense provider is already wired (`src/lib/search/`), and
PostgreSQL stays the fallback.
