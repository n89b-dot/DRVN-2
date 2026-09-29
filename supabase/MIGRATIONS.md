# Applying migrations

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
