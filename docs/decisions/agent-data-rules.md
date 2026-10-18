# Decision: the agent's data rules

**Status: decided 17 October 2026 (Neil).** The periods, operator access and provider retention below are his rulings. This is A0's "data rules" item in
the agent plan ([`docs/plans/2026-10-agent-and-graph-plan.md`](../plans/2026-10-agent-and-graph-plan.md)).
It covers what the agent keeps, for how long, what a member gets in their export, what account
deletion removes, and what may reach the AI model provider. The tables don't exist yet; A2
creates them, and each one ships with the export, deletion and retention handling below in the
same migration. Nothing here is a legal opinion;
counsel reviews the privacy and terms wording (§4) before the agent launches
([`legal-review-checklist.md`](../legal-review-checklist.md), "The agent").

Shapes and names follow [`agent-foundations.md`](agent-foundations.md) and PRD §4.9 / §5.

## 1. What each agent table holds, and how it's handled

| Table | What it holds | In the member's export | On account deletion | Kept while the account exists | Redaction before storing |
|---|---|---|---|---|---|
| `agent_mandates` | The limits a member set: minimum or ceiling, target, style, scope, version, status, expiry | Yes, owner access: every version | Deleted | Active ones until revoked or expired; ended ones **12 months** | None needed; no free text |
| `agent_tasks` | What the agent is trying to do: objective, scope, status, links to the listing, offer or car | Yes, owner access | Deleted | Open ones until done; finished ones **12 months**, which is what the Done list and the later agent dashboard show | Objective text: payment-card numbers removed (§3) |
| `agent_events` | Append-only record of each decision or tool call: the mandate version, the event that triggered it, inputs, result, idempotency key | Yes, owner access, minus internal fields (lease ids, job ids, raw model output) | Deleted, except events tied to an order that is under a financial hold: they wait with the order, as orders already do | **12 months**, then deleted. The binding facts of a negotiation live on in `offer_rounds`' snapshot, which follows the offer's own rules | Tool inputs and results go through the same sending rules as §3, so nothing in §3's "never" list is stored here either |
| `agent_conversations` and their messages | The chat thread: what the member typed and what the agent replied | Yes, owner access: every message | Deleted | **12 months from the last message**. A member can clear their thread at any time | Payment-card numbers removed before storing (§3) |
| `agent_approvals` | Confirm cards: what was proposed, what the member chose, when | Yes, owner access | Deleted | With their task | None needed |
| `agent_jobs` | The work queue the worker leases | No. Operational, holds ids and states only | Deleted | **30 days after it finishes** | No content: ids, kinds, states, lease times |
| Agent monitoring | Stuck tasks, stale jobs, permission denials, model errors (ids, counts, error codes) | No. Operational telemetry, separate from product analytics | Ids removed | **30 days** | Never message text, amounts or limits |

What the other side sees: only what the offer history already shows them, plus a quiet
"via agent" on an offer the agent sent (AG-4). They never see the member's limits, tasks,
events or chat, and none of it appears in *their* export. Their export keeps the offer rounds
they were party to, as today.

Admins: the kill switches and monitoring show ids, states and counts. Reading a member's chat
needs an operator action that is written to the admin audit log, the same as other member data
today, and is allowed only for an abuse or dispute case (decided 17 Oct).

## 2. What may reach the model provider

The model is used from A3c (chat), with photos from A3d and the owner's listing messages from
A4. Each call goes through the shared client in `src/lib/ai/`. Its input is built from an
allow-list per tool, never by passing records whole.

**May be sent**, and only what the task in hand needs:
- What the member typed or attached in the agent chat, after §3's redaction.
- Public listing facts: title, description, category, condition, brand, part number, asking
  price, photos (A3d).
- The member's own cars and mods: make, model, year, generation, the build lines.
- Public fitment evidence and price comparables, as aggregates.
- The outcome the rules already decided, so the model can explain it ("countered at $420").
- From A4: messages the owner received about their own listing, wrapped as untrusted data, with
  the other member shown as "the buyer" (no name, username or id).

**Never sent:**
- Postal addresses, phone numbers and email addresses, of anyone.
- Payment details of any kind: card numbers, Stripe ids, payout or bank details.
- VINs (`my_car_vin` stays owner-only, and the agent doesn't read it).
- A seller's minimum or a buyer's ceiling, the member's own included. Rules set the price, so
  the model doesn't need limits to do its job (AG-5). This also means a prompt injection can't
  leak them.
- Anything belonging to another member that isn't public: their limits, tasks, chat, private
  terms, or messages not addressed to the owner.
- Credentials, tokens, session or lease ids, internal notes, admin data.

**Provider terms.** Data is sent under the provider's commercial API terms, where inputs aren't
used for training. DRVN asks the provider for zero data retention on agent and importer calls
(decided 17 Oct). Arranging it is an account step for Neil with the provider; until it's
confirmed, the privacy page doesn't claim it. The usage log keeps the model, token counts, cost and task id, never the
content.

**Untrusted content.** Anything not typed by the owner (listing text, other people's messages,
web pages, photos) is passed as data, never as instructions, in the importer's pattern
(`src/lib/listing-import/extract/ai.ts`). Retrieved text never grants permission, and a tool's
output is validated before anything is written.

## 3. Redaction

Applied in one function, before storing chat or event text and again before any model call.
Both steps are tested with fixtures in `tests/agent-evals/`.

- **Payment-card numbers** (13–19 digits passing a Luhn check, with spaces or dashes) are
  replaced with `[card number removed]`. The member is told once in the thread why.
- **VIN-shaped strings** (17 characters, no I, O or Q) are replaced with `[VIN removed]`
  before the model sees them. They're kept in the stored chat, since it's the member's own
  text, but they're never sent.
- **Email addresses and phone numbers** typed into chat are stored, but sent to the model as
  `[email]` / `[phone]`.
- Postal addresses aren't pattern-matched (too unreliable). They're kept out because no tool
  ever reads one: the agent can't see checkout or shipping addresses.

## 4. Draft wording for the privacy and terms pages

These go into `src/app/(legal)/privacy/page.tsx` and `terms/page.tsx` in the release that turns
the agent on (A3a for negotiation, extended at A3c when the model is first used). The pages
describe what the code does today, so the agent wording doesn't go in before then. It is a
draft for counsel, not legal advice.

**Privacy: "What we collect", new item**

> **If you use the DRVN agent:** the limits you set for it (your lowest price or highest
> offer, your target and style), what you ask it to do, its record of what it did and why, and
> your chat with it.

**Privacy: "Who else sees it", the Anthropic item (from A3c)**

> **Anthropic**: when you import a listing, the text of the page you imported is sent to
> Anthropic's AI service to draft the listing. When you chat with the DRVN agent, what you
> type, the public details of the listings and cars it's working on, and your own build are
> sent to Anthropic's AI service so it can understand you and reply. Your addresses, phone
> number, email, payment details, VINs and the price limits you set are never sent. Anthropic
> doesn't use this data to train its models.

**Privacy: "What's public", new sentence**

> When the agent sends an offer for you, the other member sees "via agent" on it. They never
> see your limits or your chat with the agent.

**Privacy: "How long we keep it", new items**

> - Your chat with the agent: 12 months after your last message, or until you clear it.
> - The agent's record of what it did, and finished tasks: 12 months.
> - Limits you've turned off: 12 months.

**Privacy: "Deleting your account", one added clause**

> …your cars, build posts and listings and their photos are removed, **your agent's limits,
> tasks, record and chat are deleted**, any saved cards are deleted at Stripe…

**Terms: new section "The DRVN agent"**

> The agent acts for you only inside the limits you set, and you can change or turn it off at
> any time. When you let it handle offers on a listing, its counters are offers from you: a
> buyer who accepts one has agreed a sale, as if you had made the counter yourself. On a
> listing you're buying, when you ask it to negotiate for you, it accepts a seller's counter at
> or below the highest price you set, and that is a sale you've agreed. It never accepts offers
> on your own listings, and it never pays for anything: you always pay yourself. We may pause
> the agent for everyone, or for a
> listing or account, to keep the marketplace safe; offers and orders already made stay as they
> are. The agent can make mistakes. Check what it drafts before you confirm it.

## 5. Decisions

Ruled by Neil on 17 October 2026:

1. **Periods.** 12 months for agent chat (from the last message), the agent's record of
   actions, finished tasks and ended limits; 30 days for jobs and agent monitoring.
2. **Operator access.** Admins read a member's agent chat only for an abuse or dispute case,
   and every read is written to the admin audit log.
3. **Provider retention.** DRVN asks the model provider for zero data retention on agent and
   importer calls.
4. **Clearing the chat** removes the conversation only. The agent's record of actions stays,
   because it explains offers already made, and ages out after 12 months.

Still open, for counsel: whether the binding-counter clause and the "via agent" disclosure are
enough notice for the other party (`legal-review-checklist.md`, "The agent").
