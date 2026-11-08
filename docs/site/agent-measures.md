# Measuring the agent

> The definitions behind the numbers on `/admin/agent` (plan: "Alongside A3 — measuring the agent"). Source of truth: `src/lib/agent/measures.ts`; computed daily by `agent_compute_metrics` (migration `20261024100000`) into `agent_metrics_daily`.

## How it is measured

- **From DRVN's own records,** never consented analytics: the agent's moves happen in the worker, which has no consent context, and an opt-in sample can't support a comparison.
- **Aggregates only.** No member ids in the table; any value from fewer than five cases is stored as null and shown as "—".
- **Per UTC day.** Each pass of the agent job recomputes today and yesterday, so late events land.
- **Gate** measures decide the plan's steps (A3 gates, A5 auto-accept). **Watch** measures are context.
- **The headline** (plan: agent-handled listings finish more paid, completed sales than comparable manual listings) would compare listings in the same subcategory and price band, in the same period, that received at least one offer. **It is unavailable for the beta:** there is no manual-listing baseline. The beta runs no comparison cohort, and a listing keeps only its current price, so the price band at the time of an offer can't be rebuilt. The page says so instead of showing a number.
- **Model usage** is `agent_usage` (model, tokens, cost and, for negotiation work only, the task; never text), which the spend caps also read. Chat turns record no task, so model cost can't be tied to a task.
- **The screens** have a few consented events in `src/lib/analytics.ts` (`agent_offers_enabled`, `agent_offers_disabled`, `negotiate_for_me_started`, `agent_tab_viewed`, `agent_approval_answered`), coarse properties only.

## What a cell can say (R-usage, R-measures, 7 November 2026)

Neil's ruling: compute what the records support, label approximations precisely, and mark the rest unavailable. There is no cohort study for the beta. Every measure has a **basis** in `src/lib/agent/measures.ts`, and every reading on `/admin/agent` has a **status** (`readMeasure`). Only a measured value is ever shown as a number.

| Status | Shown as | Means |
|---|---|---|
| `measured` | the number | Computed from five or more cases. |
| `measured_zero` | `0`, `0%`, `$0.00` | A real zero: a count or total with no cases that day, or a share or median of zero over five or more cases. |
| `insufficient_sample` | Under 5 | Fewer than five cases (suppressed), or a share, median or ratio with no cases at all. |
| `missing_computation` | Not computed | The records hold it but nothing computes it yet, or the agent job hasn't computed that day. |
| `unavailable_instrumentation` | Unavailable | The records it needs aren't kept, so it can't be computed. |

A measure whose basis is an **approximation** is computed, carries an "approx." label, and its note (below, and on the page) says exactly what it reads instead. Each day is recomputed only on that day's passes and the next day's, so anything that changes after the end of the next UTC day isn't seen.

## The measures

| Scope | Measure | Role | Definition | Basis |
|---|---|---|---|---|
| seller | **Headline: paid sales vs comparable manual listings** (`paid_sales_vs_manual`) | gate | Paid, completed sales from agent-handled listings against comparable manual listings (same subcategory and price band, same period, at least one offer). | **Unavailable:** No manual-listing baseline. The beta runs no comparison cohort, and a listing keeps only its current price, so the same-subcategory, same-price-band match at the time of an offer can't be rebuilt from the records. |
| seller | **Agent vs manual seller conversion** (`agent_vs_manual_conversion`) | watch | The share of offers that became paid orders, agent-handled listings against comparable manual ones. | **Unavailable:** No manual-listing baseline. The beta runs no comparison cohort, and a listing keeps only its current price, so the same-subcategory, same-price-band match at the time of an offer can't be rebuilt from the records. |
| seller | **Offers the seller's agent handled** (`offers_handled`) | watch | Offers made that day on a listing with a seller mandate live at the time of the offer. | Computed |
| seller | **Handled with no seller action** (`share_without_seller_action`) | gate | Of those offers, the share where the seller made no counter or decline themselves. | Approximation: Counts the seller's own counters and declines made by the day's last recompute (by the end of the next UTC day); a seller who steps in later isn't seen. |
| seller | **Deals the seller's agent reached** (`agent_deals`) | watch | Orders created that day from an offer with at least one round made by the seller's agent. | Computed |
| seller | **Agent deals cancelled** (`agent_deal_cancel_rate`) | gate | Of those orders, the share that ended cancelled. Low and steady is the evidence auto-accept (A5) needs. | Approximation: The order's status as of the day's last recompute (by the end of the next UTC day), not its final outcome: a later cancellation isn't counted. |
| seller | **Agent deals that completed payment** (`agent_deal_paid_rate`) | gate | Of those orders, the share paid, shipped, delivered or completed. | Approximation: The order's status as of the day's last recompute (by the end of the next UTC day), not its final outcome: a later payment or cancellation isn't counted. |
| seller | **Where agent deals landed** (`price_position`) | watch | Average position of the final price between the seller's minimum (0) and asking (1). | Approximation: Uses the listing's current asking price and the seller's latest mandate minimum, not the asking price and minimum when the deal was made. |
| seller | **Agent deal value net of cancellations and refunds** (`agent_net_sales_usd`) | watch | The value of agent-reached orders less cancellations and refunds. | **Not computed:** Orders and refunds hold it, but nothing computes it yet: the plan keeps amounts only as aggregate bands, and no band scheme is defined. |
| seller | **Approvals asked, seller** (`approvals`) | watch | Times the seller's agent asked its owner to accept, that day. | Computed |
| seller | **Approvals answered, seller** (`approvals_answered`) | watch | Of those, the share the owner answered (not left waiting), including answers that came after the offer expired or could no longer be accepted. | Approximation: Answers given by the day's last recompute (by the end of the next UTC day); a later answer still counts as waiting. |
| seller | **Time to answer, seller** (`minutes_to_answer`) | watch | Median minutes from the agent asking to the owner answering. | Approximation: Only approvals answered by the day's last recompute (by the end of the next UTC day), so the slowest answers are left out and the median runs low. |
| seller | **Turned off within a day of a move** (`turned_off_after_a_move`) | gate | Seller mandates revoked within 24 hours of an agent move: one sign the move wasn't wanted. | Computed |
| seller | **Time to deal** (`minutes_to_deal`) | watch | Median minutes from an offer to the order an agent deal made from it. | **Not computed:** Offer and order times hold it, but nothing computes it yet. |
| buyer | **Negotiate for me, started** (`negotiations_started`) | watch | Buyer mandates created that day. | Computed |
| buyer | **Buyer's agent accepted a counter** (`agent_accepts`) | watch | Counters the buyer's agent accepted within the buyer's max, that day. | Computed |
| buyer | **Approvals asked, buyer** (`approvals`) | watch | Times the buyer's agent asked its owner (a counter over the max). | Computed |
| all | **Refused agent writes** (`permission_denials`) | gate | Agent writes the database refused (agent_telemetry permission_denied). Should stay at zero. | Computed |
| all | **Approvals dismissed** (`approvals_dismissed`) | watch | Agent proposals the owner dismissed, that day. | Computed |
| all | **Buyer reports naming an agent round** (`reports_on_agent_rounds`) | gate | Reports from buyers about a move the agent made in a negotiation. | **Unavailable:** A report names a listing, member, post or comment, never an offer round, so a report about an agent's move can't be told apart. |
| all | **Incorrect-action rate** (`incorrect_action_rate`) | watch | Agent moves followed by a sign the move was wrong, over all agent moves. | **Not computed:** Its signals are counted one by one above; nothing combines them into a rate over agent moves yet. |
| all | **Members whose agent did something** (`active_members`) | watch | Members with an agent task that changed that day. | Approximation: Reads agent_tasks.updated_at, which every later change overwrites: a member whose task changed that day and again later counts only on the later day. |
| all | **Returning members** (`repeat_share`) | watch | Of those members, the share who had used the agent before that day. | Approximation: Its members come from agent_tasks.updated_at, which every later change overwrites, so a day's members can drop out when their task changes again; 'before' means a task created before that day. |
| all | **Time to first useful agent task** (`time_to_first_useful_task`) | watch | Time from a member first turning the agent on to its first task that did something useful for them. | **Not computed:** No rule yet says which task outcome counts as useful, so nothing computes it. |
| all | **Model cost** (`model_cost_usd`) | watch | What metered model calls cost that day (agent_usage: agent chat, Marketplace sentence filters, listing import and evals). | Approximation: A lower bound: a call on a model with no price recorded stores no cost and adds $0. |
| all | **Daily model cost ÷ tasks completed** (`cost_per_completed_task_usd`) | watch | That day's model cost divided by the agent tasks completed that day. | Approximation: Not a per-task cost. The cost is mostly chat, which records no task, while completed tasks are negotiation tasks: this is one day's total divided by another count. |
| all | **Model cost per completed task** (`cost_per_task_usd`) | watch | The model cost of each completed task, averaged. | **Unavailable:** Chat turns record no task (agent_usage.task_id is empty for chat), so model cost can't be tied to the task it served. |
