import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { DISPUTE_WINDOW_DAYS, SELLER_RESPONSE_DAYS } from "@/features/commerce/disputes";
import { GRADES } from "@/lib/marketplace/grading";

export const metadata = {
  title: "Buyer & seller protection - DRVN",
  description:
    "How DRVN handles used-part condition, fitment, and problems with an order: grades, checklists, the dispute process, and when refunds happen.",
  alternates: { canonical: "/protection" },
};

/**
 * The protection rules, in the buyer's and seller's own language. Numbers are
 * imported from the same constants the code enforces (grades, claim window,
 * seller-response window — see src/features/commerce/disputes.ts and
 * src/lib/marketplace/grading.ts), same discipline as the fees page: the
 * documentation cannot drift from what actually happens. The day-10
 * auto-refund is enforced by src/lib/payments/dispute-sla.ts.
 */
export default function ProtectionPage() {
  return (
    <>
      <Rv as="header" className="pagehead">
        <span className="microlabel">Protection · plainly</span>
        <h1>
          Used parts, honestly sold. <span className="live-word">Backed up.</span>
        </h1>
        <p className="sub">
          Most of what sells on DRVN came off a real car, so condition matters more here than on a
          shop shelf. This page is the whole system: how condition is declared, how fitment works,
          and exactly what happens if an order goes wrong.
        </p>
      </Rv>

      <section className="deck">
        {/* ---------- The listing is the contract ---------- */}
        <Rv className="tile tile--deep">
          <span className="microlabel microlabel--ink">The listing is the contract</span>
          <p className="mt-2 text-body leading-relaxed">
            Every claim a seller makes on a listing — photos, description, grade, checklist
            answers, fitment — is recorded on the order at the moment you buy. If there&apos;s ever
            a dispute, it&apos;s judged against what the listing said, not against what anyone
            remembers. That cuts both ways: honest sellers are protected by their own disclosures,
            and &quot;not as described&quot; means measurably not as described.
          </p>
        </Rv>

        {/* ---------- Grades ---------- */}
        <Rv className="tile" stagger={1}>
          <span className="microlabel microlabel--ink">Condition grades</span>
          <p className="mt-2 text-body leading-relaxed">
            Used parts carry a seller-declared letter grade. The scale is deliberately short and
            conservative — there is no &quot;mint&quot;:
          </p>
          <table className="spec mt-3">
            <thead className="sr-only">
              <tr>
                <th>Grade</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              {GRADES.map((g) => (
                <tr key={g.value}>
                  <td>
                    <b>{g.label}</b>
                  </td>
                  <td>{g.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="spec-note">
            New parts don&apos;t take a grade — &quot;new&quot; already says everything a grade
            would. An ungraded used part just means the seller didn&apos;t declare one; the photos
            and description still bind them.
          </p>
        </Rv>

        {/* ---------- Checklists ---------- */}
        <Rv className="tile" stagger={2}>
          <span className="microlabel microlabel--ink">Condition checklists</span>
          <p className="mt-2 text-body leading-relaxed">
            Alongside the grade, sellers answer a short checklist that changes with the kind of
            part — a turbo gets asked about shaft play and oil in the housings, a wheel about
            bends and welds, an ECU about being unmarried from its old car. Every answer
            (&quot;yes&quot;, &quot;no&quot;, or an honest &quot;not sure&quot;) is shown on the
            listing and frozen onto the order when you buy.
          </p>
          <p className="mt-2 text-body leading-relaxed">
            For sellers: &quot;not sure&quot; is always safer than a wrong &quot;yes&quot;. A
            disclosed defect is a Grade C sale; an undisclosed one is a lost dispute.
          </p>
        </Rv>

        {/* ---------- Fitment ---------- */}
        <Rv className="tile" stagger={3}>
          <span className="microlabel microlabel--ink">Fitment — always seller-stated</span>
          <p className="mt-2 text-body leading-relaxed">
            Sellers declare what a part fits as structured rows — make, model, year range — plus
            freeform notes. When a car in your garage matches, you&apos;ll see a{" "}
            <b>&quot;fits your car&quot;</b> hint on the listing and can filter the marketplace to
            parts that fit. Adding your car&apos;s VIN in the garage makes the match sharper: we
            decode it once (via the US government&apos;s NHTSA database) to verify year, make,
            model, trim and engine. The VIN itself is never shown publicly.
          </p>
          <p className="mt-2 text-body leading-relaxed">
            Be clear about what the hint is: <b>the seller&apos;s claim, checked against your
            car</b> — not a guarantee from DRVN. Aftermarket parts especially can vary by trim,
            options and model year. Always confirm before buying; the Q&amp;A on every listing
            exists for exactly that. If a part arrives and genuinely doesn&apos;t fit a vehicle
            the seller listed, that&apos;s a &quot;wrong item&quot; dispute and the process below
            applies.
          </p>
        </Rv>

        {/* ---------- The dispute process ---------- */}
        <Rv className="tile tile--deep" stagger={4}>
          <span className="microlabel microlabel--ink">If something&apos;s wrong: the process</span>
          <p className="mt-2 text-body leading-relaxed">
            Problems are handled on the order page, in the open, with a clock on every step. Valid
            reasons: the item never arrived, arrived damaged, is significantly not as described,
            or is the wrong item. Changed your mind isn&apos;t covered — this is a used-parts
            marketplace between real people.
          </p>
          <table className="spec mt-3">
            <thead className="sr-only">
              <tr>
                <th>When</th>
                <th>What happens</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <b>Within {DISPUTE_WINDOW_DAYS} days of delivery</b>
                </td>
                <td>
                  Open a dispute from the order page (&quot;Report a problem&quot;). Attach photos —
                  in a condition argument, photos beat adjectives. If the order never arrived,
                  there&apos;s no deadline.
                </td>
              </tr>
              <tr>
                <td>
                  <b>Seller&apos;s move — {SELLER_RESPONSE_DAYS} days</b>
                </td>
                <td>
                  The seller sees your case and can offer a refund (full or partial) or resolve it
                  with you in the order conversation. Most disputes end here.
                </td>
              </tr>
              <tr>
                <td>
                  <b>After {SELLER_RESPONSE_DAYS} days of silence</b>
                </td>
                <td>
                  You can <b>ask DRVN to step in</b> — a button on the order. The case goes to
                  DRVN support, who review the listing, the order record and both sides&apos;
                  photos, and decide it.
                </td>
              </tr>
              <tr>
                <td>
                  <b>Day 10, still ignored</b>
                </td>
                <td>
                  A dispute the seller never responds to is <b>refunded to the buyer
                  automatically</b>. Silence is never a way for a seller to win.
                </td>
              </tr>
            </tbody>
          </table>
          <p className="spec-note">
            Refunds always flow back the way the money came. If the seller was already paid out,
            the refund is reclaimed from them — never taken from the buyer twice.
          </p>
        </Rv>

        {/* ---------- Accountability ---------- */}
        <Rv className="tile" stagger={5}>
          <span className="microlabel microlabel--ink">Accountability, both directions</span>
          <p className="mt-2 text-body leading-relaxed">
            Disputes a seller loses — refunds accepted, forced, or automatic — go on their record
            and inform how DRVN treats their account. Buyers who abuse the process lose access to
            it. And closing a dispute yourself when it&apos;s sorted (&quot;resolved, no action
            needed&quot;) costs neither side anything.
          </p>
          <div className="mt-4 flex flex-wrap gap-4">
            <Link href="/fees" className="jumplink inline-flex">
              What DRVN charges
            </Link>
            <Link href="/terms" className="jumplink inline-flex">
              Read the terms
            </Link>
          </div>
        </Rv>
      </section>
    </>
  );
}
