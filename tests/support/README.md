# Disposable fixture targets

Browser and Stripe integration fixtures must pass `assertIsolatedTestTarget`
before creating users, listings, orders, or other test records.

The local target is `http://127.0.0.1:54321` (or `localhost`) with project reference
`local-drvn-remediation`. This is the dedicated DRVN local Supabase stack.

Hosted fixture targets also require a reference in `approved-test-projects.json`.
The list is deliberately empty until a separate disposable staging project exists.
Matching an environment URL to an environment project reference is insufficient.

Before adding a hosted reference, record its organization, project name, region,
creation date, owner, and disposable-test purpose in the provisioning evidence.
Verify it is separate from every production or unrelated project, then review the
manifest change. Never add a production reference to make a test run pass.

The manifest is a test-harness guard, not a substitute for separate provider
credentials, synthetic data, access controls, or deployment environment checks.
