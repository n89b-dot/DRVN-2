# 18+ confirmation and the copyright takedown route: kept

**Ruling:** keep both, and ask members who joined before the 18+ confirmation once, at their next sign-in. This is the recommended default from the remediation plan's decisions table (`docs/plans/2026-11-remediation-plan.md`, C5, ids `R69-age`, `R69-dmca`, `N686`). The remediation executor applied it on 8 November 2026 because Neil asked for the plan to go ahead on its defaults. Neil can reverse it: the removal path is one forward PR, described in the plan.

**Why keep them.** eBay requires 18+ in its User Agreement. A takedown route is needed anyway once there is a legal entity to register a DMCA agent for (F4). Both were built, migrated and tested by #117; removing them would be work, and keeping them costs nothing.

**What was built for earlier members** (N686):
- Accounts created before #117 merged (2026-11-08 02:03:15 UTC, `AGE_CONFIRMATION_SINCE` in `src/lib/age-confirmation.ts`) have no record in `public.age_confirmations`. On their next sign-in, by password or Google, a member with a handle and no record is sent to `/confirm-age`, keeping where they were going.
- The page asks the same question with the same box and wording as sign-up and onboarding. The answer is recorded once, by the server, as `returning_member` (`20261108150000_age_confirmation_returning_members.sql` widens the source check, and nothing else changes).
- No row is invented for anyone, and no date of birth is collected. Accounts created since #117 always answer on the way in, so they are never asked again. Neither are accounts a server created later (test fixtures, repairs).
- Members with a session that never signs in again are not interrupted mid-session; the plan asks at the next sign-in.

**Still the owner's:** registering the DMCA agent (F4, needs the entity from F1) and setting `confirmed: true` in `src/lib/legal/copyright-agent.ts` with the registered name and address.

**10 Nov 2026 (#110).** A member who stays signed in used to be asked only at their next sign-in, which a long-lived session could put off indefinitely. The request proxy now asks on their next page request, once per browser (a cookie remembers the account it checked), through `public.my_age_confirmation_due()`. Sign-in, the question itself, onboarding and the legal pages are exempt.


**10 Nov 2026, later (work review #152, OS id N662).** Asking on a page request left a gap: a Server Action is not a page request, so a member with a tab already open could go on messaging, offering, buying and listing without answering. Three changes close it.
- The actions that matter check for themselves (`requireAgeConfirmed` in `src/lib/age-gate.ts`): sending a message (a reply or a first message), making, accepting or countering an offer, starting a payment (cart checkout when signed in, and an accepted offer's checkout), and creating, editing or publishing a listing. A member who still owes the answer is sent to `/confirm-age` and comes back to the page they were on; nothing is written. Backing out is never held: declining or withdrawing an offer, and taking a listing off sale.
- The cookie that remembers "checked, nothing owed" is signed (`src/lib/age-cookie.ts`, keyed from `GUEST_RECEIPT_SECRET` under its own label). It used to be the bare account id, which a member could type in by hand.
- A prefetch is asked like any other page request. The exemption for it never fired in production.

The check sits in the app's actions, not in the database. A member who calls the database directly with their own session is not asked; the confirmation is a self-declaration, and the database already refuses a handle without a record for every account made since 8 November. Moving the check into the write functions would be a migration per function and is not planned.
