import Link from "next/link";

import { Rv } from "@/components/livesheet";

export const metadata = {
  title: "Privacy Policy - DRVN",
  description: "What data DRVN holds, why, who else sees it, and how to get rid of it.",
  alternates: { canonical: "/privacy" },
};

const UPDATED = "18 October 2026";

/**
 * NOT LEGAL ADVICE — an honest working draft describing what the app actually
 * stores and shares today. Needs professional review before launch. Facts are
 * taken from the code: processors (src/lib/payments, src/lib/shipping,
 * src/lib/listing-import, src/lib/monitoring.ts, src/lib/analytics.ts,
 * src/lib/search, src/lib/vehicles/vpic.ts), cookies (src/lib/cart.ts,
 * src/lib/guest-checkout.ts, settings/analytics-consent-actions.ts), export
 * and deletion (src/lib/account-export-contract.ts,
 * src/lib/account-deletion-worker.ts) and the retention inventory
 * (docs/remediation-data-inventory.md). Retention periods that are not yet
 * approved are described as such, never invented. Open decisions for counsel
 * and the owner: docs/legal-review-checklist.md.
 */
export default function PrivacyPage() {
  return (
    <>
      <Rv as="header" className="pagehead">
        <span className="microlabel">Privacy Policy · updated {UPDATED}</span>
        <h1>What we hold, and why.</h1>
        <p className="sub">
          Short version: enough to run a home for your car and a parts marketplace, nothing to
          sell to anyone else.
        </p>
      </Rv>

      <div className="prose">
        <h2>Who we are</h2>
        <p>
          DRVN operates this platform and is the controller of the personal data described below.
          Contact: <a href="mailto:privacy@drvn.app">privacy@drvn.app</a>.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>Account</strong> — your email address, username and display name, and how you
            sign in (a password, or Google — if you use Google we receive your name and email
            address from it).
          </li>
          <li>
            <strong>Profile</strong> — anything you choose to add: headline, bio, a free-text
            location, country and region, links and an avatar. If you run a shop, its shop details
            and return policy.
          </li>
          <li>
            <strong>Cars and content</strong> — your cars (including a VIN if you add one), photos,
            mods, build posts, comments, reactions, saves, follows, listings, questions, reviews
            and reports you make.
          </li>
          <li>
            <strong>Messages</strong> — conversations with other members, including photos you
            send in them.
          </li>
          <li>
            <strong>Transactions</strong> — orders, offers, and the name, delivery address and
            phone number given at checkout; for sellers, a ship-from and return address and phone
            number; refunds, returns, disputes and the evidence photos attached to them; and the
            status of your payouts. Each order keeps a frozen copy of the listing as it was sold,
            photos included.
          </li>
          <li>
            <strong>Buying without an account</strong> — where it&apos;s available, checkout
            with just an email creates a DRVN account for that address, holding the name, delivery
            address and phone you give for the order.
          </li>
          <li>
            <strong>Your agent</strong> — if you use it: the limits you set for it (your minimum
            and target on a listing, or your maximum as a buyer), what it did for you and why, and
            your chat with it. Card numbers are removed from chat messages before they&apos;re
            stored.
          </li>
          <li>
            <strong>Listing imports</strong> — if you import a listing from another site, the link
            you gave, the text we fetched from that public page, and the draft made from it.
          </li>
          <li>
            <strong>Technical</strong> — the cookies listed below, error reports, and request logs
            kept by our hosting and database providers. To limit abuse from signed-out visitors we
            use a keyed one-way hash of the network address, not the address itself.
          </li>
        </ul>
        <p>
          We do <strong>not</strong> hold card details. Card numbers go straight to Stripe and
          never reach DRVN&apos;s servers; for a saved card or Stripe Link we keep only
          Stripe&apos;s reference to it.
        </p>

        <h2>Photos and location data</h2>
        <p>
          Phone photos can carry hidden details, including where they were taken. Photos you post
          publicly — avatars, cars, build posts and listings — are re-processed on our server,
          which removes that embedded information. Photos sent in messages are private and are
          re-processed the same way, so they don&apos;t carry it either. Dispute evidence
          is private and kept exactly as uploaded, on purpose, as a record.
        </p>

        <h2>Why we hold it</h2>
        <ul>
          <li>
            <strong>To run your account and the platform</strong> — the contract between us.
          </li>
          <li>
            <strong>To complete orders</strong> — your delivery details are shared with the seller
            of that order, and with the shipping provider when the seller buys a label through DRVN.
          </li>
          <li>
            <strong>To keep the platform safe and working</strong> — rate limiting, abuse
            prevention, moderation and error monitoring, on the basis of our legitimate interest.
          </li>
          <li>
            <strong>Product analytics</strong> — only if you opt in (see below), on the basis of
            your consent, which you can withdraw at any time.
          </li>
          <li>
            <strong>To meet legal obligations</strong> — keeping transaction records where
            required.
          </li>
        </ul>

        <h2>What&apos;s public</h2>
        <p>
          Your username, display name, profile details (including the location, country and
          region you enter), public cars and build posts, listings, questions, reviews, follower
          and sales counts are visible to anyone, including search engines. A car marked private
          is visible only to you, and a car&apos;s VIN is not shown on its public pages. Your email
          address, delivery and ship-from addresses, phone number, messages, offers and orders are
          never public.
        </p>

        <h2>Who else sees it</h2>
        <ul>
          <li>
            <strong>Supabase</strong> — our database, sign-in and file storage provider. It also
            sends our sign-in and order-access emails, through our email delivery provider.
          </li>
          <li>
            <strong>Our hosting provider</strong> — serves the application and keeps request logs.
          </li>
          <li>
            <strong>Stripe</strong> — takes payments, stores saved cards and Stripe Link details,
            and pays sellers through Stripe Connect. Sellers give their identity and bank details
            to Stripe directly when they set up payouts; DRVN receives only whether payouts are
            enabled. We share your email and account reference with Stripe, and order references
            with each payment.
          </li>
          <li>
            <strong>EasyPost</strong> — when a seller uses DRVN Shipping: names, addresses and
            phone numbers of sender and recipient and the parcel details, to quote, buy labels and
            track the parcel. Your email address is not sent.
          </li>
          <li>
            <strong>Anthropic</strong> — when you import a listing, the text of the page you
            imported is sent to Anthropic&apos;s AI service to draft the listing. When you chat
            with your agent, your message and recent chat, and what the agent looks up on DRVN to
            answer you (listings, and your own cars and build), are sent to the same service.
            Card numbers, VINs, email addresses and phone numbers are removed from what you type
            before it&apos;s sent, and your agent&apos;s limits are never sent. Photos and your
            account details are not sent.
          </li>
          <li>
            <strong>Sentry</strong> — error reports from our servers, which can include your
            account id. Fields holding email addresses, postal addresses, phone numbers and
            credentials are stripped before sending.
          </li>
          <li>
            <strong>PostHog</strong> — only if you opt in: counts of which features you use, linked
            to your account id. Never message text, addresses, payment details or search text, and
            no session recording.
          </li>
          <li>
            <strong>Our search provider</strong> — where enabled, a search index of public
            listings, cars and profile names.
          </li>
          <li>
            <strong>NHTSA</strong> — if you add a VIN, it is sent to the US government&apos;s
            vehicle database to decode the car&apos;s details.
          </li>
          <li>
            <strong>Google</strong> — only if you choose to sign in with Google.
          </li>
          <li>
            <strong>YouTube</strong> — a video in a post plays from YouTube (a Google service).
            Nothing loads from YouTube until you press play on that video; when you do, YouTube
            receives your network address and may set its own cookies, under Google&apos;s privacy
            policy.
          </li>
          <li>
            <strong>Other members</strong> — what&apos;s public, plus what a transaction needs: a
            seller sees the delivery details of an order they sold, and both sides see the
            order, its messages and any dispute evidence.
          </li>
          <li>
            <strong>DRVN staff</strong> — can see orders, conversations and dispute evidence when
            handling a report, an order or a dispute. Messages are not end-to-end encrypted. Your
            chat with your agent is opened only for a report about you or a dispute you&apos;re
            part of, and each opening is recorded.
          </li>
        </ul>
        <p>We do not sell your data and we do not run advertising trackers.</p>

        <h2>Cookies and storage in your browser</h2>
        <p>We use a small number of cookies and no advertising cookies:</p>
        <ul>
          <li>
            <strong>Sign-in</strong> (<span className="mono">sb-…</span>) — keeps you signed in.
            Essential.
          </li>
          <li>
            <strong>Cart</strong> (<span className="mono">drvn_cart</span>, 30 days) — remembers
            the parts you&apos;ve added.
          </li>
          <li>
            <strong>Checkout without an account</strong> (
            <span className="mono">drvn_guest_orders</span>, 6 hours;{" "}
            <span className="mono">drvn_checkout_identity</span>, 24 hours) — lets this browser
            open the orders it just placed and finish an interrupted checkout. Signed, so they
            can&apos;t be forged.
          </li>
          <li>
            <strong>Analytics choice</strong> (<span className="mono">drvn_analytics_consent</span>,
            180 days) — records whether you opted in. No cookie means no analytics.
          </li>
          <li>
            <strong>Display preferences</strong> (<span className="mono">ls-theme</span>,{" "}
            <span className="mono">ls-rail</span>, <span className="mono">ls-mkt</span>, one
            year) — day/night and layout choices.
          </li>
          <li>
            <strong>Time zone</strong> (<span className="mono">drvn-tz</span>, one year) — shows
            message times in your own time zone.
          </li>
        </ul>
        <p>
          Your browser also keeps an unsent post draft so it survives a reload, and briefly notes
          which listings you&apos;ve viewed so one visit isn&apos;t counted twice. Product
          analytics is <strong>off unless you switch it on</strong> in{" "}
          <Link href="/settings#privacy">Settings → Privacy</Link>; an opt-in lapses after 180
          days unless you renew it. Nothing optional runs without that opt-in, which is why there is no
          consent banner.
        </p>

        <h2>How long we keep it</h2>
        <ul>
          <li>Data export packages: deleted 7 days after they&apos;re made.</li>
          <li>
            Listing imports: an unfinished import expires; the copied page text and draft are
            cleared 7 days after an import finishes.
          </li>
          <li>Photos uploaded to a form you never saved: deleted after 48 hours.</li>
          <li>Rate-limit counters: deleted after a day.</li>
          <li>Your chat with your agent: deleted 12 months after its last message.</li>
          <li>
            Everything else: for as long as your account exists. How long order, payment, message,
            dispute and log records are kept after an account is deleted is still being set; this
            page will state those periods once they are decided.
          </li>
        </ul>

        <h2>Deleting your account</h2>
        <p>
          Delete your account from{" "}
          <Link href="/settings#danger">Settings → Danger zone</Link>. You&apos;re signed out
          everywhere straight away. If an order, payment, refund or payout is still in progress,
          deletion waits until it&apos;s finished. Then your profile is cleared and shown as
          &ldquo;Deleted member&rdquo;, your cars, build posts and listings and their photos are
          removed, any saved cards are deleted at Stripe, and your sign-in is deleted. Orders and
          payment records stay on the other party&apos;s record with your name removed; where a
          record must be kept, a minimal disabled identity is kept with it. How long backup
          copies are kept is still being set.
        </p>

        <h2>Your rights</h2>
        <p>
          Depending on where you live you may have the right to access, correct, export or erase your
          data, to object to processing, to withdraw consent, and to complain to a data protection
          authority. You can edit most of your data directly in{" "}
          <Link href="/settings">Settings</Link>, request a full export from Settings → Danger zone
          → &ldquo;Request my data&rdquo; (a download link appears there when it&apos;s ready),
          and delete your account there too. For anything else, email{" "}
          <a href="mailto:privacy@drvn.app">privacy@drvn.app</a>.
        </p>

        <h2>Security</h2>
        <p>
          Data is encrypted in transit. Access is enforced at the database level with row-level
          security, so a member can only reach their own private records. Private photos are
          served through short-lived links. No system is perfect; if we discover a breach
          affecting you we&apos;ll tell you.
        </p>

        <h2>Children</h2>
        <p>DRVN is not for under-18s and we don&apos;t knowingly collect their data.</p>

        <h2>Changes</h2>
        <p>
          We&apos;ll update the date at the top when this changes, and announce anything material in
          the app.
        </p>
      </div>
    </>
  );
}
