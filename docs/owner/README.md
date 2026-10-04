# Owner actions before the invited live-money beta

Everything left that needs the owner: accounts, money, DNS, decisions and
sign-offs. The code work from rounds three and four is merged; what remains is
below, in the order to do it. Long-lead items come first so they run in
parallel with the setup.

**Who:** **Owner** = needs your accounts, payment, DNS or decision.
**Engineer** = can be done by an engineer once you've shared credentials
through the password manager (never chat, email or the repo). **Counsel** =
your lawyer.

Times are hands-on time, not waiting time.

| # | Action | Who | Time | Guide |
|---|---|---|---|---|
| 1 | **Plans and accounts.** Upgrade the Supabase organisation to a paid plan (backups and a free project slot); create the hosting account (Vercel assumed); upgrade GitHub to Pro or make the repo public; Sentry; an alert channel (Slack webhook). 2FA on all of them | Owner | 1 h | `docs/staging-setup.md` §0, §1.1 |
| 2 | **Start counsel.** Send `counsel-packet.md` and `retention-proposal.md`. This takes the longest, so start now | Owner → Counsel | 30 min to send; weeks to return | [counsel-packet.md](counsel-packet.md), [retention-proposal.md](retention-proposal.md), `docs/legal-review-checklist.md` |
| 3 | **Staging project.** Create `drvn-staging` in Supabase, apply the schema, set Auth URLs, create the hosting project, attach the domain, set environment variables | Owner creates; Engineer configures | 2–3 h | `docs/staging-setup.md` §1–4 |
| 4 | **Email provider.** Choose one, verify the sending domain (DKIM, return-path, DMARC), enter SMTP in Supabase, paste the four templates. DNS can take up to a day to verify | Owner (Engineer can drive) | 1–2 h | [email-provider.md](email-provider.md) |
| 4a | **Code fix for guest order emails.** `/confirm` must accept `type=email` so the guest link works with Confirm email on. Without it, step 4's guest test fails | Engineer | 30 min + tests | [email-provider.md §5](email-provider.md#known-gap-guest-order-links-with-confirm-email-on) |
| 5 | **Stripe, test mode.** Enable Connect (Express), fill in the platform profile and branding. Create both webhook endpoints with the script, put the two secrets in the hosting environment, redeploy, send a test event to each | Owner (account); Engineer can run the script | 45 min | `scripts/owner/stripe-webhooks.mjs` (below); `docs/staging-setup.md` §5 |
| 6 | **Rest of staging.** EasyPost test key and webhook (if shipping is on), Sentry DSN, alert webhook, `job_config` rows, first admin, beta gate on | Owner accounts; Engineer configures | 1–2 h | `docs/staging-setup.md` §6–9, §12, §2.5 |
| 7 | **Monitor secrets.** Repo variables `DRVN_MONITOR_ENABLED`, `DRVN_MONITOR_ORIGIN`, secret `DRVN_MONITOR_SECRET`; run the monitor once; prove a failure and a recovery alert arrive | Owner | 20 min + a day's wait for the daily jobs | `docs/staging-setup.md` §10 |
| 8 | **Branch protection.** Add repo secret `STRIPE_TEST_SECRET_KEY`, then apply the `protect-main` ruleset and verify it | Owner | 20 min | [branch-protection.md](branch-protection.md), `scripts/owner/branch-protection.sh` |
| 9 | **Rotate the seed password.** The old one is in git history. Do it before the repo is shared or made public | Owner or Engineer | 5 min | [seed-password.md](seed-password.md), `scripts/owner/rotate-seed-password.mjs` |
| 10 | **Two product decisions.** Both are built as settings in `public.settlement_settings`; you pick the values with one SQL statement each, after migrations `20261006100000` and `20261006100100` are applied. (a) How long to hold a seller's payout after delivery: default 7 days, recommended "window-based". (b) Auto-confirm untracked shipments after N days: off by default, recommended 21 days, but note the warning is in-app only. Ask counsel to read the resulting terms sentence before switching | Owner | 30 min | `docs/decisions/payout-hold.md`, `docs/decisions/untracked-auto-confirm.md` |
| 11 | **Wallet device check.** Register the staging domain for Apple Pay / Google Pay in Stripe, then buy on a real iPhone (Safari) and Android phone (Chrome) | Owner | 45 min | [wallet-device-check.md](wallet-device-check.md) |
| 12 | **Email test run** on staging: signup, reset, guest order link, email change, headers pass | Owner | 45 min | [email-provider.md §6](email-provider.md#6-test-checklist-staging-then-production) |
| 13 | **Release-candidate packet: the 15 gates.** Write the candidate config, build from a clean checkout, produce one report per gate (purchase, refund, dispute and payout on staging; invitation boundaries; export and deletion; accessibility; operations; hosted restore and rollback; soak), run `verify`, and read every evidence file | Engineer builds; Owner reviews and signs | Engineer 1–2 days; Owner 2 h; soak as agreed | `docs/staging-setup.md` §13, `scripts/release-candidate.mjs` |
| 14 | **Counsel sign-off and retention approval.** Answer the questions in the packet; approve the retention schedule; the engineer then updates `/terms` and `/privacy` (entity, law, processors named, retention periods, backup period, `UPDATED` date) | Owner + Counsel; Engineer edits | depends on counsel | [counsel-packet.md §12](counsel-packet.md#12-questions-for-counsel), [retention-proposal.md §7](retention-proposal.md#7-sign-off) |
| 15 | **Production.** New Supabase project, schema, Auth, email (same provider, production domain), hosting env with **live** Stripe keys, both webhooks with `--live`, Connect live settings, wallet domain registered in live mode, EasyPost marketplace question settled, monitor pointed at production. Then exercise one live purchase, refund, dispute and payout with a real card before inviting anyone | Owner + Engineer | half a day | `docs/production-runbook.md` §1–10, §7 checklist |

## The two scripts that touch outside services

Both are dry runs unless you pass `--apply`. Neither prints a key. Run them
yourself from the repo root; nobody else needs the keys in chat.

**Stripe webhooks** (step 5, and again in step 15):

```bash
export STRIPE_SECRET_KEY=sk_test_...      # from the password manager, this shell only
node scripts/owner/stripe-webhooks.mjs --origin https://staging.<domain>          # dry run
node scripts/owner/stripe-webhooks.mjs --origin https://staging.<domain> --apply  # creates both
# production, later:
STRIPE_SECRET_KEY=sk_live_... node scripts/owner/stripe-webhooks.mjs --origin https://<domain> --live --apply
```

It creates the platform endpoint (the ten events the app handles) and the
Connect endpoint (`account.updated` on connected accounts), and prints the two
signing secrets for `STRIPE_WEBHOOK_SECRET` and
`STRIPE_CONNECT_WEBHOOK_SECRET`. Re-running updates them in place. If you made
endpoints by hand in the Dashboard first, it stops and tells you how to adopt
them. It refuses a live key without `--live`.

**Seed password** (step 9): see [seed-password.md](seed-password.md).

## Already done in code (no owner action)

Round three and four records list what changed:
`docs/plans/2026-10-release-r3-record.md`,
`docs/plans/2026-10-release-r4-record.md`. Remaining code items (carry-forward
payout of a positive balance, export of the carry ledger and message photos,
design-system debt) are for engineers and don't block the owner steps above.
