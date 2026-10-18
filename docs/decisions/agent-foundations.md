# Decision: the agent's foundations

**Status: decided 14–17 October 2026 (Neil)** in the agent plan
([`docs/plans/2026-10-agent-and-graph-plan.md`](../plans/2026-10-agent-and-graph-plan.md),
Claude Doc rev 88) and PRD §4.9. Written down in A0 so that A1 (negotiation v2),
A2 (agent foundation) and A3 (the agent) build to the same shapes. Change a rule
here only with a new ruling, and update the plan, the PRD and this file together.

## 1. Who the agent acts for: principal, scope, permissions

Every agent action carries one context:

| Part | What it is | Where it comes from |
|---|---|---|
| **Principal** | The member the agent acts for. Later an Admin or Analytics agent shares the runtime as a different principal | For a person: the session. For the agent: the leased job → its task → its mandate's owner |
| **Scope** | What the action is about: `seller`, `buyer`, `garage` (internal names; the member sees one agent, AG-1) | The task |
| **Permissions** | What this principal may do in this scope right now | The mandate (its version, limits, expiry and status), re-checked against live state, plus the admin kill switches (AG-12) |

The acting member is never a request argument and never comes from model
output. An offline agent has no member session, so its writes go through
`agent_*` database functions. Each one requires a claimed job with a valid
lease whose task and expected action match that exact call. Only then does it
load the owner from the task and mandate and re-check role, ownership, amount,
state and revocation. A mandate id on its own authorises nothing.

The worker connects as its own Postgres login role, `agent_worker`, through the
pooler. It may only execute `agent_*` functions: no table grants, and never the
service role (`createAdminClient()`).

## 2. Capabilities: how anything reaches the data

- Typed domain services live in `src/lib/capabilities/`. Each has a zod input
  and output, a risk level (R0 read … R4 money), and the member's RLS client.
- The agent never calls React Server Actions. A server action becomes a thin
  wrapper over the same core, so the person and the agent take one path.
- Reads are composable (search, car, product, fitment evidence, comparables) so
  a model can combine them. Reads that need the service role today, such as
  `recommendations.ts`, are not exposed as tools until they read as the member.
- Outside content (listing text, messages, pages) is wrapped as untrusted data,
  tools are allow-listed per scope, and structured output is validated.
  Retrieved text is never treated as permission.
- The UI calls capabilities directly. An MCP adapter (A6) wraps the same
  registry later.

## 3. Rules decide money; the model writes words

Prices come from `negotiate.ts`, a pure function of the owner's limits, the
listing and the offer history (AG-5). The model understands requests and
writes the explanation; it never chooses an amount. Approving a mandate
authorises bounded moves within it without asking each time (AG-6). There is
no auto-accept by sellers and no automatic payment at launch.

## 4. Lock order: listing → negotiation → order → payment

Every path that touches a listing's sale takes its locks in that order. Today
they don't all agree. Audited 17 October 2026 from the live definitions:

| Function | Order today |
|---|---|
| `offer_accept_begin` | **offer** (`for update`) → listing (reserving update) → creates order, order items, payment |
| `freeze_accepted_offer_checkout` | **order** (`for update`) → offer + listing together (`for update of ofr, l`) → order, items, payment updates |
| `settle_seller_cancellation` | **order** → listings (by id) → payment |
| `bind_cart_checkout_payment` | purchase attempt → orders (by id) → payments (by order id) |
| `freeze_cart_checkout_shipping` | purchase attempt → order → … |
| `finish_reservation_expiry` | job → order → payment (read) |

Acceptance is offer-first; checkout freeze and seller cancellation are
order-first. No deadlock has been seen, and the two meet only when one
offer's order is being frozen while another offer on the same listing is
accepted. A1 brings every path onto the one order: `offer_move` owns
acceptance and locks the listing first, and the freeze and cancellation
functions are restated to lock the listing before the order. A1's
concurrency tests (buyer accepts vs seller cancels, two counters at once,
acceptance vs another buyer's checkout) are the gate.

## 5. One move function, retry-safe

Every negotiation move, human or agent, goes through
`offer_move(offer, kind, amount, idempotency_key, expected_round)` in one
transaction. It takes the locks in the order above. It checks the actor's role,
beta access, suspension, turn, limits and expiry. It applies a fail-closed rate
limit, appends to `offer_rounds`, and writes notifications and agent jobs in the
same transaction (outbox). A repeated idempotency key replays the result, and a
stale `expected_round` is refused. On acceptance it runs today's reserve-and-order
logic. A seller may cancel only before checkout begins, which the database
enforces once `accepted_checkout_shipping` is frozen (O-5).

## 6. The minimum: one floor, and the agent's can only be stricter

- The seller's minimum has one home, `listing_private_terms.offer_floor_cents`
  (A0, `20261017120000` / `20261017130000`). No member or visitor can read
  it; the seller reads their own through `my_listing_offer_floor`.
- A mandate may set an agent minimum. The **effective floor** is
  `max(seller floor, mandate minimum)`, so the agent never goes lower than the
  listing's own minimum (AG-2).
- Showing a minimum on the listing is the seller's choice, off by default
  (O-3). Until that toggle ships in A1, no minimum is shown.
- A below-minimum offer is recorded as a declined round and uses one of the
  buyer's 3 offers (O-2, from A1). The refusal never names the number.

## 7. Binding snapshot

Each issued round saves the terms it was made under: amount, expiry, acting
principal (the member, or the agent's task and job), mandate version, and the
limits in force. Accepting an outstanding, unexpired round honours its own
snapshot, so a later price change, a raised minimum or the agent being turned
off can't break an offer already on the table. A new proposal must respect the
current limits. This is O-4.

## 8. Data that never reaches the model provider

Addresses, payment details and VINs are never sent to the model. Agent
conversations, tasks, events, mandates and approvals join the account export
contract and the deletion worker when their tables are created (A2). The
retention and redaction rules are A0 data-rules work, written before chat (A3c).

## 9. Constraints left by the private-minimum rollout

They hold until the contract step, which drops `listings.offer_floor_cents` and
the absorb trigger, and adds a definer setter the sell and edit functions call.

- **Deferred foreign key.** `listing_private_terms.listing_id` is checked at
  commit, so the BEFORE INSERT trigger can write ahead of the listing row. A
  future listing insert that is skipped by `ON CONFLICT` on a key other than
  `id` would leave a private row with no listing and fail the commit. No such
  upsert exists today; don't add one before contract.
- **The `drvn.floor_checked_listing` setting.** It lets the private table's
  bound check skip a row the absorb trigger has already checked. Any role can
  call `set_config`, so the skip is safe only while no role except definer
  functions and the service role can write `listing_private_terms`. Never
  grant `agent_worker`, or any client role, direct writes on that table.
  Contract replaces the setting with the definer setter.
