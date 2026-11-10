# DRVN production-readiness review: 3 November 2026

A full review of every page and feature in the current code (`main` at `ce19681`), looking at each one as though real members, real money and real data arrive next week. Older readiness reports in `docs/` were not taken on trust; every finding comes from the code and the **latest** migration that defines each database rule.

**How to read this**

- **Severity**
  - **Blocker:** fix before any real member or real payment.
  - **High:** fix before public launch.
  - **Medium:** fix soon after, or before scale.
  - **Low:** polish.
- **Confidence**
  - **Checked:** I re-traced the code myself, or reproduced the problem.
  - **Traced:** a reviewer followed the full code path.
  - **Needs a live test:** the code points to a problem, but it has to be confirmed on a running system.
- Each item explains the problem in plain terms, then gives the technical reason and the files involved, so whoever fixes it can go straight to the code.
- **Second opinion.** After the first draft, OpenAI's Codex (GPT) did two separate read-only passes. One reviewed every route from scratch without seeing this report; the other checked this report finding by finding. Its corrections are folded in below, and its new findings that I confirmed are marked *(Codex)*. Section 2.9 sets out where the two reviews agree and disagree.

---

## 1. The short version

The foundations are strong:

- **Money:**
  - Payments, refunds and payouts run through durable state machines with crash recovery.
  - Database rules prevent members from touching money tables directly.
  - Production refuses to run fake payments.
- **Security basics:**
  - Row-level security is on for every table.
  - The security headers are good.
- **Tests:** typecheck passes and all 1,183 unit tests pass.

Most of what's left falls into five themes:

1. **Some rules live only in the app, not in the database.** Members sign in with a key that also lets them talk to the database directly. Wherever a rule, such as a rate limit, a publish requirement or a URL check, only exists in our server code, a technically minded member can skip it. This one theme accounts for about a third of the findings.
2. **Safety nets for things going wrong.** For example: a seller who never ships, a refund that fails halfway, a payout to a seller whose Stripe account got restricted.
3. **Operations.** No production or staging project, no backups yet, CI that doesn't actually block a bad deploy, and alerts that would be noisy or empty.
4. **Legal and privacy.** Sales tax, terms that haven't had a lawyer's review, account deletion that keeps personal data, and an AI privacy promise the code doesn't fully keep.
5. **A small number of real security bugs.** An outdated Next.js with a critical advisory (fixed 7 Nov, see B1), an open redirect, a password-change bypass, an admin-console access gap, and a way to delete someone else's dispute evidence.

### Launch blockers (fix before any real member or payment)

| # | What | Area | Confidence |
|---|---|---|---|
| B1 | ~~The installed Next.js version has a **critical** published security advisory~~ **Fixed 7 Nov 2026** (PR #65: Next 16.4.3) | Whole app | Checked (`npm audit`) |
| B2 | A buyer who has paid has **no self-service way to get their money back if the seller never ships** (only an admin can refund) | Orders | Checked |
| B3 | **No sales tax**, and the Terms are marked in the code as an unreviewed draft | Checkout / legal | Checked |
| B4 | Admin console pages check access only in the layout, while reading data with the all-access key | Admin | Checked (code); needs a live test (exploit) |
| B5 | **Dispute and purchase evidence can be deleted**: the other party can get the clean-up job to delete it, and uploaders can delete their own straight from file storage | Disputes / orders | Checked |
| B9 | **Closing a dispute inside DRVN releases the seller's payout while a bank chargeback is still open** *(Codex)* | Disputes / payouts | Checked |
| B6 | There's no production or staging project, no hosted backups, and restore has never been rehearsed | Operations | Checked (docs) |
| B7 | Deleting your account **keeps your email, address and messages forever** if you've ever bought or sold. This is a blocker for a UK/EU launch | Settings | Traced |
| B8 | The AI agent's background worker is **never scheduled**, so "let DRVN handle offers" does nothing. This is a blocker only if the agent's negotiation ships at launch | Agent | Checked |

### Project health checks run today

| Check | Result |
|---|---|
| Typecheck | Pass |
| Unit tests | Pass: 166 files, 1,183 tests |
| Lint | 1 error, in `intelligence-os-export/` (not app code), plus 655 warnings. The warnings are almost all "unused expression" in a few generated files |
| Dependency audit (production) | **3 vulnerabilities: 1 critical (Next.js), 2 high (undici, zod).** All fixable with `npm audit fix`. CI's own audit step should currently be failing on these. **7 Nov: 0 vulnerabilities after PR #65 (B1)** |

---

## 2. Findings by area

### 2.1 Whole app and platform

**B1. Next.js has a critical security advisory (Blocker, Checked) — FIXED 7 Nov 2026**
- **Status:** fixed by PR #65 (merge `f2b8eee`): `next` 16.3.8 → 16.4.3, `undici` 8.11.2 → 8.12.3, `zod` 4.4.3 → 4.6.7, lockfile only. `npm audit --omit=dev --audit-level=high` reports 0 vulnerabilities; `next build` passes on that lockfile; all eight CI checks, e2e included, passed on the PR head. Next 16.4.5 is out since; no advisory requires it.
- **What's wrong:** The installed version is 16.3.8. It falls inside published advisories for:
  - remote code execution through the image optimiser when SVGs are involved;
  - remote code execution in `use cache` functions;
  - a denial-of-service attack through Server Actions.
- **Also affected:** two more dependencies with high-severity advisories:
  - `undici`, the HTTP client the listing importer uses: certificate-validation bypass and cache poisoning;
  - `zod`, which validates forms: memory exhaustion on oversized input.
- **Advisory IDs from `npm audit --omit=dev`, 3 Nov 2026:**
  - `next`: GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr and GHSA-p3m5-59mp-jv5r.
  - `undici`: GHSA-4w7w-5xrc-9h26, GHSA-2m5v-pch6-74hx, GHSA-qrxm-fqhp-jwvm, GHSA-9fm3-97px-rjf6 and GHSA-55wc-3pg8-jfw6, among others.
  - `zod`: GHSA-mrhx-c7xc-m3w5.

  Codex couldn't run the audit (it was offline and read-only), so it rated this "unverifiable". The versions it read do match the affected ranges.
- **Fix:** run `npm audit fix` (or bump `next` past 16.4.0, `undici` past 8.12.1 and `zod` to at least 4.6.6). Re-run `npm audit` to confirm it's clean, then the full test suite and e2e.

**Rules enforced only in the app, not the database (High, Traced; found independently by three reviewers)**
- **What's wrong:** these limits exist only in our server actions:
  - 40 messages per 10 minutes;
  - comment, reaction and follow limits;
  - question limits on listings.
- **Why they can be bypassed:** the database itself lets any signed-in member insert messages, comments, reactions, follows and listing questions directly. A script with the member's own login can skip every limit.
- **Effect:** one account can flood any seller's inbox, or bury someone's notifications. Following, unfollowing and following again even sends a fresh notification each time, with no de-duplication.
- **Where:**
  - the limits: `src/lib/rate-limit.ts`;
  - the insert policies: `supabase/migrations/20261017140000_rls_initplan.sql` (messages 220-227, comments 40-41, reactions 76-78, follows 141-143);
  - the follow RPC: `set_social_relationship`, granted to `authenticated` in `20260913132451`.
- **Fix:** move the throttle into the database, either with a trigger that calls the existing `consume_rate_limit`, or by removing direct inserts and routing writes through a database function. De-duplicate follow, like and reaction notifications per person, target and day.

**Content Security Policy may block Stripe's newer payment frames (Medium, Needs a live test)**
- **What's wrong:** `src/proxy.ts:18` allows only `js.stripe.com` and `hooks.stripe.com` as frames. Stripe's current guidance also lists `*.js.stripe.com`. There's also no violation reporting, so a block would be silent.
- **Effect:** card entry, 3-D Secure or Apple/Google Pay could fail to load. The README already says 3-D Secure and wallets have never been proven in a real browser.
- **Fix:** add the domain, add a CSP report endpoint, and do one real test-mode checkout with a 3-D Secure card in a browser.

**Smaller platform items**
- **Fraud thresholds are public (Low).** `settlement_settings` is readable by anyone, including the amounts above which card verification or tracking is required (`20261006100000_payout_hold_setting.sql:50`). Fraudsters can price just under them. Expose only the columns the UI needs.
- **Search-suggestion endpoint has no rate limit (Low).** `src/app/api/explore/suggest/route.ts` is public, unthrottled, and runs four searches per request.
- **No page can be cached at the edge (Low, by design).** Every response is `no-store` (`src/proxy.ts:27`). Fine for launch, but launch-day traffic spikes will cost more.
- **Missing database indexes (Low).** Several foreign keys have none: `notifications.actor_id`, `transfer_intents.seller_id`, `activity_comments.author_id`, `reviews.reviewer_id`, `listing_questions.author_id`, `payment_recoveries.order_id`. `offer_rounds.buyer_id` is indexed only as the second column of `(listing_id, buyer_id)`. (Correction from Codex: `conversations.listing_id` was dropped in `20260928140000`, so it doesn't belong on this list.) Account deletion and "my offers" style queries will slow down as data grows.
- **Silent 1,000-row cap (Medium, recurring).** Supabase returns at most 1,000 rows per request, without saying so. Several pages count things by fetching every row and counting in the browser or server:
  - ratings, likes and questions on marketplace cards;
  - comments and reactions on posts;
  - follower counts on Home;
  - admin CSV exports.

  Those numbers will quietly go wrong once a popular item or member passes 1,000. Several "load everything I follow/saved" queries also put hundreds of IDs into one URL, which can exceed URL limits; the error is swallowed and the page shows as empty. Use database counts and aggregates, as some pages already do.

---

### 2.2 Sign-in, sign-up, onboarding, settings and account

**Open redirect in sign-in links (High, Checked: reproduced)**
- **What's wrong:** a link such as `drvn…/login?next=/%09/evil.com` sends a signed-in member to an outside website.
- **Why:** the redirect check (`src/lib/safe-redirect.ts`) blocks `//` and `/\` but not a tab character hidden in the middle. The browser's URL parser then strips the tab, leaving `//evil.com`. I ran it: `new URL("/\t/evil.com", "https://drvn.app/login")` gives `https://evil.com/`.
- **Effect:** a phishing email can use a genuine DRVN link to bounce members to a lookalike site.
- **Where:** the proxy redirect (`src/lib/supabase/proxy.ts:177-181`) is affected, and probably the `login` and `completeOnboarding` actions too.
- **Fix:** reject any control character or whitespace in `next`, or resolve it against the site origin and require the same origin. Add tests for `%09` and `%0a`.

**Anyone at a signed-in browser can change the password without knowing it (High, Checked)**
- **What's wrong:** `/login/reset` stays open to any signed-in session. Its action calls `updateUser({ password })` with no current password and no check that the session came from a reset email (`src/app/(auth)/actions.ts:318-331`).
- **Why it matters:** Settings deliberately asks for the current password; this page undoes that protection. Supabase's own "secure password change" setting is off in `supabase/config.toml:229`.
- **Effect:** someone at a shared computer, or with a stolen cookie, can lock the owner out.
- **Fix:** only allow the reset when the session was created by a recovery link (the `amr` claim), and turn on "Secure password change" in the hosted Supabase dashboard.

**B7. Account deletion keeps personal data for anyone who has traded (High, and a Blocker for a UK/EU launch; Traced)**
- **What's wrong:** anyone who has ever bought, sold or filed a report is parked in `operator_attention`.
- **What the worker removes:** it bans the login and removes posts, listings and cars.
- **What it keeps, indefinitely:**
  - the email;
  - the seller's ship-from and return address and phone;
  - messages, comments, follows and saved searches;
  - notifications.
- **Nothing finishes the job:** no admin screen or scheduled job completes the anonymisation; `operator_attention` appears only in the worker. The member is told deletion is "queued".
- **Saved cards are left behind too** *(Codex, Checked)*: the worker returns in this branch *before* reaching the step that deletes the member's Stripe customer (`account-deletion-worker.ts:104` returns ahead of `:121`). Former traders therefore keep their saved payment methods, contrary to the privacy page (`privacy/page.tsx:278`). This affects most marketplace users. The privacy page also says plainly that post-deletion retention and backup expiry are still undecided (`:272`, `:288`).
- **Where:** `src/lib/account-deletion-worker.ts:70-103`; `account_deletion_blockers` in `20260905185725_account_privacy_completion.sql`.
- **Fix:** in this path, delete or anonymise everything not needed for financial records straight away. Then decide a retention period for what remains, and add a scheduled final pass plus an admin view.

**Supabase's sign-in limit could lock everyone out on launch day (High, Needs a live test)**
- **What's wrong:** all sign-ins and sign-ups run on our server, so Supabase sees every visitor as coming from Vercel's few IP addresses. Its default limit is 30 sign-ins or sign-ups per 5 minutes per IP (`config.toml:209`), and a password change in Settings uses up to three of those.
- **Effect:** on a busy day, real members could all see "Too many attempts".
- **Fix:** raise the hosted project's limit (the app has its own per-person throttle), load-test login, and consider Supabase CAPTCHA.

**Usernames are only validated in the form (Medium, Traced)**
- **What's wrong:** the database's only rule on usernames is that they're unique, and that check is case-sensitive.
- **What that allows:** a member calling the API directly can register:
  - `Neil` alongside `neil`;
  - Unicode lookalikes;
  - spaces, or 1,000 characters;
  - `admin`, `support` or `drvn`.

  A deleted member's handle can also be reclaimed by someone else.
- **Effect:** impersonation of members and of staff.
- **Fix:** add a format check constraint, a unique index on `lower(username)`, a reserved-name list, and a tombstone for deleted handles.

**Other sign-in and account findings**

| Sev. | Finding | Plain effect | Where |
|---|---|---|---|
| Medium | Suspended members can't export or delete their data | Blocks a legal right | `request_account_export` / `request_account_deletion` raise "suspended" |
| Medium | "Continue with Google" during invite-only beta creates a login with no profile, which leads to a stuck onboarding loop | Visitor can never get in | `login-form.tsx:105-112`, `handle_new_user` |
| Medium | Delete account needs only "DELETE" typed; email change needs no password | Someone at an unlocked session can delete the account | `garage/actions.ts:1242`, `settings/account-actions.ts:33` |
| Medium | Sign-up has no app-level throttle or CAPTCHA | Bots can create accounts and send confirmation emails to strangers, damaging the sender reputation | `src/lib/rate-limit.ts` has no signup rule |
| Low | Banned users see "try again in a moment" | They retry forever | `actions.ts:53-74` |
| Low | Cancelling Google sign-in shows "link expired" | Confusing message | `callback/route.ts` |
| Low | Google-only members see a password form they can never use. Codex notes they *can* set one via "forgot password", so the problem is that nothing points them there | Confusing | `account-actions.ts:97` |
| Low | Email-change confirmation lands with no message. The email uses Supabase's own confirmation link, not `/confirm`, so test the real return path before choosing a fix | Member can't tell if it worked | `supabase/templates/email-change.html` |
| Low | The data export downloads as a JSON list of links that expire in 10 minutes | Ordinary members can't use it | `api/account/export/[id]/download` |
| Low | Supabase minimum password is 6 but the app requires 8 | Direct sign-ups can use weaker passwords | Hosted dashboard setting |
| Low | Raw Supabase error text is shown to users in several places | Unfriendly, and leaks internals | Several actions |
| Low | Login and sign-up have no `<main>` landmark | Screen-reader navigation | `(auth)/layout.tsx` |

**Looks solid:**
- Sign-in and reset throttles don't reveal whether an account exists.
- Email-confirm links can't be used up by mail scanners.
- Logout is POST-only and signs out globally.
- Beta invites are hashed and enforced by the database.
- Admin MFA step-up is enforced by the database.
- Security headers are strong: per-request CSP nonce, HSTS preload, `frame-ancestors 'none'`.

---

### 2.3 Explore, Home, Garage, posts, profiles, Saved and notifications

**Photos stay public after a post or car is deleted, or removed by a moderator (High, Traced)**
- **What's wrong:** deleting a car or post, or an admin's "Remove post", deletes only the database rows. The image files stay in public storage, and the clean-up job never revisits them. They're also served with a one-year cache.
- **Effect:**
  - Something DRVN took down as offensive or illegal is still reachable by anyone who has the link.
  - The delete dialog promises the photos are removed "permanently".
- **Where:** `garage/actions.ts:275-288` and `:1087`; `src/lib/admin/actions.ts:730`; `danger-zone.tsx:44`.
- **Fix:** after each delete, also delete the files (the helper `deleteMediaIfUnreferenced` exists; pass the owner id). Fix the dialog copy until then.

**Photos of "private" cars and unpublished drafts are publicly readable (High; Codex rates it a Blocker; Checked)** *(Codex)*
- **What's wrong:** the privacy page promises "a car marked private is visible only to you" (`privacy/page.tsx:137`). The car's photos, though, live in the public `car-images` bucket, readable by anyone (`0001_v3_schema.sql:380-386`). Draft listing photos are likewise in the public `listing-images` bucket, and uploads are cached for a year.
- **Effect:** anyone with the link can see a private car's photos, and making a car private doesn't take its photos back.
- **Fix:** either change the promise to cover only the page, or store private cars' photos privately and serve them through signed links, publishing a public copy only when the car goes public.

**Builds can't be reported, and members can't block anyone (Medium, Traced)**
- **What's wrong:**
  - Reports cover listings, users, posts and comments, but not cars.
  - A car's name, description and photos can only be dealt with by suspending the whole account.
  - There's no block or mute feature anywhere.
- **Fix:** add "car" as a report subject plus an admin "hide car" action, and plan a minimal block feature.

**Owners can attach image URLs from anywhere, bypassing upload checks (Medium, Traced; the server-side fetch impact needs a live test)**
- **What's wrong:** the check that a photo belongs to the member and went through our EXIF-stripping pipeline lives only in server actions. Directly through the database, an owner can set a car cover or gallery image to any URL, including another member's photo. The share-card image generator (`opengraph-image.tsx` for cars and posts) then fetches that URL from our server.
- **Fix:** add a database constraint requiring storage URLs under the owner's own folder, and validate the host before generating share images.

**Other social findings**

| Sev. | Finding | Plain effect | Where |
|---|---|---|---|
| Medium | Post pages load every comment and reaction | Counts and threads are wrong on busy posts; names show as "User" | `features/activity/load-engagement.ts:38-62` |
| Medium | The Following feed and Saved put every ID into one URL | Heavy users see an empty feed or empty Saved | `lib/feed.ts:983`, `saved/page.tsx:95` |
| Medium | Opening one notification clears the whole public cache | Slower site for everyone at launch traffic | `notifications/actions.ts:53` (`revalidatePath("/", "layout")`) |
| Low | Reaction and comment actions refresh whatever page path the browser names | A user can force cache flushes | `features/activity/actions.ts:56,64,95` |
| Low | Suspended members' posts without a car, their replies and their profile stay visible | Moderation gap | Post and comment read policies |
| Low | A car's activity tab shows only the 50 newest updates, with no "older" link | Long builds look truncated | `cars/[slug]/page.tsx:133` |
| Low | Notifications for deleted posts lead to a 404; saves of deleted items still count | Small inconsistencies | No clean-up triggers |
| Low | Everyone's notification settings are readable by the public | Minor privacy leak | `0017_lock_payment_columns.sql` (anon grant) |
| Low | Posts aren't in any sitemap, and Explore has no description or share image of its own. (Correction from Codex: cars and profiles *are* covered by the catalog sitemaps listed in `robots.txt`) | Lost SEO for posts | `src/lib/catalog-sitemap.ts`, `src/app/sitemap.ts` |
| Low | Upload errors are vague. HEIC is accepted by the server, but whether the deployed image library can decode iPhone photos needs a live test | Frustrating uploads | `quick-post.tsx:99` |
| High | **Saving an older Garage tab silently erases newer build-sheet changes.** The save replaces the whole sheet with no version check, so parts added in another tab or by the agent are deleted *(Codex, Traced)* | Lost build history | `save_mod_items` in `20261019100000_mod_items_stock_origin.sql:137,177` |
| Medium | **A failed showcase save wipes the old showcase.** Pins are deleted in one request and re-inserted in another, and the delete isn't rolled back if the insert fails *(Codex, Checked)* | Showcase lost | `garage/actions.ts:561-566` |
| Medium | Showcase pins can only be placed with a mouse or touch; there's no keyboard way *(Codex)* | Accessibility | `garage/[id]/edit/showcase-editor.tsx:103` |
| Medium | Saved page also cuts secondary collections at 100 items, with no way to see more *(Codex)* | Older saves disappear | `saved/page.tsx:54,118` |

**Looks solid:**
- Post and car ownership are enforced by the database.
- Publishing is safe to retry.
- Gallery edits are locked and capped.
- Uploads are re-encoded with EXIF/GPS stripped.
- Private cars are hidden properly.
- Reports are de-duplicated.
- There are no self-notifications.

---

### 2.4 Marketplace browsing and selling

**Sellers can edit any column of their listing directly (High, Traced; found by two reviewers)**
- **What's wrong:** the database lets a seller update any column on their own listing. Triggers protect status, price and currency, but not `created_at` or `view_count`, and nothing forces "an active listing has a photo" or "the seller has set up payouts". Sellers can also add gallery rows pointing at any image URL.
- **Effect:** a seller can:
  - pin their parts to the top of "Newest" forever by setting a 2030 date;
  - fake a public "views" number;
  - publish without photos or without payouts set up;
  - show images hosted anywhere, including tracking pixels.
- **Where:** `20261017140000_rls_initplan.sql:209-211`; `0001_v3_schema.sql:331`; `sell/actions.ts:346, 688`.
- **Fix:** use column-level update grants on `listings`, as already done for `profiles`. Add a trigger that freezes `created_at` and `view_count` and enforces the photo and payouts rules. Restrict image URLs to the seller's storage folder.

**"N sold on DRVN" can be faked (High, Checked)**
- **What's wrong:** the seller line on a listing counts listings with status `sold`, but sellers can mark their own listings sold ("Mark sold"). The real paid-sales count, `profile_sales_count`, already exists and isn't used here.
- **Effect:** a seller can invent a sales history that buyers rely on.
- **Where:** `src/app/(discover)/listings/[id]/page.tsx:266-271`.
- **Fix:** use `profile_sales_count`.

**A failed "create listing" can trap the seller, and the only way out loses the form (High; Codex rates it Medium since no money is lost; Traced)**
- **What's wrong:** the Sell form uses one request ID for its whole lifetime. The server records a claim with a fingerprint of the form, then refuses for a fixable reason. Any edit after that gets "Reload and try again", and reloading loses everything typed.
- **What triggers it:**
  - a location over 120 characters, which nothing checks before the database does;
  - shipping over $100,000;
  - the "set up payouts first" refusal, after which the suggested "save as draft" also fails;
  - any brief error followed by an edit.
- **Where:** `sell/actions.ts:299-375`; `sell-form.tsx:520`.
- **Fix:** discard the claim, or issue a new request ID, after every refusal. Validate location and shipping limits before claiming.

**Other marketplace findings**

| Sev. | Finding | Plain effect | Where |
|---|---|---|---|
| Medium | Saved-search alerts use the creation date, so a listing published from a draft never triggers an alert | Buyers miss parts, and drafted listings land deep in "Newest" | `api/jobs/saved-searches/route.ts:63` (add `published_at`) |
| Medium (Codex: Low) | `robots.txt` runs live database counts and returns an error if they fail | Google generally treats a failing robots.txt as "don't crawl", so a database blip can pause crawling | `src/app/robots.ts`, `sitemap-pages.ts` |
| Medium | Listing import "retry" and "paste fallback" have no limit | One account can run up unlimited AI and bandwidth cost | `sell/import/actions.ts:220-323` |
| Low | The import address check misses some IPv6 forms that can embed private addresses | Defence-in-depth gap | `listing-import/fetch/guard.ts:106` |
| Low | Deleting a listing silently deletes buyers' open offers | Buyer's offer vanishes without notice | `0001` cascade; `sell/actions.ts:720` |
| Low | Saved-search alerts have no frequency cap | Up to 48 alerts a day on broad searches | `saved-searches/route.ts:76` |
| Low | The store's `?listingsPage=`, `?reviewsPage=` and `?updatesPage=` accept `1.5` or `1e12` | Broken store page from an edited URL | `u/[username]/page.tsx:70-81` |
| Low | The share-preview fallback says "a used part off a real modified car" even for new parts | Misdescribes listings | `listings/[id]/page.tsx:86` |
| Low | `/fees` says "nothing is added at checkout", but DRVN Shipping calculates shipping at checkout *(Codex)* | Buyers may see shipping as a hidden charge | `(legal)/fees/page.tsx:109` |

**Looks solid:**
- Search queries are safely quoted, and hidden listings never leak.
- URL tampering is normalised.
- The seller's private offer minimum is truly private.
- Fitment and condition are consistently labelled "seller-stated".
- Listing edits are atomic and version-checked.
- Reserved and sold listings are frozen.
- The importer's protection against fetching internal addresses is strong.
- Sitemaps include public listings only.

---

### 2.5 Cart, checkout, orders, offers, messages and disputes

**B2. A buyer has no way out if the seller never ships (Blocker, Checked)**
- **What's wrong:** once paid, an order stays "paid" until the seller acts, and the buyer has no recourse:
  - Only the seller can cancel. The code says buyer self-cancellation was removed deliberately (`order-fulfillment-actions.ts:154-159`).
  - The buyer can only report a problem once the order has shipped (`dispute-command.ts:38`).
  - There's no dispatch deadline, auto-cancel or escalation job anywhere.
  - The order page just says "Waiting on dispatch" indefinitely.
  - Collection orders have the same gap.
- **Effect:** the buyer has no self-service option. They have to find a way to contact DRVN support, since an admin can force a refund (`src/lib/admin/actions.ts:157`, a correction from Codex), or file a card chargeback. Chargebacks cost DRVN money (see the chargeback note in 2.6) and damage trust.
- **Fix:** add a dispatch deadline, for example 5 business days. After it, let the buyer cancel for a full refund or open a "not dispatched" dispute, with a scheduled sweep that escalates or auto-refunds.

**B3. No sales tax; Terms are an unreviewed draft (Blocker for live money, Checked)**
- **What's wrong:**
  - Nothing computes, collects or remits tax.
  - The `/fees` page tells buyers "Nothing is added at checkout".
  - The Terms page source carries a note saying, in effect, it is not legal advice and must be reviewed by a solicitor before taking real payments (`(legal)/terms/page.tsx:29-36`).
- **Why it matters:** as a US marketplace taking payment, DRVN is likely a "marketplace facilitator" in many states.
- **Effect:** potential uncollected-tax liability on every sale.
- **Fix:** get a legal decision first. Then either Stripe Tax on the payment with a "Tax" line in totals, or a documented exemption. Have counsel review Terms, Privacy, Fees and Protection together.

**Checkout dead-ends after a reload or an address change, and parts stay locked for 15 minutes (High, Checked for the reload cause)**
- **What's wrong:** the checkout page generates a fresh request key on every render (`randomUUID()` at `(discover)/checkout/page.tsx:136`). After the address step has reserved the parts, a resubmit with a new key is refused, because the reservations it finds are the buyer's own. That happens after a reload, a guest re-render, or a changed address. (Codex rightly notes that switching to a banking app doesn't by itself cause a re-render; it does only if the page reloads.)
- **What the buyer sees:** "Nothing was available", or a cart showing "Someone else has this reserved" for parts they are holding themselves.
- **Related gaps:**
  - The cart page never shows the `?error=` messages it's sent.
  - A pending cart order's "Finish checkout" button opens the offer-checkout page, which rejects it.
  - Buyers are capped at 5 unfinished checkouts, and that refusal shows a generic error.
- **Where:** `checkout-actions.ts:574-579, 792`; `cart/page.tsx:27`; `orders/[id]/page.tsx:347`.
- **Fix:** make the key stable per cart (a cookie, or derived from the cart contents) so a reload resumes. Let "Edit address" release and restart. Route pending cart orders to `/checkout`, show "your checkout is holding this", and render errors.

**Guests can hold any listing for free, at scale (High, Traced; real-world throughput needs a live test)**
- **What's wrong:**
  - Guest checkout reserves parts for 15 minutes before any card is confirmed.
  - Each new email address creates a new guest account, which resets the per-buyer cap.
  - The only other limit is 10 checkouts per 10 minutes per IP.
- **Effect:** one script can keep hundreds of listings permanently "reserved" while creating junk accounts, so a competitor or troll can make a seller's parts unbuyable.
- **Fix:** for guests, reserve only after card confirmation (or use a much shorter hold), and add a per-listing or per-device cap plus CAPTCHA/Turnstile on guest checkout.

**Other checkout and order findings**

| Sev. | Finding | Plain effect | Where |
|---|---|---|---|
| Medium | The payment step's breakdown uses page-load numbers; if an item sold or a price changed meanwhile, the list and subtotal are wrong (a price rise even shows as "Shipping") | Totals don't add up, though the charge itself is correct | `checkout-actions.ts:737`, `checkout-totals.ts:42` |
| Medium | Disputes can be reopened after resolution, which resets the seller's clocks and overwrites the original reason. (Codex correction: refunds can never exceed what was paid, which the refund engine caps in `20261007100200:63`; the risk is repeated cases eating the remaining balance) | Repeated cases; the original record is lost | `dispute-command.ts:38-67` |
| High | **A one-cent refund offer stalls a dispute indefinitely.** While any refund offer is outstanding, the buyer can't escalate, the day-10 auto-refund skips the order, and the offer never expires. A daily SQL escalation to support remains as a backstop *(Codex, Checked)* | A seller can stonewall a legitimate claim | `dispute-actions.ts:79,341`; `payments/dispute-sla.ts:80` |
| Medium | **Re-generating a pickup pass can wipe a completed handoff record.** The pass is minted with a check-then-upsert that sets `redeemed_at = null`, outside the lock that redemption uses; a mint racing a redemption erases the proof *(Codex, Checked; needs exact timing)* | Lost proof of collection | `features/commerce/pickup-actions.ts:108-128` |
| Low | For $1,000+ orders, "mark shipped" calls the tracking provider before checking that the caller is the seller *(Codex, Checked)* | Anyone with a paid order ID can burn EasyPost quota | `order-fulfillment-actions.ts:45-58` |
| Medium | Delivery proof isn't tied to this order: a seller-entered tracking number isn't checked against the buyer's address or the sale date, so an old or unrelated delivered parcel could start the payout clock *(Codex, needs a live test)* | Possible early payout without delivery | `src/lib/shipping/apply-tracking.ts:54,194,388` |
| Low | Shipping quotes are unthrottled and open to anonymous callers | EasyPost quota and database growth | `shipping-quote-actions.ts:41` |
| Low | Accepted-offer checkout shows the hold as 24h from creation, not the real expiry | Wrong countdown | `orders/[id]/checkout/page.tsx:97` |

**Looks solid:**
- Reserving parts is atomic and race-safe.
- Payment amounts are always computed on the server.
- The Stripe return path re-checks ownership, amount and currency.
- The guest receipt cookie is signed.
- Offers are turn-based, rate-limited, and honour the agreed price.
- Message privacy is enforced by the database, including realtime.
- The pickup pass is single-use with a lockout.
- Reviews are one per order, only after delivery.
- Dispute evidence is in a private bucket.
- I found no "swap the order ID" holes in the actions checked.

---

### 2.6 Payments back-end, payouts and background jobs

**B5. The other party can delete your dispute evidence (Blocker, Checked; found independently by two reviewers)**
- **What's wrong:** the nightly media clean-up job deletes "staged" uploads that nothing references, using the all-access key and without checking who owns the file. Combined with three other gaps, one side of a dispute can register the other side's evidence file as their own stale upload, and the next job run deletes it:
  - Any member can insert a staged-upload row with any file URL directly through the database. The only check is that the row's owner is themselves (`0029_staged_media.sql`, latest policy `20261017140000:389`).
  - The job calls `deleteMediaIfUnreferenced(row.url)` with no owner (`api/jobs/media-gc/route.ts:52`), and accepts any bucket, including the private `dispute-evidence` bucket.
  - Dispute evidence is saved as a short path, but the "is this file in use?" check compares full URLs, so evidence never counts as in use (`20260905133224_media_reference_guard.sql`).
- **Effect:** someone can quietly erase the photos that decide a money dispute.
- **Fix:**
  - Remove direct client writes to `staged_uploads`; write only from the server and check the path starts with the member's own ID.
  - Pass the owner to the clean-up job.
  - Add `dispute_evidence.storage_path` to the reference check.
- **Also part of this blocker** (both reviews found it; Codex rates it a Blocker on its own): members can delete their *own* files straight from file storage, even when those files are order or dispute evidence (`0001:401`, `0024:182`). A seller can remove the listing photos a buyer's order snapshot relies on, and an uploader can withdraw evidence mid-case. Fix this at the storage policy, or keep separate, immutable copies of evidence.
- **Wider than dispute evidence** *(Codex)*: the "is it in use?" check compares the URL as typed, while deletion decodes it first. A URL with a percent-encoded character can therefore miss the match yet point to the same file, so even photos that *are* in use can be targeted. Compare canonical `(bucket, path)` pairs, not URL strings.
- **Also (Low)** *(Codex)*: the dispute-evidence bucket lets members upload to their own folder without an actual dispute existing.

**B9. Closing a dispute in DRVN releases the payout while a bank chargeback is still open (Blocker, Checked)** *(Codex)*
- **What's wrong:** when a buyer files a chargeback with their bank, the order is marked `disputed` and linked to the Stripe dispute (`20260905195518_provider_dispute_ordering.sql:105-110`). The buyer's "close dispute" action, and the admin's seller-resolution command, then put the order back to its earlier status without looking at the Stripe dispute (`dispute-actions.ts:283-301`). The payout job releases any order that is `delivered`/`completed` and past its hold date, without checking for an open chargeback either (`mark_due_transfer_intents`, latest in `0020_transfer_scheduling.sql:70-81`; `transfer-worker.ts:420`).
- **Effect:** the seller gets paid while the bank case is still running. If DRVN then loses the chargeback, it may not be able to claw the money back.
- **Fix:** keep chargebacks separate from in-app disputes. Refuse in-app close or resolve on orders with an open `stripe_dispute_id`, and have payout readiness and the transfer worker both refuse orders whose chargeback hasn't reached a final outcome. Test buyer close and admin resolve during a live test-mode chargeback.

**The worker health check will be red all day during normal trading (High, Checked)**
- **What's wrong:** every paid but undelivered order has a payout record "holding" with no release date yet. The health check falls back to the order's creation time, so 30 minutes after any purchase the transfers queue counts as "overdue" and `/api/health/workers` returns an error. Payouts blocked on sellers who haven't onboarded keep it red too.
- **Effect:** from the first sale, the monitor cries wolf round the clock, and a real outage gets ignored.
- **Where:** `worker_health_snapshot`, latest in `20261006100100_untracked_delivery_auto_confirm.sql:416-418`.
- **Fix:** leave out "holding with no release date" and "blocked, waiting on seller" from the overdue calculation, and don't count refunds still pending at Stripe as failures (`money-worker.ts:78`).
- **The reverse problem too** *(Codex)*: the health check doesn't cover several schedules, so it can report healthy while they've stopped. Missing are the agent job, the aggregate and search refreshes added in October (`20261011120000`, `20261011130000`, `20261020120000`), and chargebacks stuck in `loss_pending`. Keep one list of every scheduled job, and check each one's last run independently.

**Error reports drop the actual error on money paths (High, Checked)**
- **What's wrong:** `reportError` only unpacks an error passed on its own. Most money-path call sites pass it inside an object (`{ orderId, error }`), and an error's message and stack aren't copied when an object is serialised, so they come out as `{}` in both the logs and Sentry. About 25 call sites are affected, including the Stripe webhook, the transfer worker and the money worker.
- **Effect:** when a payment or payout fails, the alert says "handler failed" with no reason, so every incident starts blind.
- **Where:** `src/lib/monitoring.ts:141-151`.
- **Fix:** convert errors at any depth to `{ name, message, stack }` in `scrubTelemetry`, and add a test.

**Other payments findings**

| Sev. | Finding | Plain effect | Where |
|---|---|---|---|
| Medium | The `charge.refunded` handler expects a refund list inside the charge that current Stripe API versions don't include, so the per-refund step gets an empty list. The handler still runs its cumulative check, though (Codex correction), and a race can open false "unattributed refund" cases | Normal refunds occasionally create scary tickets an operator must close by hand | `payments/settlement.ts:172-189, 363-377`; tests mock the old shape |
| Medium | Transfer crash recovery searches only the platform's 1,000 most recent transfers | Past that scale, every Stripe hiccup turns a payout into a manual ticket | `transfer-worker.ts:228-272` (filter by destination) |
| Medium | A seller whose Stripe account is restricted at payout time burns 8 retries in about 4 hours, then lands in a manual queue; fixing their account doesn't release it. (Codex: a seller *already known* to be unpayable waits without using up retries and is released automatically; the problem is only when Stripe refuses unexpectedly) | Seller isn't paid until an operator runs SQL, and isn't told why | `transfer-worker.ts:176, 341-355` |
| Medium | Chargebacks: the seller's payout is only reversed when DRVN *loses* the dispute (60–75 days later), and the dispute fee is never passed on | DRVN funds every chargeback up front, and loses it if the seller has left | `20260905195518_provider_dispute_ordering.sql` |
| Medium | Stripe webhooks that keep returning "retry" aren't reported or monitored | A payment or dispute can silently never apply | `api/stripe/webhook/route.ts:69` |
| Medium | Orders of $1,000 or more can't be marked shipped unless DRVN Shipping (EasyPost) is live; the switch isn't on the go-live checklist | $1,000+ orders get stuck | `20261009100000:68` (`tracking_required_from_cents`) |
| Medium | Money logic with no unit tests: auto-refund on dispute deadline, capture reconciliation, the money-worker pass, receipts | Riskiest code is least tested | `dispute-sla.ts`, `capture-reconciliation.ts`, `money-worker.ts`, `receipt-worker.ts` |
| Low | `CRON_SECRET` is compared with `!==` rather than a constant-time compare | Cheap hardening | `jobs/*/route.ts`, `health/workers` |
| Low | The runbook says "exactly nine" scheduled jobs; the migrations create 16 | The operator's check will look like a failure | `docs/production-runbook.md` §4 |
| Low | Payouts run about 48 an hour, and blocked rows can starve ready ones | Slow payouts at volume | `transfer-worker.ts:39` |
| Gap | There's no daily reconciliation of the whole ledger against Stripe | Drift is found only after something fails | — |

**Looks solid:**
- The webhook verifies signatures and records each event before applying it.
- Production refuses fake payments, and the boot checks validate live-money config.
- The Stripe API version is pinned.
- Captures are cross-checked on amount, currency and buyer.
- Transfers are leased, idempotent and recover after crashes.
- Refunds run as a state machine with exact cent rounding.
- The dispute journal handles out-of-order events.
- The alert outbox is durable.

---

### 2.7 AI agent

**B8. The agent's worker never runs (a Blocker if negotiation ships at launch; Checked)**
- **What's wrong:**
  - `src/app/api/jobs/agent/route.ts` is never scheduled; its own comment says "Not scheduled until A3a".
  - The database's worker scheduler would refuse the name `agent` anyway.
  - The worker also needs a database role and URL that must be set up by hand.
- **Effect:**
  - A seller turns on "Let DRVN handle offers" and nothing ever counters; tasks sit at "Working" forever.
  - Chat retention clean-up also never runs, so chats are kept beyond the 12 months the privacy page promises.
- **Fix:** add a migration that allows `agent` in the scheduler and schedules it, and put the role and URL setup on the launch checklist. Hiding negotiation alone isn't enough (Codex correction): chat retention clean-up runs from the same job (`src/lib/agent/sweeps.ts:22`), so the job needs scheduling whenever chat is live.

**Earlier chat messages go to the AI provider without redaction (High, Checked)**
- **What's wrong:** only the newest message is passed through `redactForModel`. The last 20 stored messages are sent as raw history (`src/features/agent/chat.ts:100-103`), and stored chat deliberately keeps VINs, emails and phone numbers.
- **Effect:** the privacy page (`privacy/page.tsx:170`) says these are removed before sending to the AI, which stops being true from the second message.
- **Fix:** redact each history message too, and add a test.

**The Agent page says it "never accepts for you", but the buyer's agent does (High, Traced)**
- **What's wrong:** the buyer agent accepts any seller counter within the member's maximum, which creates a real order awaiting payment (`negotiate.ts:178`). The `/agent` page footer and first-run tile say it never accepts (`agent/page.tsx:268, 280, 338`). The Terms are worded correctly.
- **Fix:** reword it, for example: "Selling, it asks before accepting. Buying, it accepts counters within your max."

**Beta gating exists only in the app (High, Traced)**
- **What's wrong:** any signed-in member can switch on the buyer agent directly through the database (`agent_mandate_set` is callable by every member), even while that beta step is closed, and without the binding acknowledgement. Closing a beta step in admin hides the controls but doesn't stop agents already running.
- **Fix:** check the beta step and the acknowledgement inside `agent_mandate_set` and `agent_claim_jobs`, and say in the admin UI what closing a step does.

**Other agent findings**

| Sev. | Finding | Plain effect | Where |
|---|---|---|---|
| Medium | The spend cap can be exceeded: usage is recorded only after a turn succeeds; parallel turns all pass the check; an unpriced model id makes the cap never trip | AI costs run past caps unnoticed | `src/lib/ai/run.ts:195, 284-306`; `ai/config.ts:54` |
| Medium | No timeout on a chat turn (SDK default is 10 minutes with 2 retries; up to 8 tool rounds) | Long hangs, then errors, then duplicate messages | `ai/client.ts:13` |
| Medium (Codex: High) | The agent can read order threads, where buyers type delivery addresses; the redactor doesn't detect postal addresses (`ai/redact.ts:10`) | A home address can reach the AI provider, contrary to the data rules doc | `capabilities/reads.ts:243-251` |
| Medium (Codex: Low) | Three of the five starter prompts have no working tool behind them. "What's my agent doing?" has no tool at all; comparables and fitment evidence are placeholders that always answer "not enough evidence", and the system prompt tells the model not to guess | Feature looks broken | `agent-chat.tsx:18`, `capabilities/reads.ts:131-168` |
| Medium | Prompt injection in a listing could make the agent draft a build change with a malicious or data-carrying link; the confirm card doesn't show the URL | One tap publishes a bad link on the member's car page | `capabilities/build.ts:91,124` |
| Medium | `/admin/agent` doesn't check admin access itself (same issue as B4) | Possible exposure of spend and kill-switch data | `admin/agent/page.tsx:47` |
| Low | No "clear chat" button, though the data rules promise one | — | `agent_clear_conversation` unused |
| Low | Chat isn't announced to screen readers; the input loses focus while sending | Accessibility | `messaging.tsx:17`, `chat-composer.tsx:112` |
| Low (Codex: Medium) | Suspended members can still chat and spend AI budget | — | `sendAgentMessage` (`features/agent/chat.ts:66`) |
| Low | Approving on an already-expired offer is recorded as "accepted" | Skews the agent's metrics | `agent_worker.sql:1213` |

**Looks solid:**
- Prices come only from deterministic rules, never from the model.
- The price floor is enforced in the database.
- The seller's agent can never accept on the seller's behalf.
- The worker has its own restricted database role and idempotent moves.
- Kill switches wait for in-flight work.
- Untrusted content is fenced off from instructions.
- Logs hold IDs and counts, never chat text.
- The default model is current (`claude-opus-5-5`).

---

### 2.8 Admin console and operations

**B4. Admin pages rely on the layout for access control, and read with the all-access key (Blocker, Checked in code; exploitability needs a live test)**
- **What's wrong:**
  - The only access check for most `/admin` pages is in `src/app/(admin)/layout.tsx:40`.
  - The pages themselves read user, order, payment and audit data with the all-access key (`src/lib/admin/queries.ts`).
  - Only `cases`, `invitations` and `agent` pages call the guard, and `agent` doesn't act on the result.
- **Why it matters:** the Next.js documentation shipped with this project warns that layouts don't re-run on client navigation, so access checks belong near the data (`node_modules/next/dist/docs/01-app/02-guides/authentication.md:1352`). A hand-crafted navigation request may get the page without the layout's check. Separately, a removed admin, or one whose 15-minute MFA has lapsed, can keep browsing client-side.
- **Fix:** call the admin guard inside the read layer (every exported function in `queries.ts`, or a `requireAdminRead()` used by every page), and also gate `/admin` and `/docs` in the proxy. Admin *actions* already re-check correctly.

**B6. No production or staging project, no backups, and no restore rehearsal (Blocker, Checked)**
- **What's wrong:** per `docs/staging-setup.md`, the Supabase organisation is on the Free plan with no project slot. Point-in-time recovery needs a paid plan, and the hosted restore row in the runbook is "Pending".
- **Effect:** if the production database is damaged at launch, there may be nothing to restore orders and payments from.
- **Fix:** move to a paid plan with point-in-time recovery, build staging, and run and record a hosted restore before inviting anyone.

**One wrong command can wipe the database (High, Traced; found by two reviewers)**
- **What's wrong:** migration `0001` drops every table in the `public` schema, which is where all of DRVN's members, orders and payments live. The runner `scripts/apply-migration.mjs` will run any file against whatever `.env.local` points to; in this checkout, that's the shared dev project.
- **What the runner lacks:** confirmation, a target allow-list, "refuse 0001 on a non-empty database", and automatic history recording.
- **Further issues:**
  - The runner turns off TLS certificate checking.
  - The README says every migration is idempotent; 0001 is not.
- **Fix:**
  - Make 0001 raise an error if `profiles` or `orders` exist.
  - Require `--project <ref>` plus a typed confirmation.
  - Record history automatically, and turn TLS verification back on.

**CI doesn't actually gate deploys (High, Checked in docs)**
- **What's wrong:**
  - Branch protection isn't on (it needs GitHub Pro), and nothing ties a Vercel production deploy to a green `release-gate`.
  - Nothing checks that the database has every migration the new code expects.
- **Effect:** code that failed tests, or code needing an unapplied migration, can go live.
- **Fix:** enable branch protection (`scripts/owner/branch-protection.sh`), make production deploys wait on CI, and add a health check comparing the expected latest migration with the database.

**Other admin and ops findings**

| Sev. | Finding | Plain effect | Where |
|---|---|---|---|
| High | Finance CSV exports silently stop at 1,000 rows, and name lookups may fail on long ID lists | Accountants reconcile against an incomplete file | `admin/export/route.ts`, `queries.ts:204, 389, 1417`. The "Sellers"/"No payouts" user filters break the same way |
| Medium | A failed admin refund locks refunds on that order until someone reconciles it by hand (at least 15 minutes), even for harmless refusals | Support can't retry a refund | `src/lib/admin/audit.ts:71-86`, `actions.ts:178` |
| Medium | Exports aren't audited. The read-only "viewer" role can also export, which is consistent with its read access by design (Codex), so whether to restrict that is a policy choice | No record of who downloaded member data | `admin/export/route.ts:48` |
| Medium | A new admin's authenticator is set up first-come after a password sign-in | A stolen password for a new admin gives full console control | `admin-verify/page.tsx` (enrol before granting admin) |
| Medium | No uptime monitoring or paging; worker staleness only reaches a GitHub email | The site or payouts could be down for hours unnoticed | `.github/workflows/worker-monitor.yml`, `lib/admin/alerts.ts` |
| Low | Audit page shows "No actions recorded" on a database error; a user detail error shows a 404 | Misleading during an outage | `queries.ts:1018, 1417` |
| Low (Codex: High until rotation is confirmed) | A test admin password is committed in `.page-test.mjs`. The e2e README says the account has MFA | Rotate the password now; deleting the file doesn't remove it from git history. Then delete the file and add `/.*.mjs` to `.gitignore` | `.page-test.mjs:5` |
| Low | Bulk "actioned" report copy says "We took action" when nothing was removed; removing a post leaves sibling reports open | Misleading moderation messages | `lib/admin/actions.ts:108, 731` |
| Low | CI jobs don't restrict their GitHub token permissions | Hardening | `.github/workflows/ci.yml` |

**Looks solid:**
- Every admin *action* re-checks admin, MFA and role, and the database checks again.
- The audit log is append-only.
- CSV formula injection is handled.
- Suspension takes effect immediately in the database.
- Webhook replay is verified and requires a reason.
- No live secrets are in git, and gitleaks runs in CI.
- CI coverage is broad: SQL guards, e2e, and Stripe test mode.

---

### 2.9 Second opinion: Claude vs Codex (GPT)

**How it was done.** Codex CLI (`codex exec`, read-only sandbox, high reasoning effort, the user's default GPT model) ran twice:
1. **Independent review:** it covered all 106 `page.tsx`/`route.ts` files and the code and migrations behind them. It was told not to open this report, and its run log confirms it never did.
2. **Check of this report:** it went through every finding and gave a verdict of *confirmed*, *partly right*, *wrong* or *unverifiable from code*.

I then re-checked every new Codex finding against the code before adding it here.

**Overall verdict: the two reviews agree.** Both conclude DRVN is *not ready for real members or payments yet*, and for the same core reasons:
- money safeguards that can be bypassed;
- evidence that can be deleted;
- incomplete account deletion;
- rules enforced only in the app;
- unfinished legal and retention decisions;
- operations gaps.

**What Codex's check of this report found:**
- **Confirmed:** most findings, including every code-level Blocker (B2, B4, B5) and most Highs.
- **Partly right:** about 25 items; the details are corrected above. The main corrections:
  - an admin *can* already force-refund (B2);
  - cars and profiles *are* in the catalog sitemaps;
  - `conversations.listing_id` no longer exists;
  - repeat disputes can't refund more than was paid;
  - the store's page parameters have different names;
  - 0001 drops the `public` schema only;
  - the `charge.refunded` handler still runs its cumulative check;
  - the agent job still needs scheduling even if negotiation is hidden.
- **Wrong:** none outright.
- **Unverifiable from code:** about 10 items, because they depend on hosted state Codex couldn't see offline: npm advisories, backups, branch protection, hosted Auth limits, uptime monitoring. I ran the audit myself and have added the advisory IDs to B1. The rest stay on the launch checklist as "confirm in the hosted environment".
- **"Looks solid" claims it narrowed:**
  - "Reserved listings are frozen" and "gallery edits are locked" hold only for the official database function; direct table writes bypass both.
  - "Private cars are hidden" covers the page, not the photo files.
  - The Stripe API version is pinned indirectly, through the SDK version, so an SDK upgrade can change it.
  - "Production refuses fake payments" has an explicit sandbox override that must be absent in production.

**Found only by Codex (added above, each re-checked by me):**

| Finding | Codex severity | Mine | Where in report |
|---|---|---|---|
| In-app dispute close releases payout during an open bank chargeback | Blocker | Blocker (B9) | 2.6 |
| Uploaders can delete evidence straight from storage (I had this as Medium) | Blocker | Blocker (part of B5) | 2.6 |
| URL encoding lets the clean-up job delete files that are in use | Blocker | Blocker (part of B5) | 2.6 |
| Private-car and draft photos are publicly readable | Blocker | High | 2.3 |
| A token refund offer blocks escalation and auto-refund | High | High | 2.5 |
| Stale Garage tab erases newer build-sheet changes | High | High | 2.3 |
| Deletion skips saved-card (Stripe customer) clean-up for former traders | High | High (part of B7) | 2.2 |
| Health check misses several schedules and stuck chargebacks | High | High | 2.6 |
| Delivery proof not tied to destination or sale date | High (needs live test) | Medium | 2.5 |
| Pickup-pass mint can erase a redemption | High | Medium | 2.5 |
| Showcase save not transactional; pins not keyboard-accessible | Medium | Medium | 2.3 |
| Tracking provider called before seller check | Medium | Low | 2.5 |
| `/fees` "nothing added" vs calculated shipping | Low | Low | 2.4 |

**Found only by Claude (Codex's independent pass missed them, but its check of this report confirmed them):**
- **Security:**
  - admin pages relying on the layout check (B4), which Codex confirmed and rated a Blocker;
  - the open redirect;
  - the media clean-up job deleting without checking the owner (B5's first half);
  - fake "N sold" counts.
- **Monitoring:**
  - the health check stuck red;
  - error details lost in Sentry.
- **Checkout and abuse:**
  - checkout reload dead-ends;
  - guest reservation abuse;
  - Supabase auth rate limits;
  - username rules;
  - most of the social-feature rate-limit and photo-retention items.
- **Agent:** the agent copy, the beta gate and the spend cap.
- **Release process:** the migration-runner wipe risk and the CI gating gap.

The two passes overlap only partly, which is the case for doing both.

**Where we still differ, and why:**
- **Private photos:** Blocker (Codex) vs High (me). It breaks a promise on the privacy page, but there's a cheap stopgap: reword the promise before launch. If the promise stays, treat it as a Blocker.
- **Pickup race:** High (Codex) vs Medium (me). It needs a re-mint at the same instant as a redemption, and it loses a record, not money.
- **Sell-form trap:** High (me) vs Medium (Codex). It's a core seller flow, and the seller loses everything they typed. Either rating is defensible.
- **B1 dependencies:** Codex says "conditional", because it couldn't fetch advisories. `npm audit` lists them, so I keep it as a Blocker.

---

## 3. Before-launch checklist (manual steps that are easy to forget)

Pulled from the runbook and the findings above:

1. ~~Upgrade Next.js, undici and zod (B1).~~ Done 7 Nov 2026 (PR #65).
2. Paid Supabase plan with point-in-time recovery; staging and production projects created; hosted restore rehearsed and recorded (B6).
3. Seed migration history on the new project, never `db push`, and guard 0001 first.
4. Raise Supabase Auth rate limits. Turn on "Secure password change" and "Secure email change". Set the minimum password length to 8.
5. `job_config` rows for the worker URL and `CRON_SECRET`; confirm all 16 pg_cron jobs, not nine.
6. Stripe:
   - webhook endpoint plus the separate Connect endpoint and `STRIPE_CONNECT_WEBHOOK_SECRET`;
   - Radar 3-D Secure rule;
   - negative-balances script on existing accounts;
   - one real test-mode checkout with 3-D Secure and a wallet in a browser.
7. Decide `tracking_required_from_cents`: set it to null unless DRVN Shipping is live.
8. Agent: either schedule the worker and provision its database role and URL, or keep negotiation hidden (B8).
9. Monitoring:
   - Sentry DSN and alert routing;
   - `ADMIN_ALERT_WEBHOOK_URL`;
   - `DRVN_MONITOR_*` variables;
   - an external uptime check.
10. Branch protection plus deploys gated on CI.
11. Legal: counsel review of Terms, Privacy, Fees and Protection; sales-tax decision (B3); a GDPR plan for deletion (B7).
12. Rotate the test admin password in `.page-test.mjs`.
13. Once live: one real refund, one real payout and one real dispute, end to end, before opening the doors.
14. Beyond the happy path, test *(from Codex's review)*:
    - interrupted checkout;
    - an unshipped paid order;
    - an in-app dispute closed during a test-mode chargeback;
    - a rejected or nominal refund offer;
    - a restricted seller at payout time;
    - deleting a former trader's account, including saved cards;
    - anonymous access to private-car and draft photos;
    - direct member-token calls to the database and file storage for every "app-only" rule in this report.
15. Rehearse restoring storage files and reconciling Stripe after a database restore. A database restore alone doesn't bring back deleted photos or undo money already moved.
16. Check the scheduler by job name and last successful run, not by a count of jobs. Stop each job deliberately once and confirm an alert fires.

---

## 4. Suggested order of work

0. **Start now, in parallel with code fixes:** paid Supabase plan, staging, backups and a tax/legal decision. These are prerequisites, not a final phase (Codex's point, and a fair one).
1. **This week (small, high-value):**
   - ~~dependency upgrades (B1);~~ done 7 Nov (PR #65);
   - open-redirect fix;
   - password-reset check;
   - media-gc owner fix, `staged_uploads` lockdown and storage delete policies for evidence (B5);
   - chargeback hold on in-app dispute close and payouts (B9);
   - admin guard in the read layer (B4);
   - nested error reporting fix;
   - health-check overdue fix;
   - "sold on DRVN" count;
   - agent history redaction and copy;
   - guard migration 0001;
   - rotate the committed test password.
2. **Database-level rules:**
   - move rate limits, the listing column freeze and the photo/payout publish rules, and image URL checks into the database;
   - add username constraints;
   - add the agent beta gate.
3. **Buyer safety nets:**
   - dispatch deadline with buyer cancel or dispute (B2);
   - stable checkout key and error display;
   - guest reservation limits;
   - one dispute per order.
4. **Admin hardening:** paginated exports, audited exports, refund-lock fix, an expiry on refund offers, and a buyer "reject offer" action.
5. **Infrastructure and legal:** paid Supabase plan, staging, backups, CI gating, uptime monitoring, tax and legal review, deletion completion.
6. **Then the Medium and Low items**, area by area.

---

*Review method:*
- *Eight parallel read-only Claude reviews by area: sign-in and account; social and garage; marketplace and selling; buying and orders; payments back-end; AI agent; admin and ops; database security and cross-cutting. Each traced the current code and the latest migration definitions.*
- *Two read-only Codex (GPT) passes: one independent review of every route, and one check of this report.*
- *Every Blocker, and every finding added from Codex, was re-checked by hand.*

*Nothing in the project was modified other than adding this file.*
