# DRVN

The home for your car and its build — follow what others are building, and buy
or sell the parts that come off. One product with two front doors (Explore and
the Marketplace, both public) and the car in the middle: builders document
their cars (digital garages, build updates, modification histories), and parts
listed for sale carry the provenance of the car they came off — what the
vehicle was, how the part was used, what condition it is in, and what the
seller disclosed. **Provenance creates trust.**

The product distinguishes three kinds of claim everywhere it speaks:
*source-vehicle facts* (recorded from the car), *seller claims* (grades,
checklists, fitment statements — always labelled seller-stated), and *DRVN
inferences* (potential fitment matches — never presented as verified).

## Architecture

- **Next.js 16** (App Router) — route groups: `(product)` signed-in app,
  `(discover)` public marketplace/cars, `(admin)` ops console at `/admin`
  (404 to non-admins), `(legal)`, `(docs)` internal design docs, `(auth)`.
- **Supabase** — Postgres + RLS as the real security boundary (server actions
  are conveniences, the database enforces), Auth, Storage. Generated/hand-kept
  types in `src/lib/database.types.ts`.
- **Stripe** — PaymentIntents (one per basket), Connect transfers to sellers
  on delivery + 7-day hold, refunds via a durable state machine. Separate
  charges and transfers; the platform account is merchant of record.
- **Design system** — "Livesheet" (`docs/livesheet-inventory.md`, tokens in
  `src/app/globals.css`, primitives in `src/components/ui/`). Internal design
  microsite at `/docs` (admin-gated).

### Money model (the part worth understanding first)

- Checkout: `purchase_begin` reserves listings and creates pending orders;
  the browser confirms the PaymentIntent; the webhook settles
  (`purchase_finalize`) and records a `transfer_intents` row per order.
  No money moves to sellers at payment time.
- Transfers: pg_cron marks intents ready after delivery + clearing window
  (0020); the transfer worker claims bounded, **leased** batches
  (`claim_transfer_intents`, FOR UPDATE SKIP LOCKED, stale-claim recovery)
  and creates Stripe transfers with reconcile-before-create (0026).
- Refunds: every refund is a `refund_operations` state machine row
  (requested → provider_pending → provider_succeeded → effects_pending →
  reversal_pending → completed / failed / recovery_required). Reservations
  are row-locked; effects apply in one SQL transaction
  (`settle_refund_operation`); seller transfers are reversed proportionally;
  crashes are resumed by `resumeIncompleteRefunds` on the worker pass.
- Anything needing a human lands in `payment_recoveries` (admin console
  works the queue); operator alerts are durable `admin_alert_outbox` rows
  with retries — never fire-and-forget.

## Local setup

```bash
npm ci
cp .env.example .env.local
npm run dev                  # http://localhost:3000
```

### Environment variables

Required (validated in `src/lib/env.ts`, fail-fast):

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | Browser-safe key |
| `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`) | Server-only; bypasses RLS |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin |

Payments (fail-closed — see `resolvePaymentsMode`):

| Variable | Purpose |
|---|---|
| `PAYMENTS_MODE` | `stripe` or `stub` (optional; inferred from the secret when unset) |
| `STRIPE_SECRET_KEY` | Selects/powers the Stripe provider |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification (required in live production) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe Elements (required in live production) |
| `PAYMENTS_ALLOW_STUB_IN_PRODUCTION` | Explicit sandbox-only override; without it production refuses stub mode |

Ops:

| Variable | Purpose |
|---|---|
| `SENTRY_DSN` | Error reporting (required in live-money production) |
| `ADMIN_ALERT_WEBHOOK_URL` | Operator alert destination (unset = alerts recorded as `disabled`, visible in admin) |
| `CRON_SECRET` | Bearer token for `/api/jobs/transfers` |
| `SUPABASE_DB_PASSWORD` | Direct-connection migrations (see `supabase/MIGRATIONS.md`) |

**Production cannot silently run fake payments**: a missing Stripe key in
production fails the boot (`src/instrumentation.ts` → `validatePaymentsEnv`).

## Database & migrations

Migrations live in `supabase/migrations/` (0001–0028), applied **in order**
over a direct pg connection or the SQL editor — never `supabase db push`
(no CLI history exists; it would run the destructive 0001). Full procedure,
order table, and per-migration record: `supabase/MIGRATIONS.md`. Each file is
idempotent with self-checks that raise on failure.

## Stripe setup

1. Test-mode keys in `.env.local`; webhook endpoint `/api/stripe/webhook`
   subscribing to `payment_intent.succeeded`, `payment_intent.payment_failed`,
   `payment_intent.requires_action`, `charge.refunded`,
   `charge.dispute.created`, `charge.dispute.closed`, `account.updated`.
2. Connect (Express) for sellers — onboarding from Settings → Payments;
   `payouts_enabled` syncs via `account.updated`.
3. Schedule the worker: POST `/api/jobs/transfers` with `Authorization:
   Bearer $CRON_SECRET` every ~10 min (pg_cron + pg_net wiring in
   `supabase/MIGRATIONS.md`), or run it from Admin → Payments.

## Storage

Public buckets for car/listing media; **`dispute-evidence` is private**
(0027) — participants/admins only, served via short-TTL signed URLs
(`src/lib/evidence-urls.ts`).

## Testing

| Command | What |
|---|---|
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run test` | Vitest unit tests (fees, refund shares, payment modes, addresses, evidence URLs…) |
| SQL guards | `supabase/tests/{purchase,admin,security,money}_guard.sql` — run in CI against a fresh schema; each prints an "all … checks passed" line and rolls back |
| `npm run test:e2e` | Playwright golden path (needs a **non-production** Supabase project — see `e2e/README.md`) |

CI (`.github/workflows/ci.yml`): typecheck, lint, unit, build, then the four
SQL guards on `supabase/postgres`. Secret-backed suites (Stripe integration,
full E2E) do not run in CI — treat a green build accordingly.

## Admin access

Insert into `admin_users` via SQL/service role only (`role`: `admin` or
read-only `viewer`) — never a flag on `profiles`. `/admin` 404s for everyone
else. Every admin action lands in the append-only `admin_audit_log`.

## Deployment & operations

See `docs/production-runbook.md` — environment validation, webhook/Connect
setup, worker scheduling, reconciliation procedures, recovery queues, backup
and restore rehearsal, launch checklist. Remediation history and current
workstream status: `docs/remediation-status.md`.

## Known limitations

- Stripe integration tests require test-mode secrets and are not in CI.
- Admin `viewer` read-only enforcement is app-layer (admin actions use the
  service role, which RLS cannot distinguish) — documented, regression-tested
  at the TypeScript gate.
- Saved addresses, saved searches, and message attachments are deliberate
  later work; the underlying models are correct first.
