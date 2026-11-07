# Email delivery for Supabase Auth

DRVN sends no email of its own. Every email a member or guest gets comes from
Supabase Auth: signup confirmation, password reset, email change, and the
guest order-access link (`deliverOrderAccessLink` in
`src/features/commerce/guest-buyer.ts`, called by the receipt worker
`src/lib/receipt-worker.ts`). Supabase's built-in sender is rate-limited to a
handful of messages an hour and is not meant for real recipients, so staging
and production need **custom SMTP**.

Beta invitations are not emailed by the app. Admin → Invitations shows a
`/signup?invite=…` link, and the admin sends it by hand
(`src/app/(admin)/admin/invitations/actions.ts`). Supabase's "Invite user"
email is never used.

Steps marked **[OWNER]** need the owner's accounts, payment or DNS access.
**[ENGINEER]** steps can be done by an engineer with shared credentials.

---

## 1. What Supabase needs

Custom SMTP in Supabase takes six values. Every provider below gives you all
of them:

| Supabase field | What goes in it |
|---|---|
| Sender email | an address on your verified domain, e.g. `no-reply@<domain>` |
| Sender name | `DRVN` |
| Host | the provider's SMTP host |
| Port number | `587` (STARTTLS). Use `465` only if the provider says so |
| Username | provider-specific (below) |
| Password | an SMTP credential or API key. Store it in the password manager |
| Minimum interval between emails | leave the default (60 s per user) |

The provider must have verified the sending domain (DKIM at least) before it
will accept mail from that address.

## 2. Choosing a provider [OWNER]

All three work with Supabase. Prices change; check the provider's pricing page
before deciding. The figures below are rough, from public pricing as last seen,
and are not quotes.

| | Postmark | Resend | Amazon SES |
|---|---|---|---|
| Built for | Transactional mail only (separate stream for bulk) | Developer transactional mail | General-purpose, high volume |
| Deliverability | Strong reputation for transactional mail; refuses bulk/marketing on the transactional stream | Good; runs on Amazon SES infrastructure | Good once warmed up; your reputation is your problem |
| Price at low volume | Small free test allowance; paid plans from about $15/month for 10k emails | Free tier around 3k emails/month (100/day); paid from about $20/month | About $0.10 per 1,000 emails; no monthly minimum |
| Setup effort | Low | Low; Supabase has a Resend integration | Higher: starts in a sandbox (only verified recipients) until you request production access, which AWS reviews; IAM SMTP credentials; region-specific host |
| SMTP host | `smtp.postmarkapp.com` | `smtp.resend.com` | `email-smtp.<region>.amazonaws.com` |
| Username / password | Server API token for both | `resend` / an API key | IAM SMTP username / SMTP password (generated in the SES console, not your AWS keys) |
| DNS it asks for | DKIM TXT (`<selector>pm._domainkey`), Return-Path CNAME (e.g. `pm-bounces` → `pm.mtasv.net`) | DKIM TXT (`resend._domainkey`), MX + SPF TXT on a `send` subdomain | 3 DKIM CNAMEs (`<token>._domainkey` → `<token>.dkim.amazonses.com`), optional custom MAIL FROM subdomain (MX + SPF TXT) |
| Bounce handling | Built in; suppresses hard bounces | Built in | You must watch bounce (<5%) and complaint (<0.1%) rates or AWS pauses sending |

**Suggestion, not a decision:** Postmark or Resend. Volume in an invited beta
is tiny, the emails are all sign-in critical, and both need less setup than
SES. SES is cheapest at volume but needs more care. Whichever you choose,
the privacy policy has to name it (`docs/legal-review-checklist.md`, "Name the
remaining processors"), and you need its data processing agreement.

## 3. DNS records [OWNER]

Do this at your DNS host for the sending domain. The provider's dashboard
shows the exact values; copy them, don't retype.

1. **DKIM.** Add exactly the record(s) the provider shows. This is what proves
   the mail is yours.
2. **Bounce / return-path domain** (Postmark Return-Path, Resend `send`
   subdomain, SES custom MAIL FROM). Add it. It makes SPF align with your
   domain, which DMARC needs.
3. **SPF.** A domain may have only **one** SPF TXT record per name. If the
   provider puts SPF on its own subdomain (all three can), you don't need to
   touch the root SPF. If you also send from the root domain (e.g. a mailbox
   provider for `hello@`), keep that provider's `include:` in the root record;
   merge, never add a second `v=spf1` record.
4. **DMARC.** Add a TXT record at `_dmarc.<domain>`:
   ```
   v=DMARC1; p=none; rua=mailto:dmarc-reports@<domain>; adkim=r; aspf=r
   ```
   Start with `p=none` and read the reports for two to four weeks. When only
   your providers appear and they pass, move to `p=quarantine`, then
   `p=reject`. The `rua` mailbox must exist (or use a DMARC report service).
5. Wait for the provider to show the domain as verified.

## 4. Supabase settings [OWNER clicks, ENGINEER can drive]

In the staging (then production) project:

1. **Authentication → Emails → SMTP Settings**: turn on custom SMTP, fill in
   the fields from §1, save.
2. **Authentication → Rate Limits → Rate limit for sending emails**: the
   default after enabling custom SMTP is low (about 30 an hour, project-wide).
   Raise it to what the beta needs (e.g. 100/hour), within the provider's
   limits.
3. **Authentication → Providers → Email**: Confirm email **on**, Secure email
   change **on**, Email OTP expiration **3600** seconds. The templates say "one
   hour"; if you change the expiry, change the wording.
4. **Authentication → Emails → Templates**: paste each file's contents and
   subject:

   | Dashboard template | File | Subject |
   |---|---|---|
   | Confirm signup | `supabase/templates/confirm-signup.html` | Confirm your email for DRVN |
   | Magic Link | `supabase/templates/magic-link.html` | Your DRVN order access link |
   | Change Email Address | `supabase/templates/email-change.html` | Confirm your new DRVN email |
   | Reset Password | `supabase/templates/recovery.html` | Reset your DRVN password |
   | Invite user | leave default (not used) | |
   | Reauthentication | leave default (not used: the app never calls `reauthenticate()`, and secure password change is off) | |

   `supabase/config.toml` wires the same files for the local stack, so local
   mail (Mailpit on port 54324) matches.
5. **Authentication → URL Configuration**: Site URL and redirect allowlist as
   in `docs/staging-setup.md` §3. The templates build links from
   `{{ .SiteURL }}`, so the Site URL must be the real origin.

## 5. How each link works

Checked against the code on 4 October 2026; signup and reset moved to token
links on 8 October, the email change on 24 October. Every link lands on
`/confirm` with a token hash. `/confirm` shows a button, and pressing it verifies the
token (`src/app/(auth)/confirm/route.ts`), so the email can be opened in any
browser or on any device, and a mail scanner that only fetches the link does
not use it up.

| Email | Sent by | Link | Lands on |
|---|---|---|---|
| Confirm signup (member) | `signUp` in `src/app/(auth)/actions.ts` | `{{ .SiteURL }}/confirm?token_hash=…&type=email&flow=signup&redirect_to={{ .RedirectTo }}` | `/confirm` → signed in → onboarding for a new account, then the page they were on (taken from `redirect_to`'s `next`, same-origin paths only) |
| Reset password | `resetPasswordForEmail`, same file | `{{ .SiteURL }}/confirm?token_hash=…&type=recovery` | `/confirm` → `/login/reset` with a recovery session |
| Change email | `updateUser({ email }, { emailRedirectTo })` in `src/app/(product)/settings/account-actions.ts` | `{{ .SiteURL }}/confirm?token_hash=…&type=email_change&redirect_to={{ .RedirectTo }}`, sent to both old and new address | `/confirm` → `/settings?changed=email` (only a Settings path is accepted), with a notice: "One link confirmed" until both links are opened, then "Sign-in email updated" |
| Guest order access | `signInWithOtp` in `deliverOrderAccessLink` | `{{ .SiteURL }}/confirm?token_hash=…&type=…&next=%2Forders` | `/confirm` → `/orders` |
| Guest auto-confirm warning | the transfers job (`src/lib/auto-confirm-email.ts`) | the guest order access email, with a paragraph giving the date | `/confirm` → `/orders` |

The templates must be the ones in `supabase/templates/`. With Supabase's
default templates (`{{ .ConfirmationURL }}`) signup and reset links go back to
working only in the browser that asked.

### Known gap: guest order links with Confirm email on

Read this before the guest test in §6.

A guest checkout creates an **unconfirmed** account (`email_confirm: false`,
`user_metadata.drvn_guest = true`). When `signInWithOtp` is called for an
unconfirmed user and Confirm email is **on**, Supabase Auth sends the
**Confirm signup** email, not the Magic Link email. With Confirm email off
(dev, CI) it sends the Magic Link email, which is why tests pass. This is
inferred from Supabase Auth's (GoTrue) magic-link handler, not observed on a
hosted project. Confirm it with the staging test in §6.

So `confirm-signup.html` has a branch for `{{ if .Data.drvn_guest }}` that
writes the order-access link. That link uses `type=email`: a signup token is
not a magic-link token, and verifying it as `magiclink` fails. `/confirm`
accepts both.

Side effect to know about: someone who signs up normally with an address
that already has an unconfirmed guest account also gets the guest branch.
Their link still confirms the address and signs them in.

## 6. Test checklist (staging, then production)

Use a real inbox you control at Gmail and one at Outlook. Check the inbox, not
spam, every time. For each email, check the From name and address, the
subject, that the link's host is the site origin, and that it works once.

- [ ] **[OWNER]** Domain shows verified at the provider; DKIM, return-path and
      DMARC records resolve (`dig TXT _dmarc.<domain>`, `dig TXT <selector>._domainkey.<domain>`).
- [ ] **[OWNER]** Signup confirm: sign up with an invitation link. Email
      arrives within a minute. Open it in the **same** browser → "Confirm
      and continue" → signed in (onboarding for a new account). Then repeat
      with a second address and open the link on your phone → the same:
      signed in on the phone.
- [ ] **[OWNER]** Password reset: `/login` → forgot password. Open the
      email on a different device from the one you asked on → "Choose a new
      password" → `/login/reset` → set a new password → signed in. Open the
      same link again → error, as expected.
- [ ] **[OWNER]** Guest order link: in a private window, buy something as a
      guest with a fresh address. Within ten minutes (the receipt worker runs
      in the transfers pass) an email arrives. Open it → "Continue to orders"
      → `/orders` shows the order. Record which template arrived (subject
      "Confirm your email for DRVN" or "Your DRVN order access link").
- [ ] **[OWNER]** Magic link proper: buy as a guest again with the address
      from the previous test, after it is confirmed. Note: a confirmed
      address is refused at guest checkout ("sign in to buy with it"), so this
      template is reached only for accounts that were confirmed some other
      way. If you can't reach it, note "not reachable" in the evidence.
- [ ] **[OWNER]** Email change: Settings → change email. Both the old and new
      inbox get "Confirm your new DRVN email". Open the first → "Confirm the
      change" → Settings with "One link confirmed". Open the second →
      Settings with "Sign-in email updated" and the new address; signing in
      with the new address works.
- [ ] **[OWNER]** Password change: Settings → change password → the bell
      shows "Your password was changed". (Supabase's own password-changed
      email is a separate project setting, off by default; DRVN's notice
      doesn't depend on it.)
- [ ] **[OWNER]** Headers: in Gmail, "Show original" on one email → SPF,
      DKIM and DMARC all `PASS`.
- [ ] **[ENGINEER]** Save screenshots and the "Show original" headers as
      evidence for the `invitation-boundaries` and `privacy` gates
      (`docs/staging-setup.md` §13).
