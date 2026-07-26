# Applying migrations

Run these in the **Supabase SQL Editor**, in order. Each is wrapped in a
transaction and written to be idempotent — re-running one is safe.

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
can be sold exactly once. It creates throwaway fixtures, runs five assertions,
and **rolls everything back**, so it leaves no rows behind.

Run it in the SQL Editor against a non-production project. Success prints five
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
