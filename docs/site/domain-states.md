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
| `active` | `reserved` · `paused` · `archived` · `removed` |
| `reserved` | `active` · `sold` |
| `paused` | `active` · `archived` · `removed` |
| `sold` | **terminal** |
| `archived` | `active` |
| `removed` | `paused` |

### Offers

Enforced by: CHECK + guard_offer_columns trigger (0007/0012)

| From | May move to |
| --- | --- |
| `open` | `countered` · `accepted` · `declined` · `withdrawn` · `expired` |
| `countered` | `accepted` · `declined` · `withdrawn` · `expired` |
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

<!-- END GENERATED: domain-states -->
