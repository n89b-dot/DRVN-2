# Launch configuration

The switch settings DRVN launches with. Recorded 2026-11-10 under plan 2 item A5 (`docs/plans/2026-11-architecture-remediation-plan.md`), approved by Neil with decision DA1 (the cart is not limited to one seller). Nothing is deleted to reach this configuration: every feature below that is off can be switched on later by setting a variable.

The same record as data is `docs/release-evidence/launch-configuration.json`. `tests/ci/launch-configuration.test.ts` holds the two together and hands the variables to the app's own code to prove what each setting resolves to. The launch-configuration browser lane (plan 2 item A4) builds its environment from that file.

## In plain words

| Part of the product | At launch | What that means for a member |
|---|---|---|
| Payments | Stripe | Real card payments. DRVN holds the money and pays each seller two days after delivery |
| DRVN Shipping (labels bought through DRVN) | **Off** | A seller sets a flat shipping price or offers pickup, and ships the part themselves. No labels are sold, so no label refunds and no label costs carried against later payouts |
| Carrier tracking | **Off** | A seller types in a tracking number; DRVN does not ask the carrier for updates. The buyer confirms delivery, or the order confirms itself after 21 days |
| The agent | **Off** | No member sees agent controls. Every task works without it |
| Importing a listing from a link | **Off** | It needs the same model key as the agent. A seller fills in the sell form by hand |
| Shared copy of public pages (the cache) | **On** | A signed-out visitor's pages are answered from a copy up to 60 seconds old (5 minutes for some content). A seller's change clears it |
| Search | Postgres | The database's own search. No separate search service |
| Analytics | **Off** | Nothing is sent to an analytics provider |
| Email | **No provider** | No transactional email is sent. Saved-search digests are recorded, not mailed |
| Returns and pickup codes | **On** | These have no switch. See "What this configuration does not switch off" |

## The variables

`absent` means the variable is not set on the host at all. `present` means it is set, to a value this file does not hold.

| Variable | Setting | Why |
|---|---|---|
| `PAYMENTS_MODE` | absent | With a Stripe key present the app selects Stripe. The stub is refused in production |
| `STRIPE_SECRET_KEY` | present | The live key |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | present | The card form |
| `STRIPE_WEBHOOK_SECRET` | present | Stripe reports payments here; the app refuses to boot without it |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | present | Reports that a seller's payouts were switched on or off |
| `PAYMENTS_ALLOW_STUB_IN_PRODUCTION` | absent | A hosted deployment refuses to boot with it set (N540) |
| `FLAG_INTEGRATED_SHIPPING_V1` | absent | **The DRVN Shipping switch.** Anything but `true` is off |
| `SHIPPING_MODE` | absent | Only chooses a provider once the flag is on |
| `EASYPOST_API_KEY` | absent | With a key, tracking numbers are sent to EasyPost even while DRVN Shipping is off. Absent, they are not |
| `EASYPOST_WEBHOOK_SECRET` | absent | No EasyPost account, so nothing calls the webhook |
| `SHIPPING_ALLOW_STUB_IN_PRODUCTION` | absent | Sandbox only (N540) |
| `AGENTS_BETA` | absent | **The agent switch.** Anything but `on` is off |
| `AGENT_AI_MODE` | absent | |
| `AGENT_WORKER_DATABASE_URL` | absent | The agent's worker does not run without it |
| `ANTHROPIC_API_KEY` | absent | One key serves the agent and the listing importer; without it both report that they are off |
| `LISTING_IMPORT_AI_MODE` | absent | |
| `LISTING_IMPORT_ALLOW_STUB_IN_PRODUCTION` | absent | Sandbox only |
| `DRVN_PUBLIC_CACHE` | absent | The cache is on unless this says `off` |
| `TYPESENSE_URL` | absent | No search provider |
| `TYPESENSE_API_KEY` | absent | |
| `POSTHOG_KEY` | absent | No analytics provider |
| `EMAIL_PROVIDER` | absent | No email provider is chosen (OS id R-email) |

## What the app's own code makes of them

Each line is asserted by `tests/ci/launch-configuration.test.ts`, which calls the function named.

- `payments`: stripe (`resolvePaymentsMode`, `src/lib/env.ts`)
- `drvnShipping`: disabled (`resolveShippingMode`, `src/lib/shipping/provider.ts`)
- `carrierTracking`: off (`resolveTrackingMode`, `src/lib/shipping/tracker-registration.ts`)
- `agent`: off (`agentsBetaOn`, `src/lib/agent/beta.ts`, reads `AGENTS_BETA`)
- `agentModel`: disabled (`resolveAiConfig`, `src/lib/ai/config.ts`)
- `listingImporter`: disabled (`resolveImportConfig`, `src/lib/listing-import/config.ts`)
- `publicDataCache`: on (`publicCacheEnabled`, `src/lib/supabase/public-cache.ts`)
- `searchEngine`: postgres (`src/lib/search/typesense.ts` needs both Typesense variables)
- `analytics`: off (`src/lib/analytics.ts` needs `POSTHOG_KEY`)
- `email`: none (`emailTransport`, `src/lib/email/send.ts`)

The production start-up check (`validatePaymentsEnv`) accepts this configuration with no warning.

## Switches that are rows in the database

A new database built from the migrations starts with these. They are part of the launch configuration and the schema snapshot (plan 2 item A1) records them.

| Row | Starts as | Changed by |
|---|---|---|
| `agent_controls`, scope `all` | The master stop is set: no agent acts | `/admin/agent` |
| `agent_beta_steps` (seller, buyer, chat, jobs) | All four closed | `/admin/agent`. Ignored while `AGENTS_BETA` is not `on` |
| `agent_spend_limits` | 2.00 a member a day, 50.00 a day in all | `/admin/agent` |
| `settlement_settings` | Payout 2 days after delivery; an untracked order confirms itself after 21 days with 3 days' notice; receipt release after 3 days; card verification from 500.00 | `/admin` settings |
| `job_config.payments_mode` | No row, which means Stripe rules apply: a seller must be payable to publish | The row exists only on CI's stub stack |
| `job_config.media_storage_origin`, `transfer_worker_url`, `transfer_worker_secret` | No rows | The deploy step (runbook §4) |

## DRVN Shipping off: what stays asleep

The question plan 2 item A5 asks: with the flag absent, on a database that has never had DRVN Shipping on, can label buying, label refunds or cost carrying move money or call a provider? **No.** Each path was traced to the line that stops it. A path that still runs on a schedule but finds nothing to do is marked "runs, finds nothing".

| Feature | What starts it | What stops it with the flag absent |
|---|---|---|
| Buying an outbound label | The seller's "buy label" action | Refused on its first check (`src/features/commerce/fulfillment-actions.ts:138`). Behind that: it needs a DRVN Shipping shipment row, which only a shipping quote creates, and quoting is refused too (`src/features/commerce/shipping-quote-actions.ts:61`) |
| Offering DRVN Shipping on a listing | The sell and edit forms, and the importer | The option is not shown (`sell-form.tsx`), and the action refuses it (`src/app/(product)/sell/actions.ts:217`) |
| Label refunds (voids) | The seller's "void label" action; the `labelVoids` worker family every 10 minutes | The action needs a shipment with a provider id, which only a bought label has, and the provider call throws when disabled. The worker reads its queue first, finds no rows and returns before asking for a provider (`src/lib/shipping/outbound-label-void.ts:196`): **runs, finds nothing** |
| Return labels | The buyer's "get a return label" action | Refused on its first check (`src/features/commerce/return-actions.ts:137`) |
| Cost carrying | The `transfers` worker family every 10 minutes; a trigger on seller adjustments; refund settlement | Every carry entry comes from a seller adjustment or from a payout that went negative because of one. `seller_adjustments` accepts four kinds (`outbound_label`, `return_label`, `label_refund`, `insurance`) and the only code that inserts a row is the label functions, which are never reached. The worker asks for sellers with a positive carry balance and gets none, so it never calls Stripe (`src/lib/payments/carry-payout-worker.ts:66`): **runs, finds nothing** |
| Carrier tracking | Marking an order dispatched queues a tracker job | With no EasyPost key the job is claimed and settled as skipped (`src/lib/shipping/tracker-registration.ts:37`): **runs, does nothing** |

**Proof by running.** The launch-configuration browser lane (plan 2 item A4) completes a real purchase in this configuration and then asserts that `shipping_rate_quotes`, `seller_adjustments`, `seller_carry_entries` and `outbound_label_void_requests` are all empty.

### Three things to know

1. **The database does not itself refuse `shipping_mode = 'drvn'`.** The app refuses it, but a signed-in seller calling the database directly with their own key could set it on their own listing. Nothing can be bought that way (checkout needs a shipping quote, and quoting is refused) and offers on it are refused, so no money moves; the seller would have made their own listing unbuyable. Left as it is: closing it needs a migration and is not in this plan.
2. **An EasyPost key alone turns tracking on.** If `EASYPOST_API_KEY` is ever set while the flag is absent, tracking numbers sellers type in are sent to EasyPost. That is by design (runbook §10) and moves no money. It is why the key is recorded here as absent.
3. **Do not switch DRVN Shipping off again while label refunds are waiting.** If the flag is turned on, labels are refunded, and the flag is then turned off with rows still in `outbound_label_void_requests`, the `labelVoids` family fails on every pass until it is back on. Empty that queue first.

## What this configuration does not switch off

Plan 2 lists returns and pickup codes among the money code the first release does not strictly need. Neither has a switch, and none is added here.

- **Returns** (a buyer sends a part back under buyer protection, and is refunded when it arrives) run whatever the shipping setting. Only the return *label* is off; the buyer ships it tracked and enters the number.
- **Pickup codes** (a buyer collects in person and the seller redeems a code, which starts the payout clock) do not touch the shipping provider.

## What health checks at launch

`/api/health/workers` lists every scheduled job and worker family and judges whether each ran. Work whose provider this configuration leaves out is listed with `disabled: true` and not judged, so it cannot page anyone for a feature that is not there:

| Left out | Not judged | Comes back when |
|---|---|---|
| Search provider | the `search` family and its queue | `TYPESENSE_URL` and `TYPESENSE_API_KEY` are set |
| Analytics provider | the `analytics` family and its queue | `POSTHOG_KEY` is set |
| Email provider | the job `drvn-saved-search-digests` and its family `savedSearchDigests` | `EMAIL_PROVIDER` is set |

The independent monitor still requires all three to be present in the answer: a deployment cannot hide a job by dropping it.

## Changing a setting

Change the host's variable, then change both files here in the same pull request. The test fails if the two disagree, or if the app's code no longer resolves the record to what it says.
