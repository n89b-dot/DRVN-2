# Measuring the agent

> The definitions behind the numbers on `/admin/agent` (plan: "Alongside A3 — measuring the agent"). Source of truth: `src/lib/agent/measures.ts`; computed daily by `agent_compute_metrics` (migration `20261024100000`) into `agent_metrics_daily`.

## How it is measured

- **From DRVN's own records,** never consented analytics: the agent's moves happen in the worker, which has no consent context, and an opt-in sample can't support a comparison.
- **Aggregates only.** No member ids in the table; any value from fewer than five cases is stored as null and shown as "—".
- **Per UTC day.** Each pass of the agent job recomputes today and yesterday, so late events land.
- **Gate** measures decide the plan's steps (A3 gates, A5 auto-accept). **Watch** measures are context.
- **The headline** (plan: agent-handled listings finish more paid, completed sales than comparable manual listings) compares listings in the same subcategory and price band, in the same period, that received at least one offer. It is read from these daily rows over a window, not stored as a single number.
- **Model usage** is `agent_usage` (task, model, tokens, cost; never text), which the spend caps also read.
- **The screens** have a few consented events in `src/lib/analytics.ts` (`agent_offers_enabled`, `agent_offers_disabled`, `negotiate_for_me_started`, `agent_tab_viewed`, `agent_approval_answered`), coarse properties only.

## The measures

| Scope | Measure | Role | Definition |
|---|---|---|---|
| seller | **Offers the seller's agent handled** (`offers_handled`) | watch | Offers made that day on a listing with a seller mandate live at the time of the offer. |
| seller | **Handled with no seller action** (`share_without_seller_action`) | gate | Of those offers, the share where the seller made no counter or decline themselves. |
| seller | **Deals the seller's agent reached** (`agent_deals`) | watch | Orders created that day from an offer with at least one round made by the seller's agent. |
| seller | **Agent deals cancelled** (`agent_deal_cancel_rate`) | gate | Of those orders, the share that ended cancelled. Low and steady is the evidence auto-accept (A5) needs. |
| seller | **Agent deals that completed payment** (`agent_deal_paid_rate`) | gate | Of those orders, the share paid, shipped, delivered or completed. |
| seller | **Where agent deals landed** (`price_position`) | watch | Average position of the final price between the seller's minimum (0) and asking (1). |
| seller | **Approvals asked, seller** (`approvals`) | watch | Times the seller's agent asked its owner to accept, that day. |
| seller | **Approvals answered, seller** (`approvals_answered`) | watch | Of those, the share the owner accepted or dismissed (not left waiting). |
| seller | **Time to answer, seller** (`minutes_to_answer`) | watch | Median minutes from the agent asking to the owner answering. |
| seller | **Turned off within a day of a move** (`turned_off_after_a_move`) | gate | Seller mandates revoked within 24 hours of an agent move: one sign the move wasn't wanted. |
| buyer | **Negotiate for me, started** (`negotiations_started`) | watch | Buyer mandates created that day. |
| buyer | **Buyer's agent accepted a counter** (`agent_accepts`) | watch | Counters the buyer's agent accepted within the buyer's max, that day. |
| buyer | **Approvals asked, buyer** (`approvals`) | watch | Times the buyer's agent asked its owner (a counter over the max). |
| all | **Refused agent writes** (`permission_denials`) | gate | Agent writes the database refused (agent_telemetry permission_denied). Should stay at zero. |
| all | **Approvals dismissed** (`approvals_dismissed`) | watch | Agent proposals the owner dismissed, that day. |
| all | **Members whose agent did something** (`active_members`) | watch | Members with an agent task that changed that day. |
| all | **Returning members** (`repeat_share`) | watch | Of those members, the share who had used the agent before that day. |
| all | **Model cost** (`model_cost_usd`) | watch | What the model cost that day (agent_usage). Zero until chat (A3c). |
| all | **Cost per completed task** (`cost_per_completed_task_usd`) | watch | That day's model cost divided by agent tasks completed that day. |
