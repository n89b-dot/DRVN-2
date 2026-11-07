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

## Rulings needed (25 items, Claude's recommendation in bold)

These are money rules or product and privacy choices. Each is built only after Neil rules. Saying "accept the recommendations" covers all of them.

**Money**

| Item | Question | Recommendation |
|---|---|---|
| N6 | A paid seller never ships. What is the buyer's remedy? | **Dispatch deadline of 5 days after payment (7 for pickup). After it, the buyer can cancel in one tap for a full refund, and the seller gets a defect.** |
| N13 + N223 | An in-app dispute is closed while a bank chargeback is open | **An open chargeback freezes the payout. Closing in-app can't release it until the chargeback resolves.** |
| N89 | Guests can hold any listing for free | **Keep the hold length. Cap guests at 2 concurrent holds per device or network, and allow 1 guest hold per listing.** |
| N91 | Resolved disputes can be reopened | **A resolved dispute is final. Only an admin can reopen one, with an audit note.** |
| N92 | A one-cent refund offer stalls a dispute | **Refund offers expire after 48 hours. The dispute then carries on to its normal escalation clock.** |
| N95 | Delivery proof isn't tied to the order | **Tracking counts as proof only if the carrier's destination postcode matches the order's. Otherwise the case is held for review.** |
| N110 | Orders of $1,000 or more need DRVN Shipping | **Keep the threshold. Until DRVN Shipping is live, listings are capped at $999, with a clear message.** |
| R-hold | Fallback when the hold setting is missing | **The fallback is 2 days, matching the 4 October ruling.** |

**Product, privacy and legal**

| Item | Question | Recommendation |
|---|---|---|
| R-photos | Should chat photos go to the model? | **No, not for the beta. Text only.** |
| R73 | Graph tools are honest stubs | **Take them out of advertised capabilities until graph answers ship.** |
| R-betaaccess | Do exits from an offer need beta eligibility? | **Decline and withdraw need none. A re-offer does.** |
| R69-age | Confirming members are 18 or over | **A checkbox at sign-up, Google onboarding and guest checkout, stored with a timestamp.** |
| R69-dmca | Copyright takedown | **Build the notice form and the admin takedown queue now. The registered agent's address waits on the entity.** |
| R-directcontact | Unprompted messages to sellers | **Allow listing messages only once a buyer starts the thread. Remove the unprompted branch.** |
| R-w3 | Part for sale block in posts | **Build the own-listing link paste. The PRD stands.** |
| R-disputecats | Fake part, or a part that doesn't fit | **Add the categories "counterfeit" and "doesn't fit as listed".** |
| R-usage, R-measures | Agent and PRD measures | **Compute what existing events support. Mark the rest unavailable. No cohort study for the beta.** |
| N16 | Personal data on account deletion | **Anonymise identity: hash the email, remove names and addresses, redact message bodies. Keep order and money rows for 6 years.** |
| N38 | Username rules | **Lowercase a-z, 0-9 and `_`, 3 to 30 characters, reserved names, unique ignoring case. Audit existing handles first, and rename any collision with a notice.** |
| N54 | Block and mute | **Block stops messages, offers, follows and comments both ways and hides content, but doesn't touch existing orders. Mute is left for later.** |
| N59 | Suspended members' content | **Hide their posts, comments and profile from the public. Keep their order threads.** |
| N77 | Deleting a listing that has offers | **The listing is withdrawn, not deleted. Its offers are marked withdrawn, with a notice to buyers.** |
| N78 | Saved-search alert cadence | **At most one email per saved search per day, as a digest.** |
| N28 | Edge caching | **Defer. Measure after launch.** |

## Owner or hosted, not code

- **R-unproven:** hosted money paths need staging.
- **R75:** a run against a real model needs a production key and spend.
- **R-migrations:** repairing shared-dev tracking. Claude can build a read-only report.
- **N3:** deploy enforcement needs the hosting account.
- **Hosted halves of other items:** R62's credentials, R77's hosted restore, N136's first admin enrolment, and N64's HEIC support on the deployment runtime.
