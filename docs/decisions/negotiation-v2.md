# Decision: negotiation v2 (A1)

**Status: decided 17 October 2026.** The rules come from PRD O-1…O-6 and the plan's negotiation
table; Neil ruled the four remaining choices in §7 the same day.
This record turns the rules into the database and app shape that A1 builds and that the agent
(A2–A3) uses unchanged. It follows [`agent-foundations.md`](agent-foundations.md): one move
function, the lock order, the floor rule and the binding snapshot.

## 1. Today, in one paragraph

An offer is one row in `offers` with one round: the buyer offers (`open`), and the seller
accepts, declines or counters once (`countered`). The buyer can then accept the counter or
withdraw, and the seller can only pass. History is rebuilt from the row's own columns; no
round table exists. Moves happen in four places: `create_offer_with_message` (invoker), direct
table updates from `respondToOffer` and `withdrawOffer` (through the admin client and the user
client), and `offer_accept_begin` (definer). A below-minimum offer is refused before anything is
recorded. Expiry is 72 hours from the first offer, and a counter doesn't reset it.

Found while mapping, and fixed in A1:
- The "buyers create offers" insert policy still lets a client insert into `offers` directly,
  skipping the RPC's DRVN Shipping check.
- `withdrawOffer` reports success when nothing changed.
- Expiry sends no notification.
- An accepted offer whose 24-hour payment window lapses stays `accepted`, while its order goes
  to `payment_failed`, so the buyer sees "already settled" instead of "this offer lapsed".

## 2. The rules

| Rule | Value |
|---|---|
| Buyer offers per listing | 3 in total, counting the opening offer, every counter-back and every below-minimum attempt, across every thread the buyer opens on that listing. Declining doesn't use one |
| Turns | Strictly alternating. Whoever didn't make the last move acts next; nobody can move twice in a row |
| A seller's counter | At or below the asking price, at or above the effective floor, and above the buyer's latest amount |
| A buyer's counter-back | Above their own last amount and below the seller's latest counter |
| Each new move | Replaces the last as the live proposal, which is the one either side can accept |
| Expiry | Each move gets a fresh 72 hours (see §7.1) |
| Below the minimum | Recorded as a round that is declined at once; it uses one of the buyer's 3, and the refusal never names the number |
| Acceptance | Accepting the live, unexpired proposal creates the order at that round's own snapshot price, whatever has changed since |
| Seller cancellation | Only before checkout begins: refused once `accepted_checkout_shipping` is frozen, not only once payment starts |
| Agents | The same rules, with nothing extra (AG-2, AG-3) |

## 3. Data

### `offers` stays the negotiation

One row per buyer per listing while live, as today, so every existing reader keeps working.
Its columns become the **current state**: `amount_cents` is the buyer's latest amount,
`counter_amount_cents` the seller's latest counter, which is cleared when the buyer counters
back, so `coalesce(counter, amount)` is still the live price. `status` is `open` when it's the
seller's turn and `countered` when it's the buyer's. `expires_at` is the live proposal's expiry.
New columns are `round_count` (moves so far) and `last_round_id`.

### `offer_rounds`, new and append-only

| Column | Meaning |
|---|---|
| `id`, `offer_id`, `round_no` | One row per move, numbered 1, 2, 3… per offer; `(offer_id, round_no)` is unique |
| `listing_id`, `buyer_id` | Copied from the offer, so "3 per listing per buyer" counts across threads |
| `actor_role` | `buyer`, `seller` or `system` (expiry, auto-decline) |
| `kind` | `offer`, `counter`, `accept`, `decline`, `withdraw`, `expire`, `below_minimum` |
| `amount_cents`, `expires_at` | The proposal this move made, if any |
| `actor_member_id` | The member who moved. The agent columns (`actor_task_id`, `actor_job_id`, `mandate_version`) are added in A2 and stay null until then |
| `idempotency_key` | Unique per actor, so a retried move replays instead of repeating |
| `created_at` | |

The buyer and the seller can read the rounds of offers they're party to (row security as on
`offers`); nobody else can. The **binding snapshot**, meaning the limits in force when a round
was issued (the effective floor, or the buyer agent's ceiling from A3b), goes in
`offer_round_terms`. That table is private on the `listing_private_terms` pattern, readable by
no client, so a round can be honoured or audited without anyone seeing the other side's limits.

## 4. One move function

`offer_move(p_offer uuid, p_kind text, p_amount int, p_idempotency_key text, p_expected_round int)`
is SECURITY DEFINER and is the only writer of offers and rounds after the switch. The actor is
`auth.uid()`; A2 adds `agent_offer_move` with a leased job instead. Opening an offer is
`offer_open(p_listing, p_amount, p_message, p_idempotency_key)`, which replaces
`create_offer_with_message`. In one transaction, it:

1. **Takes the locks in the one order:** listing → offer → order → payment.
2. **Checks the actor:** the buyer or the listing's seller, not suspended, and beta-eligible for
   that side.
3. **Checks the round:** `p_expected_round` equals `round_count`, or it refuses as stale.
4. **Checks the turn** (the other side moved last) and the offer's state.
5. **Checks the limits:** counter bounds, 3 buyer offers per listing, and the effective floor
   (`max(seller floor, mandate minimum)`). A below-minimum amount is recorded as
   `below_minimum`, the offer is closed as declined, and the call returns the generic refusal.
6. **Applies a fail-closed rate limit** in the database, not the app's fail-open one.
7. **Writes:** appends the round and its private terms, then updates `offers`' current state.
8. **On accept,** runs today's reserve-and-order logic, which moves out of `offer_accept_begin`.
9. **Queues notifications** in the same transaction, which is also the outbox A2's agent jobs
   use.

A repeated `p_idempotency_key` returns the first result. The app actions become thin wrappers
around these two functions. The direct client insert and update policies on `offers` are
removed, so nothing else can write an offer.

## 5. Lock order

Today, acceptance locks the offer first, while checkout freeze and seller cancellation lock the
order first (audited in `agent-foundations.md` §4). A1 makes every path lock listing → offer →
order → payment:
- `offer_move`'s accept follows that order.
- `freeze_accepted_offer_checkout`, `settle_seller_cancellation` and `purchase_finalize` are
  restated to lock the listing before the order.

## 6. The build, in steps

Each step ships on its own and leaves the app working.

1. **Expand, with no behaviour change.**
   - Add `offer_rounds` and `offer_round_terms`, plus a backfill that turns each existing
     offer's columns into its rounds.
   - Add a trigger that records a round for every move today's code still makes.
   - The offer page reads its history from rounds.
2. **Switch the rules** (`20261017160000`; the lock-order restatement of `freeze_accepted_offer_checkout`, `settle_seller_cancellation` and `purchase_finalize` followed in `20261018100200`, and the old write paths were removed by the contract step, `20261019120000`).
   - Add `offer_open` and `offer_move`, and point the app's actions at them.
   - Add buyer counter-backs, the 3-offer limit, the per-turn expiry, below-minimum rounds, the
     listing-first lock order and cancel-before-checkout.
   - Remove the client write policies on `offers` (done in the contract step). The step-1
     trigger stays: `offer_open` and `offer_move` write their own rounds and it skips them, but
     the expiry sweep, `purchase_finalize` (closing the other offers on a sold part) and
     `offer_accept_begin` on an expired offer still change an offer's status, and it records
     those rounds.
3. **The screens** (done 18 Oct, except the "via agent" recipe, which comes with A3a).
   - Round history on `OfferCard` and on the offer page.
   - A counter-back form for buyers, and "Offer 2 of 3" shown to both sides.
   - "Show my minimum" on the sell form (O-3), off by default.
   - A quiet "via agent" recipe in CSS, unused until A3a.
   - Expiry notifications, and the lapsed-reservation wording fix.
4. **The gate** (the concurrency drills and the three-round e2e were added 18 Oct; the contract step, `20261019120000`, retired `create_offer_with_message`, the client insert and update policies on `offers` and `guard_offer_private_floor`):
   - SQL guards for turns, the limit across threads, below-minimum attempts using a turn, the
     snapshot honoured after a limit change, replay, stale rounds, and the refused
     cancellation once checkout has started.
   - Concurrency tests: the buyer accepts while the seller cancels, two counters at once, and an
     acceptance during another buyer's checkout.
   - An e2e three-round negotiation.
   - The existing checkout, notification and order-recovery suites still pass.

## 7. Rulings (Neil, 17 October 2026)

1. **Turn length:** 72 hours per turn, and every move resets the clock.
2. **Offers already live at the switch** count as the buyer's first offer and carry on under the
   new rules.
3. **A below-minimum attempt:** the seller sees "declined automatically: below your minimum" in
   that buyer's history, and the buyer sees "declined".
4. **Expiry notifications:** a new `offer_expired` kind, sent to both sides under the existing
   offers preference.
