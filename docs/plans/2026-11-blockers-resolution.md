# Resolving the Intelligence OS blockers: November 2026

Started 7 November 2026, from main at 623f6eb (GitHub main ce19681). The Intelligence OS listed 198 blockers. It marked 157 of them "Claude can do it". Neil asked for all 157 to be resolved, with Claude and GPT (through Codex) agreeing how, and for the OS to track the work.

## How the plan was made

1. Claude wrote its own grouping first, without seeing GPT's.
2. GPT (Codex, read-only, reading the code) wrote an independent plan: 28 batches, a fix and a proof for every item, the items an agent must not just do, and the order of work.
3. Claude took GPT's batch structure, which was the more careful of the two, along with its corrections:
   - R72's buyer acceptance inside the ceiling is allowed by the PRD (AG-3, `docs/DRVN-PRD-2026-09.md:212`). The fix is copy, not removing the behaviour.
   - R-betaaccess is partly guarded already (`20260905190032_invited_beta_boundaries.sql:303-323`).
   - R-agentmode is a gap in #66's new mode, not on main.
   - N13 and N223 are one fix.
   - N248, N3 and N141 are narrower than reported.
4. Claude added its own sequencing. The final call is Claude's, with Neil's rulings below.

## Neil's rulings for this work (7 November 2026)

- Claude merges each PR once every check is green on its current head. Main is protected: `release-gate` is required, admins included.
- Each merged migration is applied to shared dev with the node-postgres method and recorded in `supabase/MIGRATIONS.md`.
- The repo is public, so GitHub Actions runs free. The exposed test passwords were rotated on shared dev the same day: 10 seed accounts, console-admin and viz-check. That closes the "you" half of R-password; the tree half is in fix/p1-commerce.

## How the OS tracks it

- New batches are OS packets `OS-W01` to `OS-W28`, dropped through the OS inbox (`work_packets.json`, OS commit f330713). Each batch's number matches GPT's batch number.
- Items that already had a packet keep it, for example OS-PR64, OS-PR66, OS-p1-commerce and OS-R-cron.
- Every PR title carries its task ids in capitals, for example `OS-W12 OS-R-cron: …`.
- The OS moves a task to started when it sees the claim, to waiting when a PR carries the id, and to done only on a merged change plus a passing check.

## Order of work

1. **Wave 0, unblock CI:**
   - #65 (OS-PR65, with W01's N2), then #33 and R-pg (OS-PR33 and OS-R-pg, with W02).
   - Nothing else can pass CI's audit step before #65.
2. **Wave 1, safety:**
   - Finish and merge the existing work first: fix/p1-commerce (OS-p1-commerce), then #64 (OS-PR64 plus W04), then #66 (OS-PR66 plus W06).
   - W12 sign-in security, W14 admin, W15 media, and W10's migration-runner guards.
3. **Wave 2, the database boundary and commerce:** W16 then W17, then W19, W20 and W05. W05 stacks on #66's mode schema.
4. **Wave 3, product and scale:** W07, W09, W11, W13, W21 to W26 and W27.
5. **Last:** #63 and R76 docs, and R-untested coverage against the integrated tree.

## Rules every batch follows

- **Isolation:** its own worktree and PR, with every task id in the PR title.
- **Proof:** every item carries a unit test, a SQL guard in `supabase/tests`, or a browser test that shows the behaviour.
- **Migrations:** new forward migrations only. One owner per redefined SQL function. Generated types are regenerated, never hand-merged.
- **Money rules:** no change to who is paid, when, refunds, holds or fees without a ruling below. A bug fix that restores the stated rule is allowed.
- **Merging:** never on red. A flaky job gets rerun, not merged past.

## Batches

| OS task | Batch | Items in this packet | Also covers (existing packets) |
|---|---|---|---|
| OS-W01 | Dependencies | N2 | OS-PR65 (R61) |
| OS-W02 | CI and release enforcement | N141, N21 | OS-PR33, OS-R-pg |
| OS-W04 | Agent model boundary | N121, N122, N127 | OS-PR64 (R62, R63, R66, R67, R68, R70, R77) |
| OS-W05 | Agent database authority | N128 | OS-R-agentmode |
| OS-W06 | Agent controls and truthful copy | N125 | OS-PR66 (R64, R65, R72, R74), OS-R71, OS-R-instant, OS-R-audit-killstate |
| OS-W07 | Agent tool contracts and audit trail | N170, N124 | OS-R-audit |
| OS-W08 | Private chat attachments | — | OS-R81 |
| OS-W09 | Scheduler and job health | N4, N226, N245, N391, N109 | OS-R-cron |
| OS-W10 | Migration safety and operations | N131, N246 | OS-PR63 (R76) |
| OS-W11 | Account privacy lifecycle | N35, N39, N47 | |
| OS-W12 | Sign-in security | N19, N20, N41, N42, N40 | |
| OS-W13 | Sign-in messages and layout | N43, N44, N45, N49, N50 | |
| OS-W14 | Admin reads and commands | N11, N133, N134, N136, N138 | OS-R-audit-closecase |
| OS-W15 | Media integrity and lifecycle | N12, N99, N100, N51, N55, N64 | |
| OS-W16 | Listing write boundary | N5, N69, N244, N72, N71, N26 | OS-R-audit-sell |
| OS-W17 | Checkout resume and reservations | N85, N86, N87, N88, N90 | OS-R-audit-buybar |
| OS-W19 | Fulfilment and delivery proof | N93, N94, N96, N97 | OS-R-audit-dispatch |
| OS-W20 | Settlement correctness and reconciliation | N8, N105, N106, N114, N115, N111, N144 | |
| OS-W21 | Social abuse and moderation | N247, N53, N62, N140 | |
| OS-W22 | Social retrieval at scale | N30, N31, N56, N60, N61, N68 | |
| OS-W23 | Garage integrity and direct-access tests | N65, N66, N67, N248 | OS-R-untested |
| OS-W24 | Feed layout and cache invalidation | N57, N58 | OS-R-h5, OS-R-e1 |
| OS-W25 | Discovery and listing lifecycle | N27, N29, N73, N76, N79 | |
| OS-W26 | Public claims, SEO and caching | N63, N74, N80, N81 | OS-R-overclaim |
| OS-W27 | Error visibility | N104, N25 | |
| OS-W28 | Measurement contracts | — | OS-R-arrival |

Some batches have no packet of their own:
- W03 is fix/p1-commerce (OS-p1-commerce).
- W18 is waiting on rulings.
- W08 and W28 are made only of items with existing packets.

## Neil's rulings on the 25 (7 November 2026), checked by GPT against the code

Neil ruled in chat. GPT (Codex) then checked every build against the code and corrected several; its corrections are folded in below.

**Built as proposed, with GPT's corrections**

| Item | Ruling | Build (OS task) |
|---|---|---|
| N13 + N223 | An open bank chargeback freezes the payout | Enforce at transfer readiness, fresh-transfer admission, `prepare_transfer_dispatch` and both worker reads, from the provider dispute journal (not `stripe_dispute_id IS NULL`). Cover buyer close, admin close and refund completion. Built first (OS-W18). |
| N6 | Copy eBay | Freeze dispatch-by and latest-delivery dates at purchase (handling time is per seller today). From the latest delivery date, the buyer has up to 30 days to report not received, including on undispatched orders. The seller has 3 business days to add valid tracking or refund. Either party can escalate between 3 and 21 business days, and DRVN refunds through the durable `refundOrder` when there's no valid tracking. Dispatch and tracking stay possible while a case is open. (OS-W29) |
| N91 | Resolved is final | Finality applies to the in-app case only. Bank chargebacks still open after an in-app resolution. An admin-only audited reopen keeps the history. (OS-W29) |
| N92 | Offers expire | Each refund offer gets an immutable 48-hour expiry, checked at acceptance and escalation. Neither a new offer nor an expiry resets the dispute clock. (OS-W29) |
| N95 | Copy eBay | A separate verified-proof record: delivered status, the carrier's date (never "now"), a destination matching the frozen order (postcode, else city), a shipping scan before the latest delivery date, and signature at $750+. Missing or contradictory evidence goes to review. Proof never blocks dispatch. (OS-W29) |
| R-disputecats | Add both | "Counterfeit" and "doesn't fit as listed", through the not-as-described and return path. (OS-W29) |
| N110 | Similar to eBay, no limits on $1,000+ orders | Remove the amount-based dispatch refusal. Separate tracking from label buying, so seller-entered tracking is registered with the EasyPost tracker whenever it's available, asynchronously and with retries. Disputes are decided by the N95 proof rules. Payouts follow the normal release rules, with no new high-value hold. (OS-W30) |
| N89 + beta | Guest caps approved; remove the invite-only beta | Remove the invitation machinery: config, invitations, memberships, signup claims, the three commerce guards, the gated `handle_new_user` and every app caller, plus the admin Invitations page. History stays restricted. Repair accounts left without profiles. Guest holds are capped atomically: 2 live per device and per network, and 1 live guest hold per listing. Both ship together, so opening guest checkout never exposes uncapped holds. The agent rollout switches (`AGENTS_BETA`, `agent_beta_steps`) are agent safety controls and stay. (OS-W31) |
| N54, N59, R-directcontact | Block approved; hide suspended members; buyers may message sellers | Private directed blocks with a symmetric "either blocked" check in SQL, covering agent writes. The order exception applies only to communication attached to a shared order. Suspension filtering applies across post, comment and profile reads. Then a real "Message seller" path: a listing-context send attached to the person-pair conversation, with seller replies, SQL rate limits and block checks. Agents still never message people (AG-4). The PRD loses its no-cold-contact line. (OS-W32) |
| N77 | Withdraw, don't delete | An atomic seller-authorised withdrawal, serialised with offers and checkout (listing-first lock). Live offers end with a listing-withdrawal reason, and buyers are notified. History is kept, and direct DELETE is guarded. (OS-W33) |
| N16, N38 | Approved | Deletion scrubs Auth email and metadata, addresses, order party labels, message and comment bodies and exports, using a keyed email digest. Transaction keys are kept for 6 years on a defined clock, and the process is resumable. Usernames: audit collisions first, then enforce lowercase a-z, 0-9 and `_` at 3 to 30 characters, with reserved names and tombstones. NULL is allowed for incomplete or deleted profiles. (OS-W34, after W11) |
| N78 | Daily digest | There is no saved-search email today. Build a daily digest outbox: unique per search per day, honouring recipient preferences, idempotent. (OS-W35) |
| R-photos | Text-only chat | Ordinary chat sends no image bytes. The photo jobs ("Listing from photos", "Post an update") keep image access through an explicit server-validated photo-job mode. (OS-R-photos) |
| R73 | Stop advertising | Remove `read_product`, `fitment_evidence` and `price_comparables` from the model's allow-list, starters and copy until graph answers exist. (OS-R73) |
| R-usage, R-measures | Approved | Compute what the records support. Label approximations precisely, and mark the rest unavailable. (OS-R-usage, OS-R-measures) |
| R-w3 | Keep the picker | Amend PRD W-3 to remove the link-paste requirement. Build nothing. (OS-R-w3) |

**Not now**

- **R69-age:** Neil is looking into it. For reference, eBay requires 18+ in its User Agreement, with no checkbox at sign-up.
- **R69-dmca:** a later feature.
- **N28:** deferred.
- **R-hold:** Neil ruled on 7 Nov, then revised the same day: "You can change it to 2 days to align with my rule if that makes sense". Every fallback becomes 2 days: `DEFAULT_PAYOUT_HOLD`, the column default and the SQL coalesce, matching the configured 2-day hold. Built by Cloud B, migration in the 2209xx slot.

## Owner or hosted, not code

- **R-unproven:** hosted money paths need staging.
- **R75:** a run against a real model needs a production key and spend.
- **R-migrations:** repairing shared-dev tracking. Claude can build a read-only report.
- **N3:** deploy enforcement needs the hosting account.
- **Hosted halves of other items:** R62's credentials, R77's hosted restore, N136's first admin enrolment, and N64's HEIC support on the deployment runtime.
