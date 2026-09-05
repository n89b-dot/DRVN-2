# Release gates after phase-two implementation

The repository implementation and local evidence do not authorize a live-money release. Complete these concrete gates on one final candidate before enabling production payments or claiming full production readiness.

| Gate | What is needed |
|---|---|
| Hosted staging | The selected organization is n89b-dot’s Org. Its free active-project slots are occupied; resolve capacity without pausing unrelated projects, then provision a separate project and canonical HTTPS app origin. Never use `drvn-v3` as a destructive fixture target |
| Real delivery and alerts | Configure controlled external SMTP inboxes, error reporting and an independent notification destination; prove rejection, delay, worker outage and recovery notifications |
| Stripe browser and Connect | Test HTTPS Payment Element/3DS success, failure and cancellation, connected seller payouts, post-transfer refunds and provider-originated disputes; reconcile balances and operation identities |
| Retention and deletion | Approve financial/evidence/audit/customer/backup retention and handling of immutable identity references. Validate all required subject-access sections and eligible Stripe Customer cleanup |
| Historical originals | Review the generated inventory, complete normalization batches and reconcile retained/failed objects. Approve original removal and the provider's CDN invalidation procedure |
| Populated search projection | Run the implemented inventory/reconciliation commands and verify queue delivery before enabling the optional engine on an existing catalog |
| Accessibility | Automated axe/keyboard coverage is not a manual screen-reader sign-off. Record critical and nested modal results with the agreed assistive technologies |
| Recovery and capacity | Agree representative traffic, latency/error budgets and RPO/RTO; perform coordinated hosted database/object restore, reconcile Stripe before workers restart, and prove actual scheduled cycles including daily jobs |
| Hosted release checks | Run mandatory GitHub checks on the candidate, retain sanitized evidence and configure the required branch/release checks after they pass. GitHub returned HTTP 403 on 2026-09-05: this private repository requires GitHub Pro for branch protection; keep the repository private and upgrade the account to enforce these checks |

Until those gates are complete, product analytics and optional external search should remain disabled in the release environment. Retain schema-compatible rollback builds and preserve the durable record of external financial effects during rollback.
