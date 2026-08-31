# Applying migrations

Run these in the **Supabase SQL Editor**, in order. Each is wrapped in a
transaction and written to be idempotent — re-running one is safe. (0007 and
0009 were *not* re-runnable on first write: they created policies without a
preceding `drop policy if exists`, and `purchase_begin` left its temp table
behind if called twice in one transaction. Both fixed — verified by applying each
file twice.)

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
