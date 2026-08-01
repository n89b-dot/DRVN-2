# Applying migrations

Run these in the **Supabase SQL Editor**, in order. Each is wrapped in a
transaction and written to be idempotent — re-running one is safe. (0007 and
0009 were *not* re-runnable on first write: they created policies without a
preceding `drop policy if exists`, and `purchase_begin` left its temp table
behind if called twice in one transaction. Both fixed — verified by applying each
file twice.)

## Status: 0006–0019 applied

0006–0009 on 26 July 2026; 0010–0015 during the Rev C/D sessions; 0016 on
31 July 2026. 0014–0016 columns verified live column-by-column on 31 July 2026.
0017 on 1 August 2026 (Rev E session, exploit reproduced then re-verified
blocked). 0018 on 1 August 2026 — applied twice (idempotency check) and
verified live by impersonation: all 23 assertions in
`supabase/tests/admin_guard.sql` pass, rolled back. 0019 on 1 August 2026,
applied twice (idempotency check), self-checks pass.

Applied to project `grunnjojhdevhuckujmc` (`drvn-v3`) and verified:
`supabase/tests/purchase_guard.sql` passes all nine assertions, and the
notification triggers raise into the correct sections. The commands below are
the record of how, and what to do for the next environment.

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

0006–0009 are new. **The app expects them**: pages that read `shipping_cents`,
`notifications`, or call `purchase_begin` will degrade to an empty state and log
an error until they're applied. That degradation is deliberate — nothing crashes
— but the product isn't correct until they're in.

## Suggested sequence

1. Take a snapshot / point-in-time backup first. 0007 alters `orders`
   constraints and nullability.
2. Paste and run **0006**, then **0007**, then **0008**, then **0009**, checking
   each returns without error before moving on.
3. Verify with `tests/purchase_guard.sql` (below).
4. Rotate the service-role key and DB password if you haven't already — the key
   in `.env.local` predates this work.

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
