# Next-session brief — admin console + remaining Rev E work

> **SUPERSEDED — historical brief (early Aug 2026), archived 2026-10-11.** Everything in Tasks 1–2 has shipped; the admin console exists. The authoritative spec is now `docs/DRVN-PRD-2026-09.md` (the `DRVN-PRD-v3.1.md` named below is superseded). `supabase/migrations/` now holds 0001–0057 plus timestamped migrations (187 files on 2026-10-11, 130 of them timestamped from `20260905011618` on). The "keep CHANGELOG and docs in sync, per `AGENTS.md`" rule below no longer lives in `AGENTS.md` (which now only warns that this Next.js differs from training data); the CI migration guard it mentions still exists. Paths below are as they were then: the stylesheet has since moved from `globals.css` to `src/app/styles/`, the design contract from `docs/livesheet-inventory.md` to `design-mockups/livesheet/design.md`, and payout onboarding to `/payouts`.

Paste everything below the line into a new chat. It is written to be
self-contained: a fresh session has none of the prior conversation.

---

Work in `/Users/neilbarrow/Desktop/Cursor Projects/DRVN 2` — the **`DRVN 2`** folder, not
the dead v1 `DRVN` repo beside it. Read `AGENTS.md` and the root `README.md` first; the
authoritative spec is `docs/DRVN-PRD-v3.1.md`. This is Next.js 16 (App Router) +
Supabase, design system "Livesheet" (`docs/livesheet-inventory.md`, tokens in
`src/app/globals.css`).

The current state of the product is assessed in **Rev E** of the readiness report:
https://claude.ai/code/artifact/b80e4a8c-f4fa-4bd1-aab2-801a2c81056e — read it before
planning. A condensed version of what it says is below, but the artifact has the detail.

## Task 1 — build the admin console

DRVN has **no admin concept whatsoever** today. A buyer can open a dispute and a seller
can offer a refund, but if either party goes silent the order strands forever with the
money already transferred. There is no way to force a refund, take down a listing,
suspend a fraudulent seller, or intervene in anything. For a platform that handles other
people's money this is the top blocker.

**Architecture decision, already made — implement this, don't re-litigate it:**

A gated route group inside the existing app (an `(admin)` group alongside `(product)`,
served at `/admin`), using the same Supabase auth session — with the code structured so
it can later be lifted onto its own subdomain behind Cloudflare Access or an IP
allowlist without a rewrite. Keep admin data access and actions in modules that don't
assume they're colocated with the product app.

**Security requirements — these are not negotiable, and there is a hard-won reason:**

- **Do not put an admin flag on `profiles`.** In this codebase, `payouts_enabled` and
  `stripe_account_id` were columns on `profiles` and were **self-writable by any signed-in
  user** — the update policy was `USING/WITH CHECK (auth.uid() = id)` with no column
  predicate. That was a live, reproduced money-extraction path, fixed in migration
  `0017_lock_payment_columns.sql`. An `is_admin` boolean there would be the same bug with
  a worse blast radius.
- Use a separate `admin_users` table with **no client-writable RLS policy at all** — rows
  inserted only via SQL or the service role.
- Add a `public.is_admin()` SQL function (`stable security definer`) and use it **inside
  RLS policies**, e.g. `using (auth.uid() in (buyer_id, seller_id) or public.is_admin())`,
  so the database enforces access declaratively rather than depending on every server
  action remembering to check. Two separate classes of bug in this repo came from
  app-layer rules with no database twin.
- Return **404, not 403**, for non-admins, and keep `/admin` out of navigation.
  Authorization is the control; obscurity is not.
- **Append-only audit log** of every admin action: who, what, which order, why, when.
- Assume 2FA on admin accounts (Supabase supports it) — at minimum don't design anything
  that would prevent it.

**Scope:** build what a marketplace admin console of this kind is actually expected to
have, not a minimum stub. Use the **mobbin MCP** to pull real references for admin /
back-office / dispute-queue patterns before designing, so the layout follows established
conventions rather than being invented. The **higgsfield MCP** is available if you want
imagery for anything — optional, use your judgement.

Build it in Livesheet's visual language, reusing existing components. Note the design
contract detail: real tabs are fine — an earlier "too blocky" note referred only to
corner radius, not to tabs or segmented controls as a pattern.

**One connection worth understanding:** refunds must be driven through the app, not the
Stripe dashboard. A dashboard refund never reaches the database — the order stays `paid`,
the platform fee stays booked, and the seller's transfer is never reversed. The admin
console is the interface the refund work below needs, not a layer on top of it.

## Task 2 — work through the rest of Rev E

**Explicitly excluded: the legal pages** (entity, governing law, tax, the privacy
placeholder, the "test mode" clause). The user is handling those separately. Don't touch
them.

Everything else, roughly in this order:

**Money correctness (the two open criticals):**
1. **Refunds never reverse the seller's transfer.** Nothing calls `createReversal` or
   refunds with `reverse_transfer` anywhere. On a £1,000 refund the platform pays the
   buyer in full while the seller keeps ~£910. Fix on all three paths — the refund
   handler, the lost-dispute branch, and buyer-accepts. Treat a failed reversal as
   negative-balance recovery, not a log line. Reconcile `platform_fee_cents` too; it's
   frozen at checkout and never adjusted, so every figure after a refund is wrong.
2. **Transfers fire on `payment_intent.succeeded`, before anything ships**, while
   `ledger.ts` advertises a seven-day clearing window that is unreachable for real orders.
   Move the transfer to delivery + the hold window, driven by the existing pg_cron
   scheduler (see `0013_scheduled_jobs.sql`). This defuses most of item 1.

**Smaller money bugs, same area:**
3. Refund idempotency keys are per **payment-intent**, but one intent now covers a
   multi-seller basket — refunding the second order either silently no-ops or conflicts.
   Make them per-order.
4. Transfer idempotency keys expire at 24h while Stripe retries webhooks for 3 days, and
   the DB write recording the transfer is only *logged* on failure — so a late redelivery
   can transfer twice. Persist a transfer intent before calling Stripe.
5. Partial refunds are unattributable — anything that isn't a whole order is logged and
   ignored, leaving the order `paid` and allowing a second full refund.
6. No webhook `event.id` dedup table. No retry for sellers who sold *before* completing
   onboarding — those funds are skipped with an error log and never move. Build a
   stuck-funds queue.
7. Alerting on every `reportError` in `settlement.ts`; several of those lines currently
   represent money nobody will look for.

**Seller activation:**
8. `setListingStatus` returns `void` and every guard is a bare `return` — a seller without
   payout onboarding clicks **Publish** and nothing happens, with nothing said. Return a
   typed result and surface it with a link to onboarding. Five other void actions share
   the pattern.
9. Payout onboarding is buried in Settings → Payments; surface it where sellers are (the
   ledger, the KPI deck).

**Craft:**
10. Four modals still bypass the accessible `Dialog` primitive (offer, edit profile, add
    car, payment methods) — it has exactly one consumer. No dialog role, Escape, focus
    trap or scroll lock on any of the four.
11. ~110 `microlabel` spans are used as field labels with no association — including the
    offer amount input, which screen readers announce as "edit text, blank". The correct
    pattern already exists in `disputes.tsx`.

**Ops:**
12. Dispute SLA job — auto-escalate or auto-refund after N days of silence, so nothing
    strands. Add to the existing scheduler.
13. Moderation: report button, review queue, listing/seller takedown. The prohibited-items
    policy in the terms describes a capability that doesn't exist.
14. Bump Next to 16.2.12 (clears 3 high advisories, incl. `sharp` on the user-upload image
    path); add the e2e suite to CI.
15. Production Supabase project separate from `grunnjojhdevhuckujmc`; baseline
    `supabase_migrations.schema_migrations`; document and rehearse a restore.

**Deferred, mention but don't build unless there's time:** pre-purchase buyer↔seller
messaging, marketplace category metadata + OG image + `Product`/`Offer` structured data,
shop profiles, recommendations instrumentation, Stripe's own processing fees being
unmodelled (sub-£2 sales currently lose money — a pricing decision for the user).

## How to work in this repo

**Migrations are applied by hand.** There are 17, and migration state lives in
`supabase/MIGRATIONS.md`. **Never run `supabase db push`** — 0001–0005 were applied
manually so there is no `schema_migrations` history, and the CLI would re-run 0001, which
drops every table in `public`.

To apply one, use a `node-postgres` runner (`supabase db query` can't take multi-statement
files; `supabase db dump` needs Docker, which isn't installed). Build the connection from
`.env.local`:

```
postgresql://postgres:<url-encoded SUPABASE_DB_PASSWORD>@db.grunnjojhdevhuckujmc.supabase.co:5432/postgres
```

Never print secret values. Take a JSON backup of the affected tables before schema
changes.

**Verify security fixes by impersonating a real user, not by checking the migration ran.**
Inside a transaction: `set_config('role','authenticated',true)` plus
`set_config('request.jwt.claims', json_build_object('sub', <uuid>, 'role','authenticated')::text, true)`,
attempt the exploit, assert it fails, assert the legitimate path still works, then
`rollback`. Two bugs in this codebase were found exactly this way, including one in a
security fix that was declared `SECURITY DEFINER` and so treated every caller as trusted,
silently disabling itself.

Also note: a column-level `REVOKE` is inert while a table-wide `GRANT SELECT` stands — the
grant must be replaced with an explicit column list.

Run `npx tsc --noEmit`, `npm run lint`, `npm test` and `npm run build` before committing.
CI also applies all migrations to a real Postgres and asserts SQL invariants
(`.github/workflows/ci.yml`); extend that guard with any new invariant you introduce.

Commit with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Keep `CHANGELOG.md`
and the docs in sync, per `AGENTS.md`.

A dev server is kept running on **port 3005** by a launchd agent — use it rather than
starting another.

**Tooling note:** the Figma and Stripe MCP plugins require interactive OAuth and won't
authenticate in a non-interactive session. Mobbin and higgsfield are available.

Start by proposing a plan for the admin console — schema, gating, and the surfaces you
intend to build — before writing code.
