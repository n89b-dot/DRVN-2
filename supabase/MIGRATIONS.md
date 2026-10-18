# Applying migrations

## October 24 — the agent's admin controls and measures (shared dev project)

| File | Applied to |
|---|---|
| `20261024100000_agent_admin_measure.sql` | not yet |

Apply after `20261022110000`. It adds:
- `agent_beta_steps` (seller, buyer, chat, jobs; seeded closed) and `admin_set_agent_beta_step`, so each A3 step opens from `/admin/agent`, audited. `AGENTS_BETA=on` stays the master switch.
- `agent_usage` (task, owner, model, tokens, cost; never text), `agent_spend_limits` (per member $2/day, everyone $50/day to start) with `agent_spend_allowed` and the audited `admin_set_agent_spend_limits`.
- `agent_metrics_daily` and `agent_compute_metrics(day)`: the plan's measures as aggregates with no member ids; values from fewer than five cases are null.
- `admin_open_agent_chat`: one member's agent chat, only for a report about them or a dispute they're party to, audited first.

Checked on a fresh database: every migration applies and every SQL guard passes, including the new `agent_admin_measure_guard.sql`; the three admin functions are on `definer_exposure_guard`'s reviewed list; generated types match.

**After applying on dev,** the steps are closed: open `seller` and `buyer` from `/admin/agent` to show the A3a and A3b controls. The global kill switch still decides whether the agent acts.

## October 22 — the buyer agent's notifications, A3b (shared dev project)

| File | Applied to |
|---|---|
| `20261022110000_agent_buyer_notifications.sql` | not yet |

Apply after `20261022100000`. Buyer-side notices, still `offer_`-prefixed: `offer_agent_deal_reached` to the buyer when their agent accepts a counter within the max (sent from the round with no actor, since notify() skips a member's own moves; opens checkout), and `offer_agent_out_of_rounds` when the seller's counter is over the max with no offers left (the gap). `notify_on_agent_approval` is `20261022100000`'s body with the buyer branches added.

Checked on a fresh database: every migration applies and every SQL guard passes, including `agent_notifications_guard.sql` check 5.

## October 22 — the seller agent's notifications, A3a (shared dev project)

| File | Applied to |
|---|---|
| `20261022100000_agent_seller_notifications.sql` | not yet |

Apply after A2's `20261021100200`.
- It adds three seller notices, all `offer_`-prefixed so the Offers preference governs them: `offer_agent_recommends_accept` (the agent filed an approval), `offer_agent_deal_reached` (the buyer accepted the agent's counter; replaces `offer_counter_accepted` for that case) and `offer_agent_out_of_rounds` (with the gap to the seller's own minimum, once per offer).
- `notify_on_offer_response` is the `20261017160000` body with the accepted-counter branch split; two new SECURITY DEFINER trigger functions, revoked from members.

Checked on a fresh database: every migration applies, every SQL guard passes (including the new `agent_notifications_guard.sql`), and the generated types match.

## October 21 — the agent foundation, A2 (shared dev project)

| File | Applied to |
|---|---|
| `20261021100000_agent_foundation.sql` | shared dev project (2026-10-18, twice) |
| `20261021100100_agent_worker.sql` | shared dev project (2026-10-18, twice) |
| `20261021100200_account_export_contract_v10.sql` | shared dev project (2026-10-18, twice) |

Apply in order, after B1's `20261020100000`–`120000`, the A1 files and the seller-helpers
export bump (`2026-10-19.v9`) if it is on the project. Nothing changes for
members: the seeded `all` kill switch keeps the agent paused for everyone, and
no screen calls the new functions until A3a.
- `100000` creates the agent's tables (`agent_mandates` and their versions,
  `agent_tasks`, `agent_events`, `agent_conversations` and `agent_messages`,
  `agent_approvals`, `agent_jobs`, `agent_controls`, `agent_telemetry`), all
  owner-read or no client access at all, with the lifecycle and append-only
  triggers and a database-side card-number scrub. `offer_rounds` gains
  `actor_task_id`, `actor_job_id` and `mandate_version`; `offer_round_terms`
  the buyer agent's ceiling. The admin audit log accepts `agent` subjects.
- `100100` creates the `agent_worker` role **NOLOGIN** (giving it a login is the
  operator step in `docs/production-runbook.md` §13a; never commit a password).
  `offer_open` / `offer_move` become wrappers over `offer_open_core` /
  `offer_move_core`, which take the actor and are callable by no client; their
  bodies are 20261017160000's with the agent columns added. The effective
  floor becomes the higher of the listing's minimum and an active seller
  mandate's. It adds the outbox trigger on `offer_rounds`, the eight worker
  functions (agent_worker only), the member functions (`agent_mandate_set`,
  `agent_mandate_set_status`, `agent_approval_decide`, `agent_clear_conversation`),
  `admin_set_agent_control`, and the service-role sweeps
  (`agent_reconcile_outbox`, `agent_health`, `agent_retention_sweep`,
  `agent_purge_member`).
- `100200` bumps the export contract to `2026-10-21.v10` with the agent sections.

Checked on a fresh database (port 55442): every file applies twice cleanly, all
SQL guards pass, and `agent_worker_guard.sql` (the A2 security regression set,
run as the real role) fails when the kill-switch or revocation check is
removed. Also checked with #39's `20261019120000` applied before and after.
An independent review (18 Oct) found the outbox trigger could fail a person's
move in a revoke race, skipped jobs could block the queue, card redaction
missed trailing digits, and several lock-order and null-argument gaps; all are
fixed here with guard checks.

**Shared dev, 2026-10-18**, after #36 merged (efe24ff), applied in order, each twice, with
`node scripts/apply-migration.mjs`. Dev was on Postgres 17 with B1's products
(`20261020120000`) applied, and without #39's contract or #34's v9.
- **Before:** `~/drvn-db-backups/pre-20261021-a2-apply.sql` (public schema) and
  `pre-20261021-a2-apply-data.sql` (offers, offer_rounds, offer_round_terms,
  account_export_requests).
- **After:** `agent_worker` exists, NOLOGIN, with only its creator's admin membership.
  - There are 10 `agent_*` tables, with the `all` switch on and no mandates or jobs.
  - Members can't reach the cores or the worker functions, and anon can't reach the member functions.
  - `offer_move` wraps `offer_move_core`, and exports stamp `2026-10-21.v10`.
  - The audit subject check keeps `product_review` and adds `agent`.
- **Probe:** `agent_worker_guard.sql` ran against dev in one rolled-back transaction and passed.
  - On Postgres 17 the creator's membership has SET off. So the probe first ran `grant agent_worker to postgres with set true, inherit false granted by postgres` in that same transaction.
  - Afterwards nothing remained: no test users, mandates or extra membership, and the `all` switch was still on.
- **When #34 is applied:** its `20261019100000`/`100100` go on dev after this, so re-run `20261021100200` afterwards to end on v10.

## October 20 — fitment evidence and price comparables, B1 step three

| File | Applied to |
|---|---|
| `20261020130000_product_fitments.sql` | shared dev project (2026-10-18, twice) |
| `20261020140000_price_comparables.sql` | shared dev project (2026-10-18, twice) |
| `20261020150000_grow_products_queue.sql` | shared dev project (2026-10-18, twice) |

Apply in order, after `20261020120000` (re-run `120000` first on a database that has it: it is now re-runnable).
- `130000` adds `product_fitments`: claims about a product (source, relationship, `stated_on`, verification, engine/gearbox/brake constraints) against a catalog model and optionally one of its generations (composite foreign key). Public read of claims not retracted; service-role writes. Empty until B2.
- `140000` adds `price_comparables(brand, part number, currency, exclude listing)`, a SECURITY DEFINER aggregate of completed sales (net of refunds, returns left out) and live listings of one product, with a minimum sample of 3, callable by members, reading at most the newest 500 sales of each number through an expression index on `order_items` (part number, `captured_at`); and restates `product_coverage` (from `120000`) to count completed sale lines, set-based.
- `150000` makes the hourly products run read what changed: `product_grow_queue` (internal), filled by triggers when a listing or build line gains or changes its brand, part number or status (never on a price or a view) and when a listing gains an alternate; `grow_products` restated to read the queue, join the run's number list in every statement, and count only identifiers a live record, link or admin decision still points at when filing "one number, several brands". Index on `part_number_links.created_at`.

Checked on a fresh database (CI's PG15 image): every B1 file applies twice; all 93 SQL guard files pass, including `products_guard.sql` checks 6d–6h (the queue) and `price_comparables_guard.sql` 1g (no negative ages). The 2M-part gate is in `docs/performance/query-plans.md`: vehicle fit unchanged, existing pages unchanged, the hourly run 59 s → 1.4 s, comparables' worst case 2.7 s → 10 ms warm.

**Shared dev, 2026-10-18**, after #42 merged (d50d9ff), with `node scripts/apply-migration.mjs`, each twice, in order: `20261020120000` (re-run: it is re-runnable now), `130000`, `140000`, `150000`.
- **Before:** `grow_products` as `120000` first wrote it; 13 products, 0 reviews, 11 runs; the audit subject check had eight values (A2's `agent` included). Saved to `~/drvn-db-backups/pre-20261020130000-comparables.sql` (schemas of the graph, order, listing and build-line tables, the four functions, the cron jobs) and `pre-20261020130000-products-data.sql`.
- **After:** `pg_get_functiondef` of `grow_products`, `product_coverage`, `price_comparables`, `merge_products`, `resolve_product_identity_review`, the three `queue_product_growth_*` triggers' functions, `listing_commercial_snapshot` and `explore_build_rows` matches a fresh database at main; the audit check still holds all eight values; the five `product_growth_*` triggers exist; `order_items_snapshot_part_recent_idx` replaced `order_items_snapshot_part_number_idx`. Members can't read the queue or write fitment claims; visitors read claims (none yet) and get 401 from `price_comparables` and `products`.
- **Behaviour, in a rolled-back transaction:** a price edit queued nothing; a brand edit queued its listing; the hourly run read it in 31 ms, made the new product, filed no review and emptied the queue; `product_coverage` and `price_comparables` answered. The rollback left 13 products and an empty queue.

It also fixes `20261020120000` so it can be re-run (see that entry).

## October 20 — part keys and products, B1 step two

| File | Applied to |
|---|---|
| `20261020110000_part_keys.sql` | shared dev project (2026-10-18, twice) |
| `20261020120000_products.sql` | shared dev project (2026-10-18; the second run failed safely, see below) |

Apply in order, after `20261020100000`.
- `110000` adds generated `mod_items.part_number_compact` (the listings expression from 0033) and `mod_items.brand_key` (brand compacted to letters and digits), with an index on both. It restates `listing_commercial_snapshot` from 0056 with one added line: `part.brand`.
- `120000` extends `part_number_links` (brand scope per side, `confidence`, `source_ref`, `created_by`, `verified_at/by`; the unique key now includes brand scope). It adds the internal tables `products`, `product_part_numbers` (membership; primary key brand key + number), `product_identity_reviews` and `product_grow_runs`; the functions `merge_products`, `product_coverage`, `grow_products` (service role) and `resolve_product_identity_review` (admins with step-up); `product_review` in `admin_audit_log.subject_type` (built from the live constraint, so other values survive); and two pg_cron jobs: `drvn-grow-products` hourly over what changed since the last run, `drvn-grow-products-full` nightly. It runs `grow_products(true)` once as the backfill.

Adding generated columns rewrites `mod_items` under an exclusive lock; at today's size that is instant (measured at 2M parts in the B1 query-plan notes).

Checked on a fresh database (CI's PG15 image): both files apply cleanly; every SQL guard passes, including the new `products_guard.sql`.

**Re-running `120000` (fixed 2026-10-18 in #42).** The block that adds `product_review` to `admin_audit_log.subject_type` read the constraint's values with a regex that only understood the `ARRAY['x'::text]` rendering. After the first run Postgres renders it as `'{a,b}'::text[]`, so a second run kept `product_review` alone: on an empty audit log that silently narrowed the constraint, and on shared dev (which has audit rows) it raised and rolled the whole second run back. The block now reads both renderings, refuses to drop any of the seven values, and writes a stable `in (...)` form; `products_guard.sql` check 9 holds the seven. The first run is unchanged, which is the one shared dev has.

**Shared dev, 2026-10-18**, after #38 merged (a0f0f78), with `node scripts/apply-migration.mjs`: `110000` twice; `120000` once (its second run rolled back on the bug above).
- **Before:** `listing_commercial_snapshot` byte-identical to 0056's; `mod_items`, `part_number_links` (0 rows, 0042's columns and `part_number_links_key`) and the six audit subject types as on main. Saved to `~/drvn-db-backups/pre-20261020110000-products.sql` (schema and the old snapshot function) and `pre-20261020110000-mod-items-data.sql`.
- **After:** the backfill made 13 products from 1 listing and 12 build lines — every record with a brand and a part number has one — and filed no reviews. `pg_get_functiondef` of `grow_products`, `merge_products`, `resolve_product_identity_review` and `listing_commercial_snapshot` matches a fresh database; `drvn-grow-products` (17 * * * *) and `drvn-grow-products-full` (47 4 * * *) are scheduled; the audit subject check holds all seven values; neither visitors nor members can read products, membership or reviews, call `grow_products`, or (visitors) call `resolve_product_identity_review`.

## October 20 — car generations, B1 step one

| File | Applied to |
|---|---|
| `20261020100000_vehicle_generations.sql` | shared dev project (2026-10-18, twice) |

Apply after `20261018100200`. It adds:
- `vehicle_generations` (catalog model, name, platform code, years), public read, no client writes, with a curated seed of about 200 generations joined to the catalog by make and model name. Models the catalog lacks are skipped; re-running the file after a catalog import fills them in.
- `cars.generation_id` and `generation_source` (`resolved` | `owner`), readable like the other car columns, kept by the `car_generation_before_write` trigger, and re-resolved for a model's cars when its generations change.
- `resolve_vehicle_generation(model, year)`: the one generation covering the year, or null.

It restates `explore_build_rows` with the two new columns appended (it returns whole `cars` rows; without them Explore's build search fails with "return type mismatch").

Checked on a fresh database (CI's PG15 image): the file applies twice cleanly; every SQL guard passes, including the new `vehicle_generations_guard.sql` and `car_vin_privacy_guard.sql`'s updated column set.

**Shared dev, 2026-10-18**, after #35 merged (5ccc623), with `node scripts/apply-migration.mjs`, twice.
- **Before:** `cars` had exactly main's columns and `explore_build_rows` was byte-identical to 20261011120000's. Saved to `~/drvn-db-backups/pre-20261020100000-generations.sql` (cars, catalog schema and the old function) and `pre-20261020100000-cars-data.sql`.
- **After:** 194 generations; 11 of 16 catalogued cars resolved (5 are changeover years or unseeded models). `pg_get_functiondef` of `explore_build_rows`, `resolve_vehicle_generation`, `car_generation_before_write` and `vehicle_generations_rescan` matches a fresh database exactly; all four triggers present. Through the API as a visitor: Explore build search returns cars with `generation_id`/`generation_source` and a null VIN; `vehicle_generations` reads; a write is refused (401). Rehearsed against a copy of shared dev's catalog and cars: 194 generations seeded, 11 of 16 catalogued cars resolved; the other five are changeover years (Silvia 1999, Skyline 2002) or models with no generations seeded (Genesis, 458, Delta Integrale).

## October 19 — negotiation v2 and the private minimum: contract (not applied yet)

| File | Applied to |
|---|---|
| `20261019120000_negotiation_contract.sql` | not applied to shared dev (see below) |

The contract step of A0 (the private minimum) and A1 (negotiation v2). Apply after every `20261018` file, and only once **every running app copy has the switched code** (main from `8321071` on). An app without it still writes `listings.offer_floor_cents` and calls `create_offer_with_message`, and both are gone.

It drops:
- `create_offer_with_message`;
- the client write policies on `offers` (`buyers create offers`, `buyers withdraw own offers`, `suspended members don't make offers`) and anon/authenticated INSERT, UPDATE and DELETE on it, so members write offers only through `offer_open` and `offer_move`;
- `guard_offer_private_floor` and its trigger;
- `listings.offer_floor_cents`, its two check constraints, and `absorb_listing_offer_floor` with its trigger;
- the `drvn.floor_checked_listing` skip in `guard_private_floor_within_price`;
- the deferral on `listing_private_terms`' foreign key to `listings`.

It adds `set_listing_offer_floor(listing, floor)`, SECURITY DEFINER with `search_path = public, pg_temp`, executable by `authenticated`. It acts only for the listing's own seller, refuses a suspended seller and a sold, reserved or removed listing, and checks 0 < minimum ≤ price. `save_listing_creation` calls it after inserting the listing; `update_listing_atomic` calls it before or after the listing update, whichever keeps the minimum within the price. Both read the minimum from the same `offer_floor_cents` JSON key, so the form payload is unchanged. Both bodies were taken from `pg_get_functiondef` and change only those lines.

`record_offer_round` stays, because the expiry sweep, `purchase_finalize` and `offer_accept_begin` on an expired offer still change offers' status without writing a round. The export contract doesn't change.

Checked on a fresh database with every migration:
- the file applies twice cleanly, and generated types match;
- every SQL guard passes. `offer_floor_privacy_guard.sql` (39 checks), `offer_move_guard.sql` (27), `definer_exposure_guard.sql` and `function_search_path_guard.sql` now prove the old paths are gone, and each fails on the schema before this file;
- `npm test`, typecheck and lint pass;
- `tests/operations/negotiation-concurrency.test.ts` passes on the local stack with this file applied.

To reverse: restore the column and the absorb trigger from `20261017130000`, the three functions from `20261018100000`, the policies and `create_offer_with_message` from their last definitions, and re-defer the key.

## October 19 — stock parts on the build sheet, export v9 (shared dev project)

| File | Applied to |
|---|---|
| `20261019100000_mod_items_stock_origin.sql` | shared dev project (2026-10-18) |
| `20261019100100_account_export_contract_v9.sql` | shared dev project (2026-10-18) |

Apply in order, after `20261018100200`.
- `100000` adds `mod_items.origin` (`aftermarket` by default, or `stock`) for "What came off". `save_mod_items` is the `20260919203000` body with origin added to its checks, insert and update. An editor that omits origin leaves a line's stored value alone.
- `100100` bumps the export contract to `2026-10-19.v9`, adding origin to the mod_items section.

Checked on a fresh database: every file applies, every SQL guard passes (including the new `mod_stock_origin_guard.sql`), and the generated types match.

**Shared dev, 2026-10-18**, after #34 merged (5cb7832), with `node scripts/apply-migration.mjs`. A2's v10 (`20261021100200`) was already on dev, so it was re-run straight after `100100` and dev ends on `2026-10-21.v10`; the constraint allows v9 too.
- **Before:** public schema saved to `~/drvn-db-backups/pre-20261019-seller-helpers.sql`, with `mod_items` and `account_export_requests` data in `pre-20261019-seller-helpers-data.sql`.
- **After:** `mod_items.origin` exists with its check; all 121 existing lines read `aftermarket`; `save_mod_items` carries origin; `request_account_export` stamps v10. In a rolled-back transaction, a real owner saved their sheet plus a stock line: their 6 lines stayed aftermarket and the new one saved as stock and removed.

## October 18 — show my minimum, export v8, listing-first locks (shared dev project)

| File | Applied to |
|---|---|
| `20261018100000_show_offer_floor.sql` | shared dev project (2026-10-18, twice) |
| `20261018100100_account_export_contract_v8.sql` | shared dev project (2026-10-18, twice) |
| `20261018100200_listing_first_lock_order.sql` | shared dev project (2026-10-18, twice) |

Apply in order, after `20261017160000`.
- `100000` adds `listings.show_offer_floor`, the seller's choice to show their minimum (O-3), which is off by default. It also adds `listing_public_offer_floor(listing)`, which returns the private minimum only when that choice is on. `save_listing_creation` and `update_listing_atomic` save the flag; their bodies are otherwise unchanged, and a form that doesn't send it saves it as off.
- `100100` bumps the export contract to `2026-10-18.v8`, adding the flag to the listings section.
- `100200` makes `freeze_accepted_offer_checkout`, `settle_seller_cancellation`, `purchase_finalize`, `settle_payment_capture`, `record_payment_request_rejection` and `finish_reservation_expiry` lock the order's listings before the order. The freeze also locks the offer. That puts every path that sells a listing on listing → offer → order → payment. The change only adds lines.

Checked on a fresh database and the local stack:
- every file applies twice cleanly;
- every SQL guard passes, including `offer_floor_privacy_guard.sql` checks 29–31 for the switch;
- `tests/operations/negotiation-concurrency.test.ts` passes four races: two counters at once, accept against pass, checkout against cancel, and acceptance against another buyer's checkout.

**Shared dev, 2026-10-18 (all six A1 files, `20261017150000` through `20261018100200`)**, with Neil's go-ahead. They were applied in order, each twice, with `node scripts/apply-migration.mjs`, after #26–#29 merged.
- **Before:**
  - Dev matched a fresh database at the previous `main` (5458653) in everything A1 touches.
  - Two differences, both outside A1: `marketplace_browse_rows`, which the search speed-up session applied from #23, and five `deletion_write_guard` triggers from an unmerged branch.
  - Saved to `~/drvn-db-backups/pre-20261018-a1-apply.sql` (public schema), with offers, listings, private terms, export requests, orders, payments and notifications in `pre-20261018-a1-apply-data.sql`.
- **After:** dev matches a fresh database at `main` (8321071) across 1,566 functions, policies, triggers, columns and grants, apart from those same two.
  - All 12 existing offers have their rounds backfilled, with `round_count` agreeing.
  - No listing shows its minimum.
  - Exports stamp `2026-10-18.v8`.
  - In a rolled-back transaction, a real buyer and seller ran offer → counter → counter-back → accept. That gave the rounds `offer:buyer counter:seller counter:buyer accept:seller` and an order at exactly the counter-back price. The rollback left the offer count unchanged.
  - A signed-out API call to `offer_rounds` and to `offer_move` gets 42501.

## October 17 — negotiation v2 moves, A1 step two (shared dev project)

| File | Applied to |
|---|---|
| `20261017160000_offer_move.sql` | shared dev project (2026-10-18, twice) |

Apply after `20261017150000` and `20261017150100`. It adds `offer_open` and `offer_move`, two
SECURITY DEFINER functions that make every negotiation move under the v2 rules
(`docs/decisions/negotiation-v2.md`):
- strict turns;
- seller counters above the offer, within the asking price and at or above the minimum;
- buyer counter-backs above their last amount and below the counter;
- 3 buyer offers per part across threads, with live offers counting as the first;
- a below-minimum attempt recorded as a declined round;
- a fresh 72 hours each move;
- refusal of stale rounds, and exact replay by idempotency key;
- a rate limit inside the transaction.

They lock the listing, then the offer. Acceptance runs `offer_accept_begin` under those locks.

It also restates five functions:
- `record_offer_round` skips moves these functions write, and keeps the new `offers.round_count` current.
- `guard_offer_private_floor`: the new functions check the minimum themselves.
- `notify_on_offer` doesn't announce an attempt that was declined at once.
- `notify_on_offer_response` adds `offer_countered_back` and `offer_expired`.
- `settle_seller_cancellation` is refused once checkout has begun.

Today's paths (`create_offer_with_message`, the old app's direct updates) keep working until the
switched app runs everywhere. A later contract step removes them.

Checked on a fresh database with every migration: the file applies twice cleanly, the new
`offer_move_guard.sql` (23 checks) and every other guard pass, and generated types match.

## October 17 — offer rounds, A1 step one (shared dev project)

| File | Applied to |
|---|---|
| `20261017150000_offer_rounds.sql` | shared dev project (2026-10-18, twice) |
| `20261017150100_account_export_contract_v7.sql` | shared dev project (2026-10-18, twice) |

The expand step of negotiation v2 (`docs/decisions/negotiation-v2.md`). `150000` adds
`offer_rounds`, one append-only row per move, readable by the offer's buyer and seller, writable
by no client. It also adds `offer_round_terms`, the minimum in force for each proposal, readable
by no client, and a trigger on `offers` that records a round for each move today's code makes:
opening offer, counter, accept by either side, decline, withdraw and expiry. A backfill turns
each existing offer's columns into its rounds. Behaviour is unchanged. `150100` bumps the export
contract to `2026-10-17.v7`, adding the rounds of offers a member made and received.

Checked on a fresh database with every migration: both files apply twice cleanly; the new
`offer_rounds_guard.sql` and every other guard pass; generated types match. The backfill was
checked against seeded offers in every end state, and a second run adds nothing.

Apply in order, after `20261017130100`. Either file is safe before or after the app change.
## October 17 — row security checks once per query (shared dev project)

| File | Applied to |
|---|---|
| `20261017140000_rls_initplan.sql` | shared dev project (2026-10-17, twice) |

A0's advisor follow-up for `auth_rls_initplan`. 88 of the 115 policies in `public` called
`auth.uid()` bare, and 34 of them also called `public.is_admin()` bare, so both ran once per row
checked. Each policy is restated with those calls wrapped in a scalar subquery
(`(select auth.uid())`), which Postgres evaluates once per query as an InitPlan. The
statements were generated from the policies' own definitions and checked by reversing the
wrap. After applying, every policy matches its original except that Postgres flattens
`(a OR b) OR c` to `a OR b OR c`, which means the same.

Checked on a fresh database with every migration: the file applies twice cleanly; all guards
pass, including the ones that test who can read and write what; the new
`rls_initplan_guard.sql` fails on a planted bare policy. The orders read as a signed-in member
now filters on three InitPlans instead of calling `auth.uid()` and `is_admin()` per row.

**Shared dev, 2026-10-17**, with Neil's go-ahead, applied twice with
`node scripts/apply-migration.mjs`.
- Before: the public schema was saved to `~/drvn-db-backups/pre-20261017-rls-initplan.sql`. All 115 policy expressions matched a fresh database at the previous migration, so none had been changed by hand. This check matters because `ALTER POLICY` replaces the expression wholesale.
- After: all 115 match a fresh database with this migration, and `rls_initplan_guard.sql` passes on dev.
- For 8 real members, in a rolled-back transaction, the orders, messages and offers that row security showed each one matched the rule written out by hand: 19, 34 and 15 rows, none missing and none extra.

Safe before or after any app change.

## October 17 — the offer minimum goes private, step two (shared dev project)

| File | Applied to |
|---|---|
| `20261017130000_listing_private_terms_switch.sql` | shared dev project (2026-10-17, twice) |
| `20261017130100_account_export_contract_v6.sql` | shared dev project (2026-10-17, twice) |

The **switch** step. Apply both together, in this order, **after** `20261017120000`.
The app change that goes with them can ship before or after: an older app build
keeps working, because every function it calls still accepts the minimum under
its old name and the trigger stores it privately.

`130000`:
- Drops the expand step's mirror trigger, catches up and then empties `listings.offer_floor_cents`, and adds `listings_offer_floor_private` (the column must stay null).
- Adds a BEFORE trigger (`listings_zz1_absorb_offer_floor`) that moves any write to that column into `listing_private_terms`. It fires only when the column is named in the write, so it never clears a minimum on a status or price change.
- Adds bound checks from both sides: a price cut below the minimum is refused, and so is a service-role write above the price.
- Adds `offers_guard_private_floor`, a SECURITY DEFINER trigger that refuses below-minimum offers (23514) without naming the amount.
- Restates `guard_offer_insert` and `create_offer_with_message` without their floor reads, and restates `save_listing_creation` so its replay check reads the minimum through `my_listing_offer_floor`.
- Makes the FK from the private table to `listings` deferred, so the trigger can write ahead of a new listing row.

Emptying the column touches `updated_at` on listings that had a minimum (none on shared dev today). A seller with that listing's edit form already open gets the usual "changed since you opened it" and reloads.

`130100` bumps the export contract to `2026-10-17.v6`. Pending, processing and failed exports under v5 are expired; the member asks again.

Checked on a fresh database with every migration: all guards pass, both files apply twice cleanly, generated types match, and `npm test`, typecheck, lint and `next build` pass.

**Shared dev, 2026-10-17**, with Neil's go-ahead, each file applied twice with
`node scripts/apply-migration.mjs`.
- Before: the public schema was saved to `~/drvn-db-backups/pre-20261017-listing-private-terms-switch.sql`, with the private-terms and export-request rows in `pre-20261017-switch-data.sql`. The four restated functions matched their expected prior definitions (no drift).
- After: 24 listings and 24 private rows, none out of step, and no public minimum.
  - The four triggers are present; the expand step's mirror is gone. The FK is deferred and `listings_offer_floor_private` is in place. The four functions carry their new bodies, and exports stamp v6.
  - In a rolled-back transaction, a write to the old column landed privately and left the column null, and a price cut below the minimum was refused (23514).
  - A signed-out API read of `listing_private_terms` gets 42501; `listings` returns `offer_floor_cents` as null.
- Until the app change merges, main's offer form shows its generic "couldn't confirm" error for an offer below a minimum, because the database now refuses it with 23514. Nothing leaks, and no listing on shared dev has a minimum.

## October 17 — the offer minimum goes private, step one (shared dev project)

| File | Applied to |
|---|---|
| `20261017120000_listing_private_terms.sql` | shared dev project (2026-10-17, twice) |

A0's first rollout, the **expand** step of three (plan: "DRVN AI-native:
review and implementation plan", A0). It adds `listing_private_terms` (one
row per listing; no client grants, row security on with no policies), a
trigger on `listings` that keeps its `offer_floor_cents` equal to
`listings.offer_floor_cents` on every insert and edit, a backfill, and
`my_listing_offer_floor(listing)`, which answers only the listing's seller.
Nothing reads the new table yet, so it is safe before any app change and
changes no behaviour. The backfill takes a lock on `listing_private_terms`
only; `listings` is read, not rewritten.

Checked on a fresh database with every migration: `offer_floor_privacy_guard.sql`
fails before this file and passes after; every other guard still passes; the
file applies twice cleanly; generated types match.

**Shared dev, 2026-10-17**, with Neil's go-ahead, applied twice with
`node scripts/apply-migration.mjs`. Before: public schema saved to
`~/drvn-db-backups/pre-20261017-listing-private-terms.sql`. After: 24 listings,
24 private rows, none out of step; row security on, no anon/authenticated
table privilege, the owner function executable by authenticated only, the
mirror trigger present; the REST API refuses a signed-out read of the table
and the function (42501).

Next: **switch** (offer checks, sell form, edit page and export read the new
table) and, once that app is live everywhere, **contract** (drop
`listings.offer_floor_cents` and the mirror trigger). Until the contract step,
the old column is still readable through the API, as it is today.
## October 17 — a search through the browse function (shared dev project)

| File | Applied to |
|---|---|
| `20261017145500_browse_rows_search_once.sql` | shared dev project (2026-10-17) |

Restates `marketplace_browse_rows` as a UNION ALL of the browse query (no
words) and `marketplace_search_browse_rows` (words), so a search called
through PostgREST runs once instead of once per part for sale. Same rows;
signature, grants and invoker rights unchanged. Safe before or after the app
change that ships with it (`listingRowsQuery` already sends searches to
`marketplace_search_browse_rows`). Reverse by restating the function from
`20261011100000_listing_vehicle_fit.sql`. Guard:
`browse_rows_search_once_guard.sql`. Measurements and the one plan it makes
slower: `docs/performance/query-plans.md` ("A search through the browse
function").

**Shared dev, 2026-10-17**, with Neil's go-ahead once PR #23's CI was green,
applied once with `node scripts/apply-migration.mjs`. Before: the three
functions it touches or calls (`marketplace_browse_rows`,
`marketplace_search_browse_rows`, `marketplace_search_ids`) were saved with
their grants to `~/drvn-db-backups/pre-20261017145500-browse-rows-search-once.sql`
and matched a fresh database at main's previous state, so there was no drift.
After: the live body matches the file, grants are unchanged, it is still SQL,
STABLE and SECURITY INVOKER with no SET, and a signed-out PostgREST-shaped
call plans both branches behind one-time filters with the search computed
once. Signed out through the API, the same calls return the same counts as
before (a search for "brake" returns 3, a browse returns 11).

## October 11 — millions of parts (shared dev project)

| File | Applied to |
|---|---|
| `20261011100000_listing_vehicle_fit.sql` | shared dev project (2026-10-05, twice) |
| `20261011110000_marketplace_pages_and_counts.sql` | shared dev project (2026-10-05, twice) |
| `20261011120000_precomputed_aggregates.sql` | shared dev project (2026-10-05, twice) |
| `20261011121000_update_read_rule_per_row.sql` | shared dev project (2026-10-05, twice) |
| `20261011130000_search_engine_at_scale.sql` | shared dev project (2026-10-05, twice) |

**Shared dev, 2026-10-05**, with Neil's go-ahead (he approved the read policy
and the client-callable definer functions), each applied twice with
`node scripts/apply-migration.mjs`. Before: every function, trigger and policy
these touch was compared with a fresh database at main's previous state — no
drift — and saved to `~/drvn-db-backups/pre-20261011-scale-2m.sql`. After:
the same comparison against a fresh database with all five matches; the four
pg_cron jobs ran and succeeded.

Apply after the October 10 set (`20261010095900`, `20261010100100`), in this
order. Each is safe before the app that uses it: the app falls back
(PGRST202 / 42703) to the previous path. Measurements and the reasoning:
`docs/performance/query-plans.md` ("Two million parts").

`100000` adds `listing_vehicle_fit` (one row per part for sale per make and
model it fits, kept by triggers on `listings`, `listing_fitments` and `cars`)
and restates `marketplace_browse_rows` / `marketplace_search_browse_rows` so
the vehicle filter and "fits my garage" read it instead of running
`marketplace_match_evidence` per part. Same answers (guard
`vehicle_fit_guard.sql` holds them to the evidence function). The backfill
blocks writes to parts, fitments and cars while it runs: well under a second
at today's size, ~8 minutes at 2M parts on a laptop.
`110000` adds `marketplace_page` and `marketplace_count` (PL/pgSQL, SECURITY
INVOKER: pages read by position, counts capped at 10,001), a generated column
`listings.brand_key` (brand lower-cased, so a brand filter can use an index
under row security), three partial indexes on `listings` (price, brand
newest, brand price) and `fillfactor = 90` on `listings` (room for a counted
view to be an in-place update). Adding the column rewrites `listings` and
holds every read and write of it while it runs: seconds today, ~1.5 minutes
at 600,000 parts, ~8 minutes at 2M on a laptop. Guard:
`marketplace_pages_guard.sql`.
`120000` adds `marketplace_facet_counts`, `explore_trending_models` and
`explore_builder_rankings` with their refresh functions and pg_cron jobs
(`drvn-marketplace-counts` every 30 seconds, `drvn-explore-trending` every
two minutes, `drvn-explore-builders` every ten); restates `marketplace_category_counts`,
`marketplace_brand_counts`, `trending_models`, `suggested_builders`,
`feed_hydration` (from its latest definition, `20261003150000`) and
`feed_event_page` (drop and create: two optional position arguments); adds
`explore_update_page`; adds generated columns `cars.make_key` / `model_key`
(a table rewrite of `cars`: seconds today, about a minute at 400,000 cars)
and restates `explore_build_rows` to return them. Guard:
`precomputed_aggregates_guard.sql`; `car_vin_privacy_guard.sql` updated for
the two new readable columns.
`121000` restates the read policy "published activity readable" on
`activity_posts` (`ALTER POLICY`) to look the car up by key instead of an
EXISTS the planner answered by hashing every public car. Who may read what
is unchanged; guard `update_read_rule_guard.sql` passes against the old and
the new policy.
`130000` adds `marketplace_search_capped_ids` (SECURITY DEFINER, callable by
clients, ids only — listed in `definer_exposure_guard.sql`); the typo word
list `search_words` (no client access), `refresh_search_words` (pg_cron job
`drvn-search-words`, hourly; filled once by the migration: ~10–16 s at 2M
parts) and `search_word_corrections` (SECURITY DEFINER, callable by clients,
returns only words already in titles and brands of parts for sale — listed in
`definer_exposure_guard.sql`); restates
`marketplace_query_sql` / `marketplace_page` / `marketplace_count` (drop and
create: a `p_ids` argument for the search engine's page), adds
`claim_search_job_batch` and `search_listing_documents` (service role only),
and narrows the search queue triggers on `listings`, `cars`, `mod_items`,
`activity_posts` and `profiles` to the fields the documents hold. Guard:
`search_engine_guard.sql`.

## October 10 — read rules and search at volume (shared dev only)

| File | Applied to |
|---|---|
| `20261010095900_read_rules_without_per_row_calls.sql` | shared dev, 2026-10-05 (twice) |
| `20261010100100_search_and_feed_at_scale.sql` | shared dev, 2026-10-05 (twice) |

Renamed from `20261010100000_…` on 2026-10-05: main took that version for the
refund fix below. Same contents; shared dev records neither version, so
nothing there changes.

Apply `095900` first: `100100` uses its helper. `095900` restates the five
read policies on `listings`, `cars` and `listing_images` with `ALTER POLICY`
so that "is this member suspended?" is asked once per query through the new
`suspended_profile_ids()` (SECURITY DEFINER, callable by clients, ids only —
on the reviewed list in `definer_exposure_guard.sql`) instead of
`is_suspended()` / `profile_is_visible()` once per row. Who may read what is
unchanged; guard: `supabase/tests/read_rules_guard.sql`. The old helper
functions stay (other functions still call them).

`100100` is additive and safe in either order with the code: the app falls back to the
old functions (PGRST202) until it is applied. It adds trigram indexes over a
"search document" per part, car, mod and update; restates `search_car_ids`,
`search_update_ids` and `search_listing_ids` to read through them (now
SECURITY DEFINER, applying the signed-out read rule themselves and returning
ids only — added to `definer_exposure_guard.sql`); adds
`marketplace_search_ids`, `marketplace_search_browse_rows`,
`explore_update_search_rows` and `feed_event_page`; and restates
`marketplace_browse_rows`, `marketplace_search_rows`, `explore_build_rows`
and `explore_update_rows` without their `SET search_path` clause so the
planner can read a page off an index (they are SECURITY INVOKER with every
name schema-qualified). Results are unchanged. The index builds take locks
for as long as they run: seconds on today's tables.
Guard: `supabase/tests/search_at_volume_guard.sql`. Measurements and what is
still slow: `docs/performance/query-plans.md`.

## October 10 — refund events for unknown orders (shared dev project)

| File | Applied to |
|---|---|
| `20261010100000_refund_event_unknown_order.sql` | shared dev project (2026-10-05) |

Restates `record_refund_provider_event` (live body diffed against
`20261007100200` first, no drift; backed up to
`~/drvn-db-backups/pre-refund-unknown-order-function-20261005.sql`). A refund
whose metadata names an order this database does not hold used to fail on the
`orders` foreign key, so the webhook answered 500 and Stripe redelivered it.
The order is now looked up once: an unknown one is kept only as
`reported_order_id` and the refund goes to the `refund_lifecycle_unresolved`
recovery. Seen on shared dev since 2026-10-01 because `stripe listen` forwards
every event on the test account, including refunds made by `npm run
test:stripe` against its own database. Guard: `refund_unknown_order_guard.sql`.

## October 9 — payout release and risk controls (shared dev project)

**Shared dev, 2026-10-05.** The October 6 set and `20261009100000` were applied in that order by the "Seller payment hold policy" session (round five's `20261008100200` went on between them). The six functions they replace were diffed against their latest repo definitions first (no drift) and backed up to `~/drvn-db-backups/pre-payout-release-functions-20261005.sql`. Live `settlement_settings`: fixed hold, 2 days, receipt release 3 days, tracking from $1,000, card verification from $500, auto-confirm after 21 days with 3 days' notice; `drvn-delivery-auto-confirm` cron active (`23 * * * *`). The October 7 set was found already live: every replaced function's body matches the repo, so it was applied earlier without being recorded here. `supabase_migrations.schema_migrations` records none of these; this file is the record. **Never re-run `20261006100200`** on an environment that has `20261009100000`: it would restore the claim-window hold.

| File | Applied to |
|---|---|
| `20261009100000_payout_release_risk_controls.sql` | shared dev project (2026-10-05) |

Apply after the October 6 set. Replaces the owner's `claim_window` decision
(`20261006100200`) with a fixed 2-day hold and early releases
(`docs/decisions/payout-hold.md`): `payout_release_at()` releases at delivery
for a plausible buyer receipt and for the untracked auto-confirm.
`settlement_settings` gains `receipt_release_after_days` (3),
`tracking_required_from_cents` ($1,000) and `card_verification_from_cents`
($500). Restated, diffed against their latest definitions:
`start_payout_clock_on_delivery` (the release flag), `mark_order_received`
(the plausibility check) and `mark_order_dispatched`, which drops the
4-argument signature for one with two optional tracker arguments and refuses
an untracked first dispatch at or above the tracking threshold. Deploy the
app with it: the old app keeps working (it calls with four arguments) but
can't register a tracker first, so $1,000+ orders need a DRVN label until the
new app is live. Guard: `payout_release_guard.sql`; three existing guards
updated for the new deployed values.
## October 8 — round five: guest auto-confirm warning email

| File | Applied to |
|---|---|
| `20261008100200_auto_confirm_guest_email.sql` | shared dev, 2026-10-05 (applied twice) |

Adds `emailed_at`, `email_attempts` and `email_last_error` to
`delivery_auto_confirmations` (after `20261006100100`). The money worker's
receipts pass emails a guest buyer the auto-confirm warning and records it
there. Needs the templates in `supabase/templates/` on the project.

## October 8 — round five: export contract v5, carry-forward credit payouts

| File | Applied to |
|---|---|
| `20261008100000_account_export_contract_v5.sql` | shared dev, 2026-10-05 (applied twice, with PR #15 merged) |
| `20261008100100_seller_carry_payouts.sql` | shared dev, 2026-10-05 (applied twice) |

`20261008100000` moves the account export to contract `2026-10-08.v5`
(message photos, `seller_carry_entries`, `seller_carry_payouts`): it widens
the version check, expires unfinished requests and restates
`request_account_export` with only the version literal changed. Apply it with
the app that carries the v5 contract — an app on v4 purges every request the
database stamps v5, and the reverse (see `20260919205000`).
`20261008100100` adds `seller_carry_payouts`, two `seller_carry_entries`
kinds (`paid_out`, `paid_out_reversed`) and five service-role functions
(`open_`, `claim_`, `prepare_`, `complete_`, `release_seller_carry_payout(s)`).
A seller's credit balance is paid to their Stripe balance by the transfers
job once its newest entry is a day old. It restates no existing function.
Apply after `20261005110100` and `20261007100400`. Guard:
`supabase/tests/seller_carry_payout_guard.sql`.

## October 7 — review fixes (shared dev project)

| File | Applied to |
|---|---|
| `20261007100000_refund_reversal_remaining_cap.sql` | shared dev project (live before 2026-10-05; verified by body comparison) |
| `20261007100100_unsuspend_refuses_requested_deletion.sql` | shared dev project (live before 2026-10-05; verified by body comparison) |
| `20261007100200_refund_inflight_excludes_settled.sql` | shared dev project (live before 2026-10-05; verified by body comparison) |
| `20261007100300_listing_edit_record_only_by_edit.sql` | shared dev project (live before 2026-10-05; verified by body comparison) |
| `20261007100400_carry_after_cancelled_payout.sql` | shared dev project (live before 2026-10-05; verified by body comparison) |
| `20261004155900_my_car_vin_first.sql` | shared dev project: no-op (`20261004160000` had already run; `my_car_vin` present) |

`20261007100000` restates `settle_refund_operation` with one change: a refund
after the payout is capped at what the transfer can still give back (sent,
less earlier reversals), not at the cumulative refund share. A refund made
before the payout used to cancel the reversal of every later one by its share.
Guard: `supabase/tests/refund_reversal_cap_guard.sql`.
`20261007100100` restates `execute_admin_command` with one added line:
unsuspend is refused for any account with a deletion request on record, not
only while its job is unfinished (a member with orders keeps a scrubbed,
suspended profile after the job completes).
`20261007100200` restates `begin_refund_operation` and
`record_refund_provider_event`: a refund already added to `refunded_cents`
(waiting only for its transfer reversal) is no longer also subtracted as in
flight. Guard: `refund_inflight_guard.sql`.
`20261007100300` restates `record_listing_edit` and `save_listing_edit`: the
record function refuses unless called by the edit, in its transaction.
`20261007100400` restates `settle_refund_operation`,
`carry_on_transfer_intent_status` and `seller_carry_available_cents`: a refund
after a payout was cancelled for label costs adds what it uncovers to what
the seller owes, and a carry amount left on a transfer that never reached
dispatch no longer reserves the debt. Guard:
`carry_after_cancelled_payout_guard.sql`.

## October 6 — owner decisions: payout hold until claim windows close, auto-confirm untracked shipments after 21 days

| File | Applied to |
|---|---|
| `20261006100000_payout_hold_setting.sql` | shared dev project (2026-10-05) |
| `20261006100100_untracked_delivery_auto_confirm.sql` | shared dev project (2026-10-05) |
| `20261006100200_owner_settlement_decisions.sql` | shared dev project (2026-10-05) |
| `20261006100300_seller_payout_dates.sql` | shared dev project (2026-10-05) |

The first two add `public.settlement_settings` (one row) with neutral defaults:
`payout_hold_days` stays 7 in `fixed` mode, and `auto_confirm_after_days` is
NULL (off). `payout_available_at()` becomes the one rule for a payout date
(delivery trigger, `pickup_redeem`, `mark_order_received`, auto-confirm);
`mark_order_received`'s hold argument now defaults to NULL = "use the setting".
The auto-confirm job (`drvn-delivery-auto-confirm`, hourly) runs and records
health even while off. Decision notes: `docs/decisions/`. Replaced functions
were diffed against a fresh database: only the intended lines changed.
`20261006100200` then sets the owner's decisions (Neil, 4 Oct): hold mode
`claim_window` (7-day floor) and auto-confirm after 21 days. Guards that test
the fixed 7-day mechanism pin it inside their own rolled-back transaction.
`20261006100300` adds `seller_payout_dates()`: a seller reads the payout date
already set on their own orders, so the ledger shows the date the database
pays on rather than re-dating delivered orders with whatever the setting is
now. Apply it before deploying the app that calls it — without the function
the ledger says "unavailable".

## October 5 — round four: message-photo normalization, guest buyer reviews, unsuspend vs deletion, accepted-offer collection, seller carry-forward (shared dev project)

| File | Applied to |
|---|---|
| `20261005100000_message_photos_server_normalized.sql` | shared dev project (2026-10-04, after PR #10 merged) + isolated local stack |
| `20261005101000_guest_orders_unproven_buyers.sql` | shared dev project (2026-10-04, after PR #10 merged) + isolated local stack |
| `20261005102000_unsuspend_refuses_pending_deletion.sql` | shared dev project (2026-10-04, after PR #10 merged) + isolated local stack |
| `20261005110000_accepted_offer_collection.sql` | shared dev project (2026-10-04, after PR #10 merged) + isolated local stack |
| `20261005110100_seller_carry_forward.sql` | shared dev project (2026-10-04, after PR #10 merged) + isolated local stack |

Release readiness round four (`docs/plans/2026-10-release-r4-record.md`).
Shared dev: applied twice each after main reached 57995c1 and the dev server
was running it. The five replaced functions were backed up to
`~/drvn-db-backups/pre-20261005-r4-functions.sql`; their live bodies matched
the pre-round-four repository definitions apart from the lines these
migrations replace. Afterwards: carry-forward objects are service-role only,
8 existing orders were recorded as having unproven buyers, and browser
uploads into `message-photos` are refused.

- `20261005100000`: client uploads into the `message-photos` bucket are
  refused; message photos go through the server re-encode. Apply with the
  app that routes them there, or message photos stop uploading.
- `20261005102000` re-creates `execute_admin_command` (only the
  `user.unsuspend` branch changes; diffed against a fresh database).
- `20261005110000` re-creates `freeze_accepted_offer_checkout` and
  `guard_order_item_immutable`; `20261005110100` re-creates
  `complete_transfer_intent` and `settle_refund_operation` (marked lines
  only; diffs recorded in the round-four record). Reversals are now capped at
  the amount actually transferred.
- New: `seller_carry_entries`, `transfer_intents.dispatch_carry_cents`,
  `private.unproven_buyer_orders`, `order_buyer_reviewable`,
  `freeze_transfer_carry`, `seller_carry_available_cents`,
  `record_seller_carry`.

## October 4 — round three: closed definer functions, refund request keys, payout clocks, charge bounds, admin money window, import sweep, VIN privacy (shared dev project)

| File | Applied to |
|---|---|
| `20261004100000_revoke_internal_definer_functions.sql` | shared dev project + isolated local stack, 2026-10-03 |
| `20261004110000_refund_request_keys.sql` | shared dev project + isolated local stack, 2026-10-03 |
| `20261004120000_pickup_starts_payout_clock.sql` | shared dev project + isolated local stack, 2026-10-04 |
| `20261004130000_checkout_charge_bounds.sql` | shared dev project + isolated local stack, 2026-10-04 |
| `20261004131000_admin_money_window.sql` | shared dev project + isolated local stack, 2026-10-04 |
| `20261004140000_delivery_starts_payout_clock.sql` | shared dev project + isolated local stack, 2026-10-04 |
| `20261004150000_listing_import_sweep_schedule.sql` | shared dev project + isolated local stack, 2026-10-04 |
| `20261004160000_car_vin_private.sql` | shared dev project (2026-10-04, after PR #8 merged) + isolated local stack |

Release readiness round three (`docs/plans/2026-10-release-r3-record.md`).

- **Order matters for `20261004160000`.** It revokes table-wide SELECT on
  `cars` and grants every column but `vin`. App code that still does
  `select("*")` on cars (main before this round) is refused, so apply it
  only once the round-three app is deployed.
  The round-three app in turn needs `my_car_vin()`, which that same file
  creates — so `20261004155900_my_car_vin_first.sql` (added 7 Oct) creates the
  function alone. On a live environment: apply `20261004155900`, deploy the
  app, then apply `20261004160000`. On a fresh database the files simply run
  in order.
- `20261004130000` re-creates `purchase_begin`, `offer_accept_begin`,
  `prepare_payment_request`, `finish_reservation_expiry` and
  `claim_unmapped_payment_requests`. They are the previous definitions plus
  the charge-bound and rejected-request changes (diffed against a database
  built from main). It normalises lowercase `usd` rows to `USD` before
  adding the USD-only constraints, so they validate.
- `20261004140000` backfills `available_at` for already-delivered orders
  whose seller was waiting on a buyer click; on a database with history the
  transfer worker will then release those that are past clearing.
- The replaced definitions on shared dev were backed up first to
  `~/drvn-db-backups/pre-20261004-r3-functions.sql`; the live bodies were
  identical to the repository's before applying.

All apply twice cleanly. All 62 SQL guards pass on a fresh disposable
database built from the full chain, and generated types match.

## October 3 — edit replay, admin reconciliation, garage refund allocation, public watcher counts (shared dev project)

| File | Applied to |
|---|---|
| `20261003120000_listing_edit_request_replay.sql` | shared dev project + isolated local stack, 2026-10-03 |
| `20261003130000_admin_operation_reconciliation.sql` | shared dev project + isolated local stack, 2026-10-03 |
| `20261003140000_garage_refund_allocation.sql` | shared dev project + isolated local stack, 2026-10-03 |
| `20261003150000_listing_watch_counts.sql` | shared dev project + isolated local stack, 2026-10-03 |

Release-readiness round two (R2-01, R2-02, R2-03, R2-09). Additive:
- `listing_edit_requests` (private ledger) plus `save_listing_edit`,
  `replay_listing_edit`, `record_listing_edit` and `listing_edit_status`.
  `update_listing_atomic` is unchanged; the app now calls `save_listing_edit`,
  so **apply this before deploying the app that calls it**.
- `reconcile_admin_external_operation` and a unique partial index allowing
  one terminal (`completed`/`reconciled`) audit row per operationId. Before
  applying to a database with history, check
  `select metadata->>'operationId', count(*) from admin_audit_log where metadata->>'phase' in ('completed','reconciled') and metadata ? 'operationId' group by 1 having count(*) > 1`
  returns no rows. Rows without an operationId don't conflict.
- `garage_car_stats` replaced in place (same signature).
- `listing_watch_counts` (count-only, definer, mirrors the listing read
  policies) and `feed_hydration` re-created to take `watch_count` from it.
  Apply before the app that calls it.

Each applies twice cleanly (idempotent). All 55 SQL guards, including the new
`listing_edit_replay_guard.sql`, `admin_operation_reconcile_guard.sql`,
`garage_refund_allocation_guard.sql` and `listing_watch_counts_guard.sql`, pass on a fresh disposable database
built from the full chain, and generated types match.

Shared dev, 2026-10-03, with `node scripts/apply-migration.mjs`, twice each.
Checked first: every function, column and table they depend on exists; no
operationId has two terminal audit rows; the live `feed_hydration` body was
identical to `20260928170000`'s. The replaced `feed_hydration` and
`garage_car_stats` definitions are backed up to
`~/drvn-db-backups/pre-20261003-r2-functions.sql`. Afterwards: the edit ledger
is unreadable to `authenticated`; anon can't call `save_listing_edit` or
`reconcile_admin_external_operation`; a guest call to `listing_watch_counts`
through the API returned the real count (1) while a direct guest read of
`saves` still returned no rows. The app on `main` (still calling
`update_listing_atomic`) is unaffected — that function is unchanged.

## October 1 — atomic listing edits; garage sales from paid orders (shared dev project)

| File | Applied to |
|---|---|
| `20261001120000_update_listing_atomic.sql` | shared dev project, 2026-10-01 |
| `20261001130000_garage_car_stats.sql` | shared dev project, 2026-10-01 |

Release-readiness fixes RR-05 and RR-09/RR-25. Each adds one SECURITY
INVOKER function and its grants, nothing else. Dev was checked for every
column, function and trigger the two depend on before applying. Applied
twice each with `node scripts/apply-migration.mjs` (idempotency check). Guard
tests `listing_edit_atomic_guard.sql` and `garage_car_stats_guard.sql` pass
on a fresh disposable database with the full chain.

## September 29 — suspended members can't post in listing Q&A (shared dev project)

| File | Applied to |
|---|---|
| `20260929120000_suspended_members_dont_ask.sql` | shared dev project, 2026-09-29 |

A restrictive insert policy on `listing_questions` (not `is_suspended`),
matching the posts, replies and offers guards (`20260928182300`) and the
Messages session's `20260929110000`. Adds a policy only.

## September 29 — suspended members can't message (shared dev project)

| File | Applied to |
|---|---|
| `20260929110000_suspended_members_dont_message.sql` | shared dev project, 2026-09-29 |

One restrictive insert policy on `messages` (`not is_suspended(auth.uid())`),
the same shape 20260928182300 gave posts, replies and offers. Checked in a
rolled-back transaction: a suspended sender is refused, a normal one isn't.
Service-role lifecycle notes are unaffected. `sendThreadMessage` shows
`SUSPENDED_MESSAGE` when a send is refused this way.

## September 28 — posts and replies can be reported; suspension stops posting (shared dev project)

| File | Applied to |
|---|---|
| `20260928182300_moderation_posts_comments_suspension.sql` | shared dev project, 2026-09-28 |

`reports.subject_type` accepts `post` and `comment` as well as `listing` and
`user`. Restrictive policies (AND'd with the existing ones, which are
unchanged) refuse a suspended member (`is_suspended(auth.uid())`) inserting
or updating `activity_posts`, inserting `activity_comments`, and inserting
`offers`. Messages are not changed here. Previous constraint and policies:
`~/drvn-db-backups/pre-20260928182300-moderation.sql`.

## September 28 — a post's author can delete replies on it (shared dev project)

| File | Applied to |
|---|---|
| `20260928182200_post_authors_delete_comments.sql` | shared dev project, 2026-09-28 |

Adds the delete policy "post authors delete comments" on `activity_comments`:
the author of a post may delete any reply under it (the writer of a reply
already could). Existing policies unchanged; snapshot in
`~/drvn-db-backups/pre-20260928182200-activity_comments-policies.sql`.

## September 28 — Trending chips carry catalog ids (shared dev project)

| File | Applied to |
|---|---|
| `20260928182100_trending_models_catalog.sql` | shared dev project, 2026-09-28 |

`trending_models` also returns `catalog_make_id` / `catalog_model_id` for each
make + model group, so Explore's Trending chip opens the vehicle filter (the
builds it counted) instead of a loose text search. The return type changes, so
the function is dropped and recreated; the previous definition is in
`~/drvn-db-backups/pre-20260928182100-trending_models.sql`.

## September 29 — sellers can mark a part sold (shared dev project)

| File | Applied to |
|---|---|
| `20260929100000_seller_marks_sold.sql` | shared dev project, 2026-09-29 |

`guard_listing_status` now lets a seller move their own active or paused
listing to `sold` ("Mark sold" — sold somewhere else). Every other change to
`sold` or `reserved` is still checkout's. The live definition before the
change is in `~/drvn-db-backups/pre-mark-sold-guard_listing_status.sql`.

## September 28 — "N sold" for visitors (shared dev project)

| File | Applied to |
|---|---|
| `20260928182000_profile_sales_count.sql` | shared dev project, 2026-09-28 |

Adds `profile_sales_count(p_profile)`, a definer function returning only the
number of paid/shipped/delivered/completed orders a visible profile has sold —
the profile trust line read `orders` through RLS and showed 0 sold to anyone
but the seller and their buyers. New function; nothing replaced.

## September 28 — garage cars get catalogue ids (shared dev project)

| File | Applied to |
|---|---|
| `20260928181000_backfill_car_catalog_ids.sql` | shared dev project, 2026-09-28 |

Data only. Cars with no `catalog_make_id` get one by case-insensitive make
name, and a `catalog_model_id` by exact model name or else the longest
catalogue model the car's model starts with ("M4 Competition" → M4). The
marketplace only offers garage cars that carry a catalogue id, so before this
no existing member saw "Parts for my …". On dev 18 of 19 cars matched a make
and 16 a model. Previous values (all null) are in
`~/drvn-db-backups/pre-20260928181000-cars-catalog-ids.sql`. Safe to re-run.

## September 28 — card hearts count 🔥 only (shared dev project)

| File | Applied to |
|---|---|
| `20260928170000_card_likes_fire_only.sql` | shared dev project, 2026-09-28 |

Redefines `feed_hydration` (from `20260928120500`, the performance session's
migration) with two changes: a post's card count and the viewer's "liked"
mark read 🔥 reactions only, matching the heart that toggles 🔥. The live
definition before the change is in
`~/drvn-db-backups/pre-20260928170000-feed_hydration.sql`.

## September 28 — offer notifications open the offer (shared dev project)

| File | Applied to |
|---|---|
| `20260928160000_offer_notification_links.sql` | shared dev project, 2026-09-28 |

Replaces `notify_on_offer`, `notify_on_offer_response` and `notify_on_follow`
(previous definitions in `~/drvn-db-backups/pre-20260928160000-fn-*.sql`):
offer notifications link to `/offers/<id>` instead of `/orders`; a seller's
acceptance is announced once, by the app; a buyer accepting the seller's
counter now tells the seller; car follows get their own `car_follow` kind
(existing rows backfilled). Sorts after the Messages session's
`20260928140000`, which touches no offer or follow trigger.

## September 28 — one conversation per pair of people on the shared dev project

| File | Applied to |
|---|---|
| `20260928140000_person_conversations.sql` | shared dev project, 2026-09-28 (owner-approved as part of the Messages rebuild) |

`conversations` changes grain from one row per order/offer to one row per pair
of people (`participant_a < participant_b`, unique); the per-deal columns are
dropped and every message stays tagged with its order/offer. The 11 per-deal
rows on dev merged into 9 pairs; unread counters were rebuilt from `read_at`.
Also adds `messages.kind`/`attachments`, the private `message-photos` bucket,
`list_conversations` and `seller_open_question_list`, a delete trigger that
keeps previews honest, adds `messages` + `conversation_unreads` to the realtime
publication, and drops the `messages_notify` bell trigger. Backup first:
`~/drvn-db-backups/messaging-before-person-conversations-20260928-1743.sql`
(data) and `messaging-schema-before-…sql` (schema). The file was re-run once
to prove it is idempotent (the merge only runs while the old columns exist).
The local disposable database used by `npm run db:types` does not have it yet,
so `db:types:check` reports drift until it is applied there; the generated
types were edited to match by hand.

## September 28 — reserved parts readable on the shared dev project

| File | Applied to |
|---|---|
| `20260928150000_reserved_listings_readable.sql` | shared dev project, 2026-09-28 |

'reserved' joins 'active' and 'sold' in the listing read policy and the
photo, fitment, part-number and Q&A policies that follow it, so a part held
by a checkout or an accepted offer shows as Reserved instead of a 404. Every
browse, feed, store and search query already filters to active itself. The
previous policy definitions are in
`~/drvn-db-backups/listing-policies-pre-20260928150000.json`.

## September 28 — Home feed and recommendations in one round trip each

| File | Applied to |
|---|---|
| `20260928120500_feed_hydration.sql` | shared dev project, 2026-09-28 |
| `20260928121000_recommend_listings.sql` | shared dev project, 2026-09-28 |

Owner-approved performance work (speed audit, 28 Sep). Both only add
functions; no table, policy or existing function changes, so no backup was
needed. Applied with `scripts/apply-migration.mjs`.

- `feed_hydration(post_ids, car_ids, listing_ids, viewer)` returns every
  signal a page of feed cards needs, counts already made, as one jsonb.
  SECURITY INVOKER, so each read runs under the caller's RLS exactly as the
  per-table reads did; viewer marks are read only when `p_viewer` is
  `auth.uid()`. `hydrateFeedItems` falls back to the per-table reads if the
  function is missing. Verified identical output against the old path for
  signed-out and three signed-in viewers, every feed kind, two pages.
- `recommend_listings(user, limit)` runs the three recommendation rules in
  one statement. Execute is granted to `service_role` only (revoked from
  anon/authenticated by name). Identical to the old path for 26 of 27
  profiles; the one difference is a fix — the old platform match missed
  garages whose make differs only in case ("volkswagen" vs "Volkswagen").
  `recommendListings` falls back to the per-rule reads if it is missing.

## September 28 — duplicate `write_activity_post` removed from the shared dev project

| File | Applied to |
|---|---|
| `20260928120000_drop_legacy_write_activity_post.sql` | shared dev project, 2026-09-28 |

The September 24 catch-up (below) re-ran `20260905230238`, which re-created the
8-argument `write_activity_post` beside the 9-argument form from
`20260919194000`. The catch-up's snapshot comparison matched functions by
signature, so this overload was missed. With both present, PostgREST returned
PGRST203 for every call that omits `p_listing_ids`: full updates, drafts,
autosave, edits and untagged quick posts. Both definitions were saved to
`~/drvn-db-backups/write_activity_post-overloads-20260928.json` before the
drop. Verified with a draft save through the API. A fresh install never had
the duplicate, so the file is a no-op there.

## September 24 — invited-beta boundaries reach the shared dev project

| File | Applied to |
|---|---|
| `20260905190032_invited_beta_boundaries.sql` | shared dev project, 2026-09-24 — rollout row inserted with `enforced = false` |
| `20260905203301_retain_consumed_beta_invitation_history.sql` | shared dev project, 2026-09-24 |

`getBetaAccess()` fails closed when `beta_access_status` is missing, so
without these the dev site told every account, including sellers with live
listings, that selling was invite-only. Enforcement stays off until an
operator flips `beta_access_config.enforced`.

## September 24 — the September 5–6 remediation chain reaches the shared dev project

Applied to shared dev `drvn-v3` (`grunnjojhdevhuckujmc`) on 2026-09-24, owner-approved:
every `20260905*` and `20260906*` file in filename order (the two beta files
above were already in), then `20260919205000_account_export_contract_v4.sql`,
which had been local-only because it needs the September 5 privacy tables.
The app code already called several of these functions (`mark_order_dispatched`,
`mark_order_received`, `settle_seller_cancellation`, `bind_cart_checkout_payment`,
`prepare_payment_request`…), so dispatch, receipt, seller cancellation and cart
checkout were failing on dev before this.

**How, not a replay.** Backup first: `pg_dump` of `public` + `private`
(schema and data) plus a snapshot of every function a later migration also
defines, kept outside the repo in `~/drvn-db-backups/`. The files were applied
through `.reconcile-migrations.mjs` (untracked runner): each file in its own
transaction; where an earlier focused repair had already created an object,
only that statement was made idempotent and the file retried. The repo files
are unchanged. Adjustments made:

| File | Reconciled |
|---|---|
| `20260905011618_remediation_integrity.sql` | `worker_runs` table + `worker_runs_family_time` index already existed (created identically by `20260913132451`) |
| `20260905124840_consent_purchase_outbox.sql` | `analytics_consents` table and its "own analytics preference" policy already existed (`20260913134823`) |
| `20260905233517_durable_listing_creation_request.sql` | `save_listing_creation` already existed in its newer `20260919190500` form |
| `20260905235246_durable_offer_submission.sql` | `offers_one_live_buyer_listing` index and `create_offer_with_message` already existed (`20260913134823`) |

**Newer definitions restored.** Fourteen functions are defined both by the
September 5 chain and by a later, already-applied migration. After the chain,
each was compared with its pre-chain snapshot and, where the chain had
overwritten it, the later definition was put back — the same final state a
fresh install reaches in filename order: `record_worker_run`,
`save_listing_creation`, `save_mod_items`, `search_car_ids`,
`search_update_ids` were restored; the other nine were unchanged. No policy,
view or trigger names overlap.

**Checks.** `supabase/marketplace-release-preflight.sql`: all 14 checks
ready. No duplicate payment rows existed before the one-payment-per-order
index. Every signed-in and signed-out route loads.

**Admin MFA is live here.** `/admin` and `/docs` now require AAL2 with a TOTP
check in the last 15 minutes (`src/lib/admin/guard.ts` → `/admin-verify`).
The console-admin fixture has an enrolled TOTP factor; its secret is kept
outside the repo, in `~/drvn-db-backups/`.

**Operator settings still to do on this project** (from
`docs/remediation-rollout.md`; schema alone doesn't do them): the canonical
Site URL/redirects, SMTP + magic-link template, the `job_config` worker URL
and CRON_SECRET for the money/search/deletion workers, and the
`/api/health/workers` monitor.

## September 19 — security repairs from the direction-build review

| File | Applied to |
|---|---|
| `20260919201000_direction_security_repairs.sql` | shared dev project and local test database, 2026-09-19 |
| `20260919202000_post_edit_repairs.sql` | shared dev project and local test database, 2026-09-19 |
| `20260919203000_mod_sheet_stale_delete.sql` | shared dev project and local test database, 2026-09-19 |
| `20260919204000_brand_backfill_correction.sql` | shared dev project and local test database, 2026-09-19 |
| `20260919205000_account_export_contract_v4.sql` | local test database, 2026-09-19; shared dev project, 2026-09-24 — it needs the 2026-09-05 privacy tables, so it waited for the September 5–6 chain (see the top of this file) |
| `20260920090000_profile_follow_counts.sql` | shared dev project and local test database, 2026-09-20 — read-only definer function for profile header counts |

Adds no feature; closes holes a review found in `…170000`–`…200000`.
`profiles.default_offer_floor_pct` loses its client select grant (a column
grant can't be narrowed to "your own row", so every buyer could read every
seller's floor) and the owner reads it through `my_default_offer_floor()`.
`write_activity_post` gets back the revoke it lost when its arity changed;
`post_href` — security definer, and it named private car slugs — is now
service-role only; `local_feed_rows` is signed-in only. `suggested_builders`
filtered a column no client can read and failed on every call; it now asks
`profile_is_visible()`. Tagged parts follow the post's visibility, are capped
at three and active-only inside `sync_activity_post_listings` itself (a part
already tagged keeps its tag, which is how a post comes to say Sold), and a
carless post can't be emptied of its last part. A trigger stops a car owner
claiming somebody else's order item onto a mod; `mod_purchase_sources()` lets
the public build page show "Bought on DRVN"; and three check constraints
bound what a pasted link may store. Covered by
`supabase/tests/direction_security_guard.sql`.

`…202000` re-creates `write_activity_post` so a published post can be edited
whatever kind it is: `update` accepts a null car and matches with
`is not distinct from` (a carless post could be published and never
corrected), and a post with no title may stay without one (editing a quick
post demanded a title it was never meant to have). `…203000` re-creates
`save_mod_items` with one change to its delete: a row the payload omits is
kept when it has a linked listing or a purchase source, because both are
written from other screens and a sheet left open in a second tab would
otherwise erase them. Covered by `activity_quick_post_guard.sql` and
`mod_sheet_atomic_guard.sql`.

`…204000` corrects what the 190000 brand backfill could get wrong on a real
catalogue (category words as brands, prefix matches with no word boundary,
two spellings of one maker). It only clears a brand on rows untouched since
the backfill, so a brand a seller typed is never second-guessed.

`…205000` moves the account export to contract `2026-09-19.v4`. The version
lives in two places — the constant in `src/lib/account-export-contract.ts`,
and this database (a check constraint plus the literal
`request_account_export()` stamps on each request). The constant had been
bumped without a migration, so every request was stamped with the old
version, the worker purged it as foreign, and no export completed.
`account-export-contract.test.ts` now fails if the two disagree.

## September 19 — mod record identity (2026-09 direction, WS2/WS6/WS4)

| File | Applied to |
|---|---|
| `20260919170000_mod_record_identity.sql` | shared dev project `drvn-v3` (`grunnjojhdevhuckujmc`) and the local isolated test database, 2026-09-19 |

Additive and idempotent. `mod_items` gains `status` (installed / removed) and
`removed_at`, so removing a part is a state rather than a delete — the row
keeps its id, which is what lets a public build sheet say "came off this car"
and lets a listing keep pointing at the line it was released from. The same
file carries the columns the two neighbouring workstreams need, so
`save_mod_items` is re-created once rather than three times: `product_url`,
`image_url`, `source_domain`, `ref_price_cents` + `ref_price_currency` for
"add a mod by pasting a link", and `source_order_item_id` (unique where set)
for "add what I bought to my car".

Two invariants are database-enforced rather than assumed: `removed_at` is set
exactly when `status = 'removed'`, and a reference price without a currency is
refused. `save_mod_items` derives `removed_at` itself and never takes it from
the client, so re-saving a sheet doesn't drag the date a part came off forward
to today. **The delete statement is byte-identical to `20260905224929`'s** —
the editor keeps sending removed rows with their status, so omitting a row
still means delete. `source_order_item_id` is deliberately absent from the
function's column lists: leaving it out is what makes an ordinary sheet save
preserve it.

Covered by `supabase/tests/mod_sheet_atomic_guard.sql`, which gained a second
block for record identity (remove keeps the id, replace files a new one in its
position, re-saving doesn't move the removal date, an omitted row still
deletes, a price with no currency and an unknown state are both refused). The
whole guard suite passes locally.

## September 19 — followers index and main car (WS3, WS5)

| File | Applied to |
|---|---|
| `20260919180000_listings_seller_status_created_idx.sql` | shared dev project and local test database, 2026-09-19 |
| `20260919181500_profiles_main_car.sql` | shared dev project and local test database, 2026-09-19 |

Both additive and idempotent. The index answers "what is this seller selling,
in this state, newest first?" — asked by the followed feed (B-1), the Store
tab (P-6) and every card's "N for sale" count (M-5), and previously a
seller-wide scan filtered in memory.

`profiles.main_car_id` needs explicit column-level grants, because a new
`profiles` column is invisible and unwritable until granted and a table-wide
grant would re-expose the Stripe pointers 0017 deliberately hid. A BEFORE
UPDATE trigger enforces that the car is the member's own: RLS governs who may
update the row, not whether the value is theirs. Covered by
`supabase/tests/security_guard.sql`.

## September 19 — brand, miles, store (WS9, WS10)

| File | Applied to |
|---|---|
| `20260919190000_listing_brand_and_miles.sql` | shared dev project and local test database, 2026-09-19 |
| `20260919190500_save_listing_creation_brand.sql` | shared dev project and local test database, 2026-09-19 |
| `20260919191000_seller_active_counts.sql` | shared dev project and local test database, 2026-09-19 |
| `20260919192000_profiles_store_note.sql` | shared dev project and local test database, 2026-09-19 |

All additive and idempotent. `listings` gains `brand`, `part_miles` and
`part_miles_unit`; brand joins `search_listing_ids`; a conservative backfill
matches the curated brand list anchored at the start of a title, longest name
first, and leaves anything it can't match null. `marketplace_brand_counts`
and `seller_active_counts` are the two facet/count RPCs the card and the
filters need without a query per row.

`save_listing_creation` was re-created because it enumerates its columns in
**three** places — the insert list, the values parser and the replay-drift
comparison. Updating fewer than three drops the field silently on publish.

`profiles.store_note` takes explicit column grants and a 180-character check.

## September 19 — Explore, quick posts, Local (WS13, WS14a, WS15, P-9)

| File | Applied to |
|---|---|
| `20260919193000_suggested_builders.sql` | shared dev project and local test database, 2026-09-19 |
| `20260919194000_quick_post_and_tagged_parts.sql` | shared dev project and local test database, 2026-09-19 |
| `20260919195000_trending_models.sql` | shared dev project and local test database, 2026-09-19 |
| `20260919196000_seller_defaults_and_region.sql` | shared dev project and local test database, 2026-09-19 |

`194000` is the release-blocking one. `activity_posts.title` becomes
nullable (W-1: a quick post is a photo and a caption; inventing a heading
would be writing on somebody's behalf), `activity_post_listings` records the
parts a post tags (W-3, at most three), and `write_activity_post` gains a
`quick` mode plus `p_listing_ids`. **`quick` returns before the draft lookup
that `publish` performs** — `publish` converts the car's existing unpublished
draft into the published post, so without that early return a two-line quick
post would silently consume and overwrite a half-written long update. The
photo requirement (W-2) applies to `publish` and `quick` only, never to
drafts and never to `update`, so a post published before the rule can still
be edited. Adding a defaulted parameter created a second overload that made
every existing call ambiguous, so the old eight-argument signature is dropped
explicitly. Covered by `supabase/tests/activity_quick_post_guard.sql`, which
proves the draft is byte-identical afterwards.

`sync_activity_post_listings` is SECURITY DEFINER (it writes a table the
author has no direct grant on) and therefore checks `v_author = auth.uid()`
itself — otherwise a direct call could tag parts onto somebody else's post.

`196000` adds `profiles.default_offer_floor_pct` (P-9 — a default for the
sell form, never retroactive to a live listing), `country` and `region`
(H-2), all with explicit column grants, and `local_feed_rows`.

## September 19 — posting without a car (WS14b)

| File | Applied to |
|---|---|
| `20260919197000_posts_without_a_car.sql` | shared dev project and local test database, 2026-09-19 |
| `20260919198000_carless_posts_reach.sql` | shared dev project and local test database, 2026-09-19 |
| `20260919199000_carless_quick_post.sql` | shared dev project and local test database, 2026-09-19 |
| `20260919200000_carless_post_policies.sql` | shared dev project and local test database, 2026-09-19 |

Four files rather than one, because dropping `activity_posts.car_id`'s NOT
NULL is the small half of this change. Every reader, the writer and the RLS
policies expressed the car requirement as a join or an EXISTS against `cars`,
and each of them would have dropped a carless post **silently** — which to
the member looks exactly like posting into nothing.

- `197000` drops the NOT NULL and adds `guard_post_has_subject`, a constraint
  trigger that requires a car, a tagged part, or both on publish. It is
  `DEFERRABLE INITIALLY DEFERRED` because the post and its tagged parts are
  written in the same transaction and the parts land second.
- `198000` teaches the readers: `post_href()` (the SQL twin of `postHref()`
  in `src/lib/activity/href.ts`) replaces the hand-built
  `'/cars/' || slug || '/activity/' || id` in all three notification
  functions, so a save, a comment or a reaction on a carless post reaches its
  author instead of vanishing into a null owner. `feed_events` admits carless
  updates and gains `owner_id` — Local needs to ask the timeline "whose is
  this", and a second view would drift from this one. `local_feed_rows` and
  `search_update_ids` make the same join outer.
- `199000` re-creates `write_activity_post` from `pg_get_functiondef` with
  three edits: the car is optional in `quick` mode only, a carless post must
  tag at least one part (said up front so the composer can show a sentence),
  and the replay lookup compares the car with `is not distinct from` so a
  carless retry matches a carless post rather than every post.
- `200000` is the **RLS** half. The insert policy required a car you own and
  the select policy required a public car, so a carless post could not be
  written at all and, had it existed, only its author could read it.
  Restated, not widened: you must still own any car you name; a *published*
  post with no car is public because there is no private car to hide behind
  and publishing is the act of making it public; unpublished drafts stay
  author-only. `activity_post_visible()` (shared by the comment and reaction
  policies) and the `activity_images` select policy carry the same join, and
  get the same treatment — without them nobody could comment on, react to, or
  even load the photos of a carless post, including its author.

Covered by `supabase/tests/carless_post_reach_guard.sql`: a carless post
publishes, a post about neither a car nor a part is refused, the post appears
in `feed_events` with the right owner, search finds it, Local finds it in the
author's region and not in another, `post_href` gives `/posts/<id>` for it
and leaves a post with a car at the address every existing link points at,
and a save, a comment and a reaction each notify the author at that URL.

## September 13 marketplace shopping contract — shared deployment

The following focused migrations were rehearsed locally and applied to shared `drvn-v3` (`grunnjojhdevhuckujmc`):

| Local file | Shared ledger version |
|---|---|
| `20260913132451_marketplace_shopping_contract.sql` | `20260913134641` |
| `20260913134823_marketplace_consent_and_offers.sql` | `20260913135341` |
| `20260913144218_marketplace_evidenced_part_types.sql` | `20260913144516` |

These add invoker-rights listing retrieval/evidence/counts, complete saved-search definitions, idempotent saving, the existing exact-state social mutation, service-only worker records, consent preferences and atomic offer submission. They preserve the older browse functions and existing saved criteria. The offer migration includes a duplicate-live-offer preflight. Inventory reconciles to sixteen active parts after deployment. A final evidence-backed data migration classifies fourteen missing part types, corrects the KW coilovers parent and leaves the roof box unclassified. Exact reviewed title/description/category guards protect later seller edits; the assignment snapshot is retained in the acceptance record.

The first **108 migrations and 44 SQL guards** pass in a fresh disposable PostgreSQL instance after updating four legacy test fixtures to valid catalog assignments. The subsequent data-only assignment migration also passed its separate rollback-isolated fixture guard, including repeatability and concurrent seller-edit protection. This verifies a fresh install plus the additional data repair; it does not reconcile the shared project's partial historical ledger. Run `marketplace-release-preflight.sql` before any app promotion: the shared database still lacks the newer checkout preparation, frozen cart identity and purchase analytics dependencies. The complete commerce chain needs the existing coordinated release procedure. **Do not apply the entire historical tree to the existing project.** See [the September 13 acceptance record](../docs/remediation-evidence/marketplace-2026-09-13/README.md).

## September 12 marketplace repair — shared deployment

Two focused, locally rehearsed repairs are now applied to shared project `drvn-v3` (`grunnjojhdevhuckujmc`). Supabase MCP assigned ledger versions independently of the CLI-generated local filenames:

| Local file | Shared ledger version |
|---|---|
| `20260913012911_marketplace_retrieval_repair.sql` | `20260913014536` |
| `20260913014222_marketplace_category_integrity.sql` | `20260913014621` |

The first restores marketplace search/filter functions and their reviewed suspension-visibility dependencies. The second maps two supported legacy category assignments and validates parent/part-type integrity. Public browse/search probes now succeed, with 16 active listings at deployment. The original September 5 worker migration now tolerates the two pre-existing policy names; its unrelated worker changes have not been deployed by this repair.

The shared ledger previously contained only 0001–0011 despite later schema objects being present. Reconcile schema and ledger explicitly; **do not replay historical migrations or apply a duplicate solely because a local timestamp differs**. Full deployment/test/rollback evidence is in [the marketplace implementation record](../docs/remediation-evidence/marketplace-2026-09-12/README.md).

## September 2026 remediation — local verification only

`20260905011618_remediation_integrity.sql` was generated with the Supabase CLI and applied to the disposable local Supabase stack and the exact CI PostgreSQL 15 image. All ten SQL guard files pass there. It has **not** been applied to the shared/production project. The historic status entries below are unchanged and do not imply deployment of this migration.

The migration adds durable payment requests, atomic capture/payout/compensation, queued receipts/search/deletion, admin MFA/atomic commands, normalized-public-upload enforcement and worker health/schedules. It replaces the payment-reference uniqueness rule to allow a multi-seller basket to share one Stripe intent, while enforcing one payment row per order. Check historical duplicate order payments before applying the index.

Follow [the remediation rollout](../docs/remediation-rollout.md) for coordinated application/schema deployment and required Auth, SMTP and scheduler settings. Do not apply the destructive initial schema to an existing project.


The entries below are historical application records. Compare the destination's actual schema and migration history before applying any file. Apply only reviewed, unapplied migrations through the established SQL Editor/runner procedure. **0001 is destructive; never replay the tree against an existing project.** Some later files were tested for repeatability, but the whole tree is not a safe re-run operation.

## Status: 0001–0039 recorded below; 0040–0046 applied but unrecorded here; 0047–0056 applied

0056 (shop_profiles — one-to-one shop extension of profiles: admin-granted
verification_status, small preference-return policy (accepted + 14/30/60-day
window); public-readable, writes service-role only; restates
listing_commercial_snapshot to freeze the shop policy + verified state into
each purchase) applied 29 August 2026 via `node scripts/apply-migration.mjs`,
applied twice; self-checks pass.

0055 (returns — the RMA domain: `returns` (type protection|shop_policy,
responsibility, guarded 11-state lifecycle, deadlines frozen on the row,
agreed entitlement + label deduction, refund_operation_id link) +
`return_items` (item-aware, per-item inspection, one-live-RMA-per-unit guard
trigger); shipments.return_id gains its FK; participants-read RLS) applied
29 August 2026, applied twice; self-checks pass. Guard suite
`supabase/tests/return_guard.sql` green against the project (rolled back):
lifecycle guard, one-live-RMA, plus the 0054 pickup_redeem checks
(seller-only, attempt counting, single-use, delivers the order).

0054 (pickup_confirmations — single-use Pickup Pass per collection order:
hashes only (token + 6-digit code), 10-attempt lockout, 1h TTL, atomic
`pickup_redeem()` that delivers the order; orders.pickup_ready_at; restates
listing_commercial_snapshot to freeze the listing's real shipping_mode)
applied 29 August 2026, applied twice; self-checks pass.

0053 (listing_shipping_choices — listings.shipping_mode flat|drvn|pickup_only
+ seller-declared parcel; server-held `shipping_rate_quotes` (deny-all RLS,
destination-fingerprinted, expiring); orders.shipping_quote frozen service
snapshot; `guard_order_collection` trigger — is_collection only when every
item's SNAPSHOT offered it; purchase_begin restated with
p_shipping_overrides (old 4-arg overload dropped)) applied 29 August 2026,
applied twice; self-checks pass.

0052 (shipments_and_adjustments — `shipments` (outbound|return, guarded
lifecycle, label_reference excluded from the client column grant) +
`shipment_items` (one-live-shipment-per-item-per-direction guard) +
`shipment_events` (webhook-dedupe unique index) + `seller_adjustments`
(signed append-only label/insurance ledger, unique (kind, external_reference)
idempotency, void-once guard)) applied 29 August 2026, applied twice;
self-checks pass.

0051 (seller_fulfillment_profiles — PRIVATE ship-from/return address +
handling days + easypost_end_shipper_id per seller; owner/admin read only,
zero client write policies) applied 29 August 2026, applied twice;
self-checks pass.

0050 (fee_includes_shipping — platform-fee basis becomes goods subtotal +
buyer-paid shipping in both order-creation paths; `purchase_begin` and
`offer_accept_begin` restated in full with only the fee line changed.
Historical orders untouched: every consumer prefers the stored
`platform_fee_cents`) applied 29 August 2026 via
`node scripts/apply-migration.mjs`, applied twice (idempotency check);
self-checks pass.

0049 (commercial_snapshot — the immutable "as purchased" record:
`order_items.commercial_snapshot` (versioned jsonb, NOT NULL, filled by
BEFORE INSERT trigger from the listing/fitment/part-numbers/source-car/seller
rows, superseding 0024's condition-only trigger) + `order_item_snapshot_images`
(gallery frozen row-per-photo, participant-read RLS, UPDATE-refusing guard);
column guard makes the frozen order_items columns immutable; backfill for
pre-0049 rows flagged `backfilled`/`degraded`) applied 29 August 2026 via
`node scripts/apply-migration.mjs`, applied twice (idempotency check);
self-checks pass. Guard suite `supabase/tests/snapshot_guard.sql` run against
the project (rolled back): all 7 assertions pass, including
edit-everything-after-sale leaving the frozen record byte-identical and the
same buyer total producing the same fee regardless of price/shipping split.

0048 (search_wordwise — rewrites `search_listing_ids` from contiguous-phrase
matching to word-wise matching with word-similarity typo tolerance and
matched-word-count ranking; empty queries still return everything. Applied
twice 2026-08-28, idempotent.)

0047 (listing_imports — the Existing Listing Importer's durable job table:
status state machine with a transition-guard trigger, step lease, owner-only
RLS, active-URL dedupe index, per-user in-progress cap trigger, 48h expiry
aligned with the 0029 staged-media lifecycle; plus profiles.import_attested_at
for the one-time content-rights acknowledgement) applied 28 August 2026 via
`node scripts/apply-migration.mjs`, applied twice (idempotency check);
self-checks pass. Guard suite `supabase/tests/import_guard.sql` run against
the project (rolled back): all 8 assertions pass.

(Note: this file's log drifted behind the repo — 0040–0046 were applied to the
project when their features shipped but were not written up here.)

0039 (orders.correlation_id — one observability identity per checkout, stamped
by the app and mirrored into Stripe PaymentIntent metadata; never a money-path
key) applied 27 August 2026 via `node scripts/apply-migration.mjs` (the
MIGRATIONS.md runner, now a checked-in script), applied twice (idempotency
check); self-checks pass.

0037 (card engagement: public `likes` on listings/cars, `saves.target_type`
learns 'post') and 0038 (notify_on_save handles 'post' — the 0009 trigger's
profile catch-all fed a post id into notifications.user_id, an FK violation
that rolled back the save) applied 16 August 2026 via node-postgres, each
applied twice (idempotency check); self-checks pass. Verified end-to-end from
the browser: card like → `likes` row, post save → `saves` row + /saved
"Saved updates" section.

0036 (account_emails) applied 15 August 2026 via node-postgres, applied twice
(idempotency check); self-checks pass, 6 addresses backfilled. It exists so
guest checkout can answer "does this email already have an account?" — RLS is
enabled with NO policies, so anon/authenticated read nothing and only the
service role can use it. Deliberately not a column on `profiles`, which is
publicly readable.

0034 (orders.origin_offer_id) and 0035 (seller_open_questions) applied
15 August 2026 via node-postgres, each applied twice (idempotency check);
self-checks pass. 0034's backfill reported `linked 0 / 0 unlinked` on this
project — there were no accepted-offer orders to link, so nothing was
inferred. On an environment with history it links only pairings recorded in
the payments idempotency key (`offer:<offer_id>:<order_id>`); pre-0012
accepts have no such key and are left null rather than guessed.

0029 (staged media) – 0032 (feed events view) applied 9 August 2026 via
node-postgres, each applied twice (idempotency check); 0031 self-checks pass.

0001–0005 by hand pre-July; 0006–0009 on 26 July 2026; 0010–0015 during the
Rev C/D sessions; 0016 on 31 July 2026 (0014–0016 columns verified live
column-by-column on 31 July 2026). 0017 on 1 August 2026 (Rev E session,
exploit reproduced then re-verified blocked). 0018 on 1 August 2026 — applied
twice (idempotency check) and verified live by impersonation: all 23
assertions in `supabase/tests/admin_guard.sql` pass, rolled back. 0019 on
1 August 2026, applied twice (idempotency check), self-checks pass. 0020 on
1 August 2026, applied twice, self-checks pass; the backfill created intents
for every captured-but-untransferred order, and the worker's first pass (run
from the admin console) cancelled the stub-era ones on record. 0021 on
1 August 2026, applied twice, self-checks pass. 0022 on 1 August 2026, applied
twice (node-postgres), self-checks pass. 0023–0025 on 2 August 2026, applied
twice (node-postgres); columns, tables and the dispute-evidence bucket
verified live post-apply. 0026–0027 on 6 August 2026, applied twice each
(node-postgres), self-checks pass; `claim_transfer_intents` smoke-tested live
(0 claimable — queue healthy). 0028 on 9 August 2026 (shipping address
region), applied with the money-durability sweep — see
`docs/remediation-status.md`.

### Production wiring for the transfer worker

Set `CRON_SECRET` in the app environment, then point the scheduler at the
deployed URL (service role / SQL editor):

```sql
insert into public.job_config (key, value) values
  ('transfer_worker_url', 'https://<app-host>/api/jobs/transfers'),
  ('transfer_worker_secret', '<CRON_SECRET value>')
on conflict (key) do update set value = excluded.value, updated_at = now();
```

Until that's configured (e.g. in dev, where the cloud DB can't reach
localhost), the cron still marks intents due every 10 minutes and the admin
console's Payments → "Run worker now" is the processing path.

### 0029 — staged media + GC scheduling (pending)

`0029_staged_media.sql` adds the `staged_uploads` ledger the photo-upload
lifecycle writes to (src/lib/media-staging.ts / src/lib/media-lifecycle.ts).
After applying it, schedule the abandoned-upload sweep — a daily hit on the
authenticated job route is enough:

```
curl -X POST https://<app-host>/api/jobs/media-gc \
  -H "Authorization: Bearer $CRON_SECRET"
```

The route is idempotent and batch-limited (200 rows/pass); it only deletes
storage objects that are >48h staged, unconsumed AND unreferenced by any
image/avatar/cover column, so re-running or overlapping runs are safe.

Applied to project `grunnjojhdevhuckujmc` (`drvn-v3`) and verified:
`supabase/tests/purchase_guard.sql` passes all nine assertions, and the
notification triggers raise into the correct sections. The commands below are
the record of how, and what to do for the next environment. For standing up a
**production** project from scratch, follow
[docs/production-runbook.md](../docs/production-runbook.md).

### Applying without Docker or psql

`supabase db dump` and `supabase db start` need Docker; `supabase db query`
can't take a multi-statement file (it uses a prepared statement, which Postgres
refuses for multiple commands). Neither was available here, so the files were
applied over the direct IPv6 connection with `node-postgres`, which uses the
simple query protocol and accepts whole scripts including `DO` blocks:

```js
// scratch runner — node apply.mjs <file.sql>
import { readFileSync } from "node:fs";
import { Client } from "pg";
const client = new Client({
  connectionString: process.env.DB_URL,       // postgresql://postgres:<pwd>@db.<ref>.supabase.co:5432/postgres
  ssl: { rejectUnauthorized: false },
});
client.on("notice", (n) => console.log(n.message));  // migration assertions arrive as NOTICEs
await client.connect();
await client.query(readFileSync(process.argv[2], "utf8"));
await client.end();
```

The SQL Editor in the dashboard does all of this without the plumbing — prefer
it unless you're scripting.

**Do not use `supabase db push`.** 0001–0005 were applied by hand, so the CLI has
no `supabase_migrations.schema_migrations` history and would try to run 0001 —
which drops every table in `public`.

**A wrapping transaction won't make a dry run safe.** Each file ends with its own
`commit;`, so an outer `begin` is closed by the file itself and a following
`rollback` does nothing. To rehearse a migration, run it against a copy.

## Order

| # | File | What it does |
|---|---|---|
| 0001 | `0001_v3_schema.sql` | Base schema, RLS, storage buckets. **Destructive** — drops the prior schema. |
| 0002 | `0002_engagement_visibility.sql` | Lets target owners read follows/saves on their own things. |
| 0003 | `0003_activity_engagement.sql` | Reactions and comments on build posts. |
| 0004 | `0004_profile_headline.sql` | Headline column + seed template (no-ops on a fresh DB). |
| 0005 | `0005_notification_prefs.sql` | `profiles.notification_prefs`. |
| **0006** | `0006_security_hardening.sql` | **Closes the RLS holes.** Apply before exposing the app to anyone. |
| **0007** | `0007_commerce_lifecycle.sql` | Atomic purchase RPCs, payments table, order lifecycle, shipping. |
| **0008** | `0008_indexes_and_search.sql` | Hot-path indexes and trigram search. |
| **0009** | `0009_notifications.sql` | Notifications table and event triggers. |
| 0010 | `0010_listing_part_number.sql` | `listings.part_number`. |
| 0011 | `0011_listing_views.sql` | Listing view counts. |
| 0012 | `0012_commerce_hardening.sql` | Purchase RPC hardening (1-cent exploit, guards). |
| 0013 | `0013_scheduled_jobs.sql` | Scheduled cleanup jobs. |
| 0014 | `0014_disputes.sql` | Dispute lifecycle columns on orders. |
| 0015 | `0015_stripe_customers.sql` | `profiles.stripe_customer_id`. |
| 0016 | `0016_connect_accounts.sql` | Connect: `stripe_account_id`, `payouts_enabled`; transfer tracking on orders. |
| **0017** | `0017_lock_payment_columns.sql` | **Locks the payment columns on profiles** — column grants + trigger. Closes a live money-extraction path. |
| **0018** | `0018_admin.sql` | Admin substrate: `admin_users`, `is_admin()`, append-only `admin_audit_log`, `reports`, listing `removed` status, profile suspension. |
| **0019** | `0019_money_infra.sql` | Money infra: `webhook_events` dedup, `transfer_intents` (persist-before-Stripe + stuck-funds queue), `payment_recoveries`, refund-adjustment columns on orders. |
| **0020** | `0020_transfer_scheduling.sql` | Transfers move on delivery + 7-day hold: `mark_due_transfer_intents()` + pg_cron `drvn-transfer-worker` (pg_net → `/api/jobs/transfers` when `job_config` is set), stuck-funds backfill. |
| **0021** | `0021_dispute_sla.sql` | Dispute SLA: day-4 escalation notices (`escalate_stale_disputes()`, daily cron) + `dispute_escalated_at`; the day-10 auto-refund runs app-side in the worker pass. |
| **0022** | `0022_sla_alert_stamp.sql` | `orders.dispute_sla_alerted_at` — once-only marker for the ops webhook alert (`ADMIN_ALERT_WEBHOOK_URL`) on SLA breach, sent by the app worker pass. |
| **0023** | `0023_admin_roles_webhook_payloads.sql` | `admin_users.role` (admin/viewer) + `webhook_events.payload` retention for console inspection/replay. |
| **0024** | `0024_grading_dispute_process.sql` | Condition grades + checklists, immutable `order_items.condition_snapshot`, dispute evidence table + bucket, escalation/outcome columns. |
| **0025** | `0025_fitment.sql` | Structured fitment: `listing_fitments`, vPIC make/model cache, `cars` VIN columns. |
| **0026** | `0026_money_durability.sql` | **P0 money durability:** `refund_operations` state machine (`begin_refund_operation`/`settle_refund_operation`), transfer-intent leases + `claim_transfer_intents()` (FOR UPDATE SKIP LOCKED, stale-claim recovery), `admin_alert_outbox`. |
| **0027** | `0027_evidence_privacy.sql` | **P0: flips `dispute-evidence` from a public bucket to private** — drops the blanket public-read storage policy, adds a participant/uploader/admin-scoped one keyed on the new `dispute_evidence.storage_path` column (backfilled from the legacy `url`). App now renders short-lived signed URLs (`src/lib/evidence-urls.ts`) instead of the old public URL. |
| **0028** | `0028_shipping_address_region.sql` | `orders.ship_state` — shipping address state/province/region (required in checkout for US/CA/AU); `ship_country` moves to ISO codes going forward. |
| **0029** | `0029_staged_media.sql` | `staged_uploads` ledger for the photo-upload lifecycle + the abandoned-upload GC sweep. |
| **0030** | `0030_seller_listing_stats.sql` | `seller_listing_stats` / `seller_register_tally` RPCs — the ledger's page of rows and its chip counts, filtered/sorted/counted in SQL. |
| **0031** | `0031_conversations.sql` | Conversations + unread counters; `messages.listing_id` nullable. |
| **0032** | `0032_feed_events.sql` | `feed_events` union view. |
| **0033** | `0033_part_number_compact.sql` | Separator-insensitive part-number search (`listings.part_number_compact` generated column + index). |
| **0034** | `0034_order_origin_offer.sql` | `orders.origin_offer_id` — the canonical accepted-offer → order link, written inside `offer_accept_begin` and unique. Replaces the offer thread's "most recent matching order" guess. Backfilled only from the payments idempotency key; buy-now orders stay null. |
| **0035** | `0035_seller_open_questions.sql` | `seller_open_questions()` — buyer questions with no reply across the seller's whole catalog, for the listings summary. |
| **0036** | `0036_account_emails.sql` | `account_emails` — service-role-only email → account index for guest checkout (RLS on, no policies), kept in step with `auth.users` by trigger. |

On a fresh environment, apply **0001–0028 in order**; for the production path
(baselining, verification, Stripe live wiring, first admin) follow
[docs/production-runbook.md](../docs/production-runbook.md).

## Verifying the purchase guard

`supabase/tests/purchase_guard.sql` proves the property that matters: a listing
can be sold exactly once. It creates throwaway fixtures, runs nine assertions,
and **rolls everything back**, so it leaves no rows behind.

Run it in the SQL Editor against a non-production project. Success prints nine
`PASS` notices; any failure raises an exception naming what broke.

## Rollback notes

- 0006 only replaces policies and adds constraints/triggers. To undo, restore
  the policy definitions from 0001.
- 0007 is the one to be careful with: it drops `NOT NULL` on `orders.buyer_id`
  and `orders.seller_id` and repoints their foreign keys to `ON DELETE SET NULL`.
  Reversing that needs the label columns backfilled into real ids first, which
  isn't possible for deleted accounts — hence the backup in step 1.
- 0008 is indexes only; dropping them is safe.
- 0009 can be reversed by dropping the `notifications` table and its triggers;
  the app falls back to an empty list, not an error.

## Scheduled jobs worth adding

Two functions are written to be run on a schedule (Supabase cron or an external
scheduler). Neither is required for correctness, but both keep things tidy:

```sql
-- Frees listings held by abandoned checkouts. Every 5 minutes.
select public.release_expired_reservations();

-- Trims the rate-limiter table. Daily.
select public.prune_rate_limits();
```

Offer expiry is currently advisory: `offers.expires_at` is set and shown, and
`purchase_finalize` expires rival offers on a sale, but nothing sweeps lapsed
offers into `'expired'` on a timer. Add that alongside the above if you want the
status to be authoritative rather than presentational.

## Phase-two provider-aware expiry

`20260905101425_provider_aware_expiry.sql` was applied to isolated local Supabase and rebuilt from all migration files on CI's PostgreSQL image on September 5, 2026. It adds expiry queue support, a fenced service-only finalization RPC, creation/expiry serialization and expiry worker health. It reached the shared dev project on 2026-09-24 with the rest of the September 5–6 chain (see the top of this file); it has not been applied to any production project. The older scheduling notes above are historical: expiry cron now queues work and requires the compatible money worker to complete release; lapsed offers are swept by the function.

The September 5 phase-two sequence adds capture recovery/claims, lease renewal, consent outbox, serialized search/rebuilds, historical-media guards, deletion manifests/financial rechecks, admin operation/recovery fencing, uncapped search relations and explicit function search paths. Apply these additive files in filename order. Fresh migration, SQL-guard and generated-type verification is recorded in `docs/remediation-evidence/phase-two-completion/`. Never replay `0001_v3_schema.sql` on an existing deployment.
