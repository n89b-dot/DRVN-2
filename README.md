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
  soon after delivery (`settlement_settings`; `docs/decisions/payout-hold.md`),
  refunds via a durable state machine. Separate
  charges and transfers; the platform account is merchant of record.
- **Design system** — "Livesheet" (`docs/livesheet-inventory.md`; the
  stylesheet is split by recipe family in `src/app/styles/`, tokens in
  `00-tokens-base.css`, imported in order by `src/app/globals.css`;
  primitives in `src/components/ui/`). Internal design microsite at `/docs`
  (admin-gated, same MFA as `/admin`).

### Money model (the part worth understanding first)

- Checkout: `purchase_begin` reserves listings and creates pending orders;
  the browser confirms the PaymentIntent; the webhook settles
  (`purchase_finalize`) and records a `transfer_intents` row per order.
  No money moves to sellers at payment time.
- Transfers: pg_cron marks intents ready once their release time
  (`payout_release_at`, 20261009100000) has passed (0020); the transfer worker claims bounded, **leased** batches
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
| `SENTRY_DSN` | Error reporting. Live-money production: required, `https:` DSN |
| `ADMIN_ALERT_WEBHOOK_URL` | Operator alert destination. Live-money production: required, `https:`; elsewhere unset = alerts recorded as `disabled`, visible in admin |
| `CRON_SECRET` | Bearer for every `/api/jobs/*` route and `/api/health/workers`. Live-money production: required, ≥ 32 characters |
| `GUEST_RECEIPT_SECRET` | Signs guest checkout cookies and keys guest abuse limits. Live-money production: required, ≥ 32 characters (any production build throws without it on first use) |
| `TRUST_PROXY_HEADERS` | `true` only behind a proxy that overwrites `X-Forwarded-For`; otherwise all signed-out visitors share one rate-limit bucket |
| `SUPABASE_DB_PASSWORD` | Direct-connection migrations (`scripts/apply-migration.mjs`, see `supabase/MIGRATIONS.md`) |

**Production cannot silently run fake payments**: a missing Stripe key in
production fails the boot (`src/instrumentation.ts` → `validatePaymentsEnv`),
and so does live-money production missing any of the values above or
`NEXT_PUBLIC_SITE_URL` as an `https:` origin. The full table, with what each
check enforces, is §4 of `docs/production-runbook.md`.

## Database & migrations

Migrations live in `supabase/migrations/` (`0001`–`0057`, then timestamped
files), applied **in order** with `node scripts/apply-migration.mjs --target
<name> <file>` (a dry run that prints a confirmation code, then the same with
`--apply --confirm <code>`) or the SQL editor — never `supabase db push` on the
dev project (its CLI history is incomplete; it would run the destructive
0001). The runner records each file it applies in the CLI history and refuses
0001 on a populated database. Full procedure, order table, and per-migration
record: `supabase/MIGRATIONS.md`. Each file carries self-checks that raise on
failure; not every file is safe to apply twice, so the runner skips recorded
ones.

## Stripe setup

1. Test-mode keys in `.env.local`; webhook endpoint `/api/stripe/webhook`
   subscribing to `payment_intent.succeeded`, `payment_intent.payment_failed`,
   `payment_intent.requires_action`, `charge.refunded`, `refund.created`,
   `refund.updated`, `refund.failed`, `charge.dispute.created`,
   `charge.dispute.closed`, `account.updated` (the cases in
   `dispatchStripeEvent`, `src/lib/payments/settlement.ts`).
2. Connect (Express) for sellers — onboarding from Selling → Payouts
   (`/payouts`; Settings → Payments links there); `payouts_enabled` syncs via
   `account.updated`.
3. Point the scheduler at the app: the migrations create nine pg_cron jobs;
   the HTTP ones reach `/api/jobs/*` once `job_config` holds the worker URL
   and `CRON_SECRET` (`docs/production-runbook.md` §4). Admin → Payments →
   "Run worker now" runs the money pass by hand.

## Storage

Public buckets for car/listing media; **`dispute-evidence` is private**
(0027) — participants/admins only, served via short-TTL signed URLs
(`src/lib/evidence-urls.ts`).

## Testing

| Command | What |
|---|---|
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run test` | Vitest unit tests (fees, refund shares, payment modes, addresses, evidence URLs…) |
| SQL guards | every `supabase/tests/*_guard.sql` (`bash scripts/test-sql-guards.sh` against a disposable database) — each prints an "all … checks passed" line and rolls back |
| `npm run test:e2e` | The full Playwright suite against an isolated local Supabase stack — see `e2e/README.md` |

CI (`.github/workflows/ci.yml`), as of 1 October 2026: `verify` (production
dependency advisories, typecheck, lint, unit, monitor contract, build),
`secrets` (gitleaks over this event's own commits only — a PR's first-parent,
non-merge commits, or a push's), `secrets-full` (gitleaks 8.24.3, checksum-
verified, over every reachable commit including merges plus the tracked tree
at HEAD; redacted reports and a scope record uploaded), `sql-guard` (every guard file,
then generated-schema parity), `e2e` (the full browser suite on a local
`supabase start` stack with Realtime) and `stripe-integration` (test mode).
`release-gate` fails unless all of them ran and passed; nothing self-skips.
A green release gate is CI evidence for one commit — the hosted gates in
`scripts/release-candidate.mjs` still need their own evidence.

## Admin access

Insert into `admin_users` via SQL/service role only (`role`: `admin` or
read-only `viewer`) — never a flag on `profiles`. `/admin` and `/docs` 404 for
everyone else. Members also need MFA: AAL2 with a TOTP check in the last 15
minutes, enrolled and challenged at `/admin-verify` (`src/lib/admin/guard.ts`).
Every admin action lands in the append-only `admin_audit_log`.

## Deployment & operations

See `docs/production-runbook.md` — environment validation, webhook/Connect
setup, worker scheduling, reconciliation procedures, recovery queues, backup
and restore rehearsal, launch checklist. Remediation history and current
workstream status: `docs/remediation-status.md`.

## Known limitations

- Stripe integration runs in CI with a test-mode key (`STRIPE_TEST_SECRET_KEY`);
  hosted 3D Secure, Connect payouts and provider disputes are not yet proven
  in a browser.
- Admin `viewer` read-only enforcement is app-layer (admin actions use the
  service role, which RLS cannot distinguish) — documented, regression-tested
  at the TypeScript gate.
- Saved addresses, saved searches, and message attachments are deliberate
  later work; the underlying models are correct first.
