import Link from "next/link";

import { Rv } from "@/components/livesheet";

export const metadata = {
  title: "Privacy Policy - DRVN",
  description: "What data DRVN holds, why, and how to get rid of it.",
  alternates: { canonical: "/privacy" },
};

const UPDATED = "26 July 2026";

/**
 * NOT LEGAL ADVICE — an honest working draft describing what the app actually
 * stores today. Needs professional review before launch, and updating when a
 * real payment processor and any analytics are added.
 */
export default function PrivacyPage() {
  return (
    <>
      <Rv as="header" className="pagehead">
        <span className="microlabel">Privacy Policy · updated {UPDATED}</span>
        <h1>What we hold, and why.</h1>
        <p className="sub">
          Short version: enough to run a marketplace, nothing to sell to anyone else.
        </p>
      </Rv>

      <div className="prose">
        <h2>Who we are</h2>
        <p>
          DRVN operates this marketplace and is the controller of the personal data described below.
          Contact: <a href="mailto:privacy@drvn.app">privacy@drvn.app</a>.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>Account</strong> — email address, username, display name, and anything you
            choose to add to your profile (headline, bio, location, links, avatar).
          </li>
          <li>
            <strong>Content you post</strong> — cars, build entries, photos, listings, questions,
            comments and reviews.
          </li>
          <li>
            <strong>Transactions</strong> — orders, offers, messages, and the delivery address you
            give at checkout.
          </li>
          <li>
            <strong>Technical</strong> — session cookies, and server logs containing IP address and
            request details.
          </li>
        </ul>
        <p>
          We do <strong>not</strong> collect card details. When live payments launch they will be
          handled by a payment processor, and card numbers will never reach DRVN&apos;s servers.
        </p>

        <h2>Why we hold it</h2>
        <ul>
          <li>
            <strong>To run your account and the marketplace</strong> — the contract between us.
          </li>
          <li>
            <strong>To complete orders</strong> — your delivery address is shared with the seller of
            that order, and only them, because they have to post the part.
          </li>
          <li>
            <strong>To keep the platform safe</strong> — rate limiting and abuse prevention, on the
            basis of our legitimate interest.
          </li>
          <li>
            <strong>To meet legal obligations</strong> — keeping transaction records where required.
          </li>
        </ul>

        <h2>What&apos;s public</h2>
        <p>
          Your username, display name, profile details, public cars, build entries, listings,
          questions and reviews are visible to anyone, including search engines. A car marked
          private is visible only to you. Your email address, delivery addresses, messages, offers
          and orders are never public.
        </p>

        <h2>Who else sees it</h2>
        <ul>
          <li>
            <strong>Supabase</strong> — our database, authentication and file storage provider.
          </li>
          <li>
            <strong>Our hosting provider</strong> — serves the application and keeps request logs.
          </li>
          <li>
            <strong>Other members</strong> — only as described above: what&apos;s public, plus your
            delivery details with a seller you actually bought from.
          </li>
        </ul>
        <p>We do not sell your data and we do not run advertising trackers.</p>

        <h2>Cookies</h2>
        <p>We use a small number of cookies and no advertising cookies:</p>
        <ul>
          <li>
            <strong>Authentication</strong> — keeps you signed in. Essential.
          </li>
          <li>
            <strong>Cart</strong> (<span className="mono">drvn_cart</span>) — remembers the parts
            you&apos;ve added. Essential to the feature.
          </li>
          <li>
            <strong>Display preferences</strong> (<span className="mono">ls-theme</span>,{" "}
            <span className="mono">ls-rail</span>) — remembers day/night and layout choices.
          </li>
        </ul>
        <p>
          All of these are strictly necessary or set by your own choices, which is why you don&apos;t
          get a consent banner. If we ever add analytics, we&apos;ll ask first.
        </p>

        <h2>How long we keep it</h2>
        <p>
          Account data lasts as long as your account. Delete your account and your profile, cars,
          build entries, listings and uploads are removed. Order records are retained for the other
          party&apos;s receipts and for legal record-keeping, with your name replaced by a
          placeholder.
        </p>

        <h2>Your rights</h2>
        <p>
          Depending on where you live you may have the right to access, correct, export or erase your
          data, to object to processing, and to complain to a data protection authority. You can
          edit most of your data directly in <Link href="/settings">Settings</Link>, download a
          full export from Settings → Danger zone → &ldquo;Download my data&rdquo;, and delete your
          account there too. For anything else, email{" "}
          <a href="mailto:privacy@drvn.app">privacy@drvn.app</a>.
        </p>

        <h2>Security</h2>
        <p>
          Data is encrypted in transit. Access is enforced at the database level with row-level
          security, so a member can only reach their own private records. No system is perfect; if
          we discover a breach affecting you we&apos;ll tell you.
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
