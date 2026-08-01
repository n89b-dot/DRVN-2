# Production runbook

How to stand up (and stand back up) a production DRVN, separate from the dev
project `grunnjojhdevhuckujmc`. Written to be followed top to bottom the first
time, and section-by-section afterwards. Rev E items: production project,
baselined migration history, rehearsed restore.

## 1. Create the production Supabase project

1. New project in the Supabase dashboard (region close to the UK userbase).
   Never reuse the dev project: it holds test users, test orders, and a
   migration history that only exists in `supabase/MIGRATIONS.md`.
2. Record the project ref, DB password, publishable key, and secret key in the
   deployment platform's secret store — not in the repo, not in `.env.local`.
3. Auth settings: enable email confirmation (dev has it off for e2e), set the
   site URL to the production domain, add it to the redirect allowlist.

## 2. Apply the schema

On a **fresh** project the whole migration tree applies cleanly in order —
0001 is only destructive against an existing schema:

```bash
# from the repo root; DB_URL is the production connection string
for f in supabase/migrations/*.sql; do
  echo "== $f"
  node scripts/apply-migration.mjs "$f"   # or paste each into the SQL editor
done
```

(There is no `scripts/apply-migration.mjs` committed — use the node-postgres
runner documented in `supabase/MIGRATIONS.md`, or the SQL editor. CI proves
the tree applies cleanly to a blank Postgres on every push.)

Then verify, exactly as CI does:

- `supabase/tests/purchase_guard.sql` — all nine PASS notices
- `supabase/tests/admin_guard.sql` — "all admin-guard checks passed"

## 3. Baseline the migration history

So the Supabase CLI is usable against production from day one (unlike dev,
where 0001–0005 predate any recorded history and `supabase db push` would
re-run 0001):

```sql
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
insert into supabase_migrations.schema_migrations (version, name)
select
  split_part(f, '_', 1),
  f
from unnest(array[
  '0001_v3_schema', '0002_engagement_visibility', '0003_activity_engagement',
  '0004_profile_headline', '0005_notification_prefs', '0006_security_hardening',
  '0007_commerce_lifecycle', '0008_indexes_and_search', '0009_notifications',
  '0010_listing_part_number', '0011_listing_views', '0012_commerce_hardening',
  '0013_scheduled_jobs', '0014_disputes', '0015_stripe_customers',
  '0016_connect_accounts', '0017_lock_payment_columns', '0018_admin',
  '0019_money_infra', '0020_transfer_scheduling', '0021_dispute_sla'
]) as f
on conflict do nothing;
```

Keep this list in lockstep with `supabase/migrations/` whenever a new file
lands.

## 4. Wire the app

Environment (deployment platform):

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | production project |
| `SUPABASE_SECRET_KEY` | service role — server only |
| `STRIPE_SECRET_KEY` | `sk_live_…` flips `paymentsAreLive()`; the terms' test-mode clause must be removed at the same moment |
| `STRIPE_WEBHOOK_SECRET` | from the production webhook endpoint below |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | live publishable key |
| `CRON_SECRET` | random 32+ chars; gates `/api/jobs/transfers` |
| `SENTRY_DSN` | error alerting — settlement paths depend on it being real |
| `NEXT_PUBLIC_SITE_URL` | production origin |

Stripe (live mode):

1. Webhook endpoint → `https://<domain>/api/stripe/webhook`, events:
   `payment_intent.succeeded`, `payment_intent.payment_failed`,
   `payment_intent.requires_action`, `charge.refunded`,
   `charge.dispute.created`, `charge.dispute.closed`, `account.updated`.
2. Connect enabled, Express accounts, GB.

Scheduler → worker handoff (0020):

```sql
insert into public.job_config (key, value) values
  ('transfer_worker_url', 'https://<domain>/api/jobs/transfers'),
  ('transfer_worker_secret', '<CRON_SECRET value>')
on conflict (key) do update set value = excluded.value, updated_at = now();
```

Confirm the four cron jobs exist: `select jobname, schedule from cron.job;` →
`drvn-release-reservations`, `drvn-prune-rate-limits`,
`drvn-transfer-worker`, `drvn-dispute-sla`.

## 5. Seed the first admin

```sql
insert into public.admin_users (user_id, note)
values ('<auth.users id>', 'founder')
on conflict do nothing;
```

Membership is SQL-only by design (0018). Turn on MFA for that account in
Supabase Auth. The console is at `/admin`; it 404s for everyone else.

## 6. Backups, and the rehearsed restore

Supabase Pro runs daily backups plus PITR. **A backup that has never been
restored is a hope, not a plan** — rehearse quarterly:

1. Create a scratch Supabase project.
2. Restore the latest production backup into it (dashboard → Backups →
   Restore, or `pg_restore` from a downloaded dump).
3. Run both guard SQL suites against the restored copy.
4. Point a local app at the copy (`.env.local` overrides) and click through:
   sign-in, marketplace, an order detail, `/admin`.
5. Record the date and the wall-clock restore time below, then delete the
   scratch project.

| Date | Restored from | Time to usable | Notes |
|---|---|---|---|
| _none yet_ | | | first rehearsal pending |

## 7. Go-live checklist deltas

- [ ] Legal pages carry the real entity/jurisdiction/tax terms (being handled
      separately) and the test-mode clause is gone.
- [ ] CI is a required check (public repo or paid plan — branch protection).
- [ ] `job_config` points at the production worker URL.
- [ ] A dispute, a refund, and a payout have each been exercised once in live
      mode with a real card and a Connect test seller before public launch.
