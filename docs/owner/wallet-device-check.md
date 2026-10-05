# Apple Pay and Google Pay: real-device check

Round four unblocked wallets: the `Permissions-Policy` header used to say
`payment=()`, which stopped Stripe's Payment Element from offering Apple Pay
and Google Pay at all. It now says `payment=(self "https://js.stripe.com")`
(`next.config.ts`). No automated test can open a real wallet, so a person
with a phone has to check it on staging before the beta. About 30 minutes,
plus domain registration.

Everything here runs in **Stripe test mode**. A real card in your Wallet is
safe: Stripe test mode turns it into a test card and nothing is charged.

## How wallets reach checkout

- Checkout and Settings → Payment methods both use Stripe's Payment Element
  (`src/app/(discover)/cart/payment-confirm.tsx`,
  `src/app/(product)/settings/payment-methods.tsx`) with no `wallets` option,
  so wallets are on "auto": shown when the browser, device and domain allow.
- The PaymentIntent is created with `payment_method_types: ["card"]`
  (`src/lib/payments/stripe.ts`). Apple Pay and Google Pay are card wallets,
  so that is enough.
- The page's CSP (`src/proxy.ts`) allows Stripe: `script-src` and `frame-src`
  include `https://js.stripe.com`, `frame-src` includes
  `https://hooks.stripe.com`, `connect-src` includes `https://api.stripe.com`.
  The wallet sheet itself runs inside Stripe's frame, so DRVN's CSP doesn't
  apply inside it.

## 1. Register the staging domain with Stripe [OWNER, 10 minutes]

Payment Element only shows Apple Pay and Google Pay on domains registered
with Stripe as **payment method domains**.

1. Stripe Dashboard, switch to **test mode** (the staging keys are test keys).
2. Settings → Payments → **Payment method domains** → Add a new domain.
3. Enter the exact host that serves checkout, e.g. `staging.<domain>`. No
   `https://`, no path. `www.` and the bare domain are separate entries;
   register each one people can reach checkout on.
4. The domain row shows a status per wallet. Apple Pay and Google Pay should
   read as enabled/verified.
5. If Apple Pay asks you to host a **domain association file**, it has to be
   served at
   `https://staging.<domain>/.well-known/apple-developer-merchantid-domain-association`.
   The repo doesn't serve that file today. That would be a small code change
   (a file under `public/.well-known/`), for the engineer. Recent Stripe
   accounts usually verify Apple Pay without it; check what the Dashboard
   says rather than adding the file pre-emptively.
6. Do the same in **live mode** for the production domain before live
   launch. Don't assume a test-mode registration carries over; check the
   live-mode list.

Also check Settings → Payment methods: Apple Pay and Google Pay are on. With
an explicit `card` payment method type this may not be what controls them,
but an off toggle is an easy thing to rule out.

## 2. Apple Pay [OWNER, 10 minutes]

You need: an iPhone (iOS 17 or later is safest) or a Mac with Touch ID, a
card in Apple Wallet, and Safari. Not Chrome on iOS, and not an in-app
browser (Gmail, Instagram, Slack); those don't offer Apple Pay to the page.
Check Settings → Apps → Safari → Advanced → "Check for Apple Pay" is on.

1. Sign in on staging as an invited buyer. Add a part to the cart.
2. Go to checkout and continue to payment.
3. **Expect:** the Payment Element shows **Apple Pay** as an option (a tab or
   button) beside Card.
4. Choose Apple Pay. **Expect:** the Apple Pay sheet shows the total including
   shipping, the same number as DRVN's order summary, and a merchant name
   from the Stripe account's public business name.
5. Confirm with Face ID / Touch ID. **Expect:** you land on the order page
   with the "placed" confirmation. In Stripe (test mode) → Payments, the
   payment shows the wallet as Apple Pay.
6. Optional: Settings → Payment methods → add a card with Apple Pay; it
   should save the same way.

## 3. Google Pay [OWNER, 10 minutes]

You need: an Android phone with Chrome and a card in Google Wallet / Google
Pay, signed in to that Google account in Chrome. (Desktop Chrome signed in
with a card saved to Google Pay also works, as a second check.)

Repeat steps 1–6 of §2 in Chrome on Android. **Expect** a **Google Pay**
option, a Google Pay sheet with the same total, and the payment in Stripe
showing Google Pay.

## 4. If the wallet doesn't appear

Work down this list. For iPhone, use Safari's Web Inspector from a Mac
(Develop menu → your iPhone → the page) to see the console. For Android, use
`chrome://inspect` from a desktop Chrome.

1. **Domain not registered.** Stripe.js logs a console warning naming the
   payment methods it didn't show because the domain isn't registered or
   verified. Fix §1.
2. **Permissions-Policy.** Check the header:
   ```bash
   curl -sI https://staging.<domain>/cart | grep -i permissions-policy
   ```
   It must contain `payment=(self "https://js.stripe.com")`. A console
   message like "Permissions policy violation: payment is not allowed" means
   the header is wrong or a host/CDN rule is overriding it. The header is set
   in `next.config.ts` `headers()`; check the host doesn't add its own.
3. **CSP.** Look for "Refused to frame" or "Refused to load the script" for a
   `stripe.com` URL. The policy is built in `src/proxy.ts`. Stripe's own CSP
   guidance lists `js.stripe.com` and `hooks.stripe.com` for frames and
   `api.stripe.com` for connections; all are present. If Stripe adds a host,
   it is a one-line change there.
4. **Browser or device.** Apple Pay: Safari only, card in Wallet, "Check for
   Apple Pay" on, not an in-app browser. Google Pay: Chrome, card in Google
   Pay, signed in. A device with no eligible card shows no button, by
   design.
5. **Not HTTPS or wrong host.** Wallets need HTTPS on the exact registered
   host. A preview deployment URL (e.g. `*.vercel.app`) is a different host
   and won't show wallets unless registered too.
6. **Stripe account.** Test the same device on Stripe's own demo page
   (search "Stripe Payment Element demo"). If the wallet doesn't show there
   either, it is the device, not DRVN.

## 5. Record the result

The wallet check is part of the `hosted-provider` gate (a real purchase on
staging in Stripe test mode, `docs/staging-setup.md` §13). Save one evidence
file per device in the candidate's evidence directory, e.g.
`wallet-apple-pay.json`:

```json
{
  "check": "wallet-device",
  "wallet": "apple_pay",
  "date": "2026-10-__",
  "tester": "<name>",
  "origin": "https://staging.<domain>",
  "stripeMode": "test",
  "domainRegistered": true,
  "device": "iPhone 15, iOS 18.x, Safari",
  "walletShown": true,
  "sheetTotalMatchesOrder": true,
  "paymentIntent": "pi_...",
  "orderId": "<order uuid>",
  "result": "pass",
  "notes": ""
}
```

Plus screenshots of the Payment Element with the wallet visible and of the
wallet sheet. Reference these files from the `hosted-provider` report's
evidence. If a wallet fails and you launch anyway, write that down as an
accepted limitation in the same file (`"result": "fail-accepted"` and why);
card payment still works without it.
