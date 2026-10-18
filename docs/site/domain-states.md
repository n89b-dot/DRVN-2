# Domain states & transitions

> The one readable answer to "which states can reach which states"
> (brief §AG). PostgreSQL remains the enforcement — CHECK constraints,
> column-guard triggers and the money RPCs; these maps document it and are
> tested for internal consistency (`src/lib/domain/states.test.ts`).
> A transition missing here that the database allows is a documentation bug;
> one listed here that the database refuses is a modelling bug.

<!-- BEGIN GENERATED: domain-states (npm run docs:systems) -->

Source of truth: `src/lib/domain/states.ts` (PostgreSQL remains the enforcement — these maps document it).

### Modification lines

Enforced by: CHECK constraints mod_items_status_check + mod_items_removed_at_agrees_check (20260919170000); removed_at derived by save_mod_items

| From | May move to |
| --- | --- |
| `installed` | `removed` |
| `removed` | `installed` |

### Orders

Enforced by: CHECK constraint (0007) + purchase RPCs + dispute paths (0014/0021)

| From | May move to |
| --- | --- |
| `pending` | `requires_action` · `paid` · `payment_failed` · `cancelled` |
| `requires_action` | `paid` · `payment_failed` · `cancelled` |
| `payment_failed` | `cancelled` |
| `paid` | `shipped` · `cancelled` · `refunded` · `disputed` |
| `shipped` | `delivered` · `disputed` · `refunded` |
| `delivered` | `completed` · `disputed` · `refunded` |
| `completed` | `disputed` · `refunded` |
| `disputed` | `shipped` · `delivered` · `completed` · `refunded` |
| `cancelled` | **terminal** |
| `refunded` | **terminal** |

### Listings

Enforced by: CHECK (0001/0007) + guard_listing_status trigger (0012) + moderation (0018)

| From | May move to |
| --- | --- |
| `draft` | `active` · `archived` |
| `active` | `reserved` · `paused` · `sold` · `archived` · `removed` |
| `reserved` | `active` · `sold` |
| `paused` | `active` · `sold` · `archived` · `removed` |
| `sold` | **terminal** |
| `archived` | `active` |
| `removed` | `paused` |

### Offers

Enforced by: CHECK + guard_offer_columns trigger (0007/0012)

| From | May move to |
| --- | --- |
| `open` | `countered` · `accepted` · `declined` · `withdrawn` · `expired` |
| `countered` | `open` · `accepted` · `declined` · `withdrawn` · `expired` |
| `accepted` | **terminal** |
| `declined` | **terminal** |
| `withdrawn` | **terminal** |
| `expired` | **terminal** |

### Transfer intents

Enforced by: claim_transfer_intents + worker (0020/0026)

| From | May move to |
| --- | --- |
| `holding` | `ready` · `blocked_unpayable` · `cancelled` |
| `ready` | `processing` · `blocked_unpayable` · `cancelled` |
| `processing` | `transferred` · `ready` · `failed` · `blocked_unpayable` |
| `blocked_unpayable` | `ready` · `cancelled` |
| `failed` | `ready` · `cancelled` |
| `transferred` | **terminal** |
| `cancelled` | **terminal** |

### Refund operations

Enforced by: begin/settle_refund_operation RPCs + worker resume (0026)

| From | May move to |
| --- | --- |
| `requested` | `provider_pending` · `failed` |
| `provider_pending` | `provider_succeeded` · `failed` · `recovery_required` |
| `provider_succeeded` | `effects_pending` · `recovery_required` |
| `effects_pending` | `reversal_pending` · `completed` · `recovery_required` |
| `reversal_pending` | `completed` · `recovery_required` |
| `completed` | **terminal** |
| `failed` | **terminal** |
| `recovery_required` | **terminal** |

### Shipments

Enforced by: CHECK + guard_shipment_status trigger (0052)

| From | May move to |
| --- | --- |
| `pending` | `label_purchased` · `in_transit` · `cancelled` · `failed` |
| `label_purchased` | `in_transit` · `out_for_delivery` · `delivered` · `returned_to_sender` · `cancelled` · `failed` |
| `in_transit` | `out_for_delivery` · `delivered` · `returned_to_sender` · `failed` |
| `out_for_delivery` | `delivered` · `in_transit` · `returned_to_sender` · `failed` |
| `returned_to_sender` | `in_transit` |
| `delivered` | **terminal** |
| `cancelled` | **terminal** |
| `failed` | **terminal** |

### Returns (RMA)

Enforced by: CHECK + guard_return_status trigger (0055)

| From | May move to |
| --- | --- |
| `requested` | `approved` · `rejected` · `cancelled` · `escalated` |
| `approved` | `awaiting_shipment` · `expired` · `cancelled` · `escalated` |
| `awaiting_shipment` | `in_transit` · `expired` · `cancelled` · `escalated` |
| `in_transit` | `delivered` · `escalated` |
| `delivered` | `received` · `escalated` |
| `received` | `completed` · `escalated` |
| `escalated` | `received` · `completed` · `rejected` · `cancelled` |
| `completed` | **terminal** |
| `rejected` | **terminal** |
| `expired` | **terminal** |
| `cancelled` | **terminal** |

### Listing imports

Enforced by: CHECK + guard_listing_import_status trigger (0047)

| From | May move to |
| --- | --- |
| `pending` | `fetching` · `extracting` · `failed` · `expired` |
| `fetching` | `extracting` · `failed` · `expired` |
| `extracting` | `importing_media` · `ready` · `failed` · `expired` |
| `importing_media` | `ready` · `failed` · `expired` |
| `ready` | `consumed` · `extracting` · `expired` |
| `failed` | `fetching` · `extracting` · `expired` |
| `consumed` | **terminal** |
| `expired` | **terminal** |

### Agent tasks

Enforced by: CHECK + guard_agent_task_status trigger (20261021100000); agent_* functions and the offer_rounds outbox trigger (20261021100100)

| From | May move to |
| --- | --- |
| `working` | `waiting_for_event` · `needs_approval` · `completed` · `failed` · `cancelled` |
| `waiting_for_event` | `working` · `needs_approval` · `completed` · `failed` · `cancelled` |
| `needs_approval` | `working` · `waiting_for_event` · `completed` · `failed` · `cancelled` |
| `completed` | **terminal** |
| `failed` | **terminal** |
| `cancelled` | **terminal** |

### Agent mandates

Enforced by: CHECK + guard_agent_mandate_status trigger (20261021100000); agent_mandate_set_status (20261021100100)

| From | May move to |
| --- | --- |
| `active` | `paused` · `revoked` · `ended` |
| `paused` | `active` · `revoked` · `ended` |
| `revoked` | **terminal** |
| `ended` | **terminal** |

### Agent jobs (outbox)

Enforced by: CHECK (20261021100000); agent_claim_jobs / agent_finish_job / agent_reconcile_outbox (20261021100100)

| From | May move to |
| --- | --- |
| `pending` | `leased` · `cancelled` |
| `leased` | `pending` · `done` · `failed` · `cancelled` · `dead` |
| `done` | **terminal** |
| `failed` | **terminal** |
| `cancelled` | **terminal** |
| `dead` | **terminal** |

<!-- END GENERATED: domain-states -->

## What the maps don't show

- **Who may take a transition.** Offers (negotiation v2, `20261017160000`):
  `open` is the seller's turn and `countered` the buyer's, and turns strictly
  alternate. The seller accepts, counters (above the buyer's amount, within
  the asking price, at or above their minimum) or passes; the buyer accepts the
  counter, counters back (above their last amount, below the counter; this is
  `countered → open`) or withdraws. A buyer has 3 offers per part, counter-backs
  and below-minimum attempts included, across every thread, and at most one
  live offer at a time. Every move goes through `offer_open` / `offer_move`,
  which check turn, round, bounds and limits in one transaction and record the
  move in `offer_rounds`; see `docs/decisions/negotiation-v2.md`.
- **Reserved is visible.** A `reserved` listing — held by a checkout
  (15 min) or an accepted offer (24 h) — is publicly readable with its
  photos, fitment, part numbers and Q&A (`20260928150000`), and the listing
  page shows it as **Reserved** with a line explaining the hold. Browse,
  feed, store and search queries still show `active` parts only.
