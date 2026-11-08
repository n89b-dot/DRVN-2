import Link from "next/link";

import { Alert, DataRow, PageHead } from "@/components/ui";
import { COPYRIGHT_AGENT } from "@/lib/legal/copyright-agent";

import { CopyrightForm } from "./copyright-form";

export const metadata = {
  title: "Copyright notices - DRVN",
  description: "How to tell DRVN that a listing, post or photo copies your work, and what happens next.",
  alternates: { canonical: "/copyright" },
};

const COPYRIGHT_UPDATED = "7 November 2026";

/**
 * The copyright notice route (R69-dmca). The listing importer rehosts photos
 * found elsewhere, so a rights holder needs a way to say so that doesn't
 * need a DRVN account. A notice lands in Admin → Copyright, where a takedown
 * removes the content everywhere DRVN holds it, order snapshots included
 * (copyright_takedown, 20261107231002).
 *
 * NOT LEGAL ADVICE: written to be honest about the process, not reviewed by
 * a lawyer. The designated agent's details are placeholders until the owner
 * registers one (src/lib/legal/copyright-agent.ts).
 */
export default function CopyrightPage() {
  return (
    <>
      <PageHead
        reveal
        eyebrow={`Copyright · updated ${COPYRIGHT_UPDATED}`}
        title="Copyright notices."
        sub="If a listing, post or photo on DRVN copies your work without permission, tell us here. You don't need an account."
      />

      <div className="prose">
        <h2>What to include</h2>
        <p>A notice we can act on has:</p>
        <ul>
          <li>your name and how to reach you: email and postal address;</li>
          <li>the work being copied, and who owns it if that isn&apos;t you;</li>
          <li>the links on DRVN where it appears: a listing, a post, or the photo itself;</li>
          <li>a statement that you believe in good faith the use isn&apos;t authorised;</li>
          <li>
            a statement that the notice is accurate and that you own the rights or are authorised
            to act for the owner;
          </li>
          <li>your signature: typing your full name below counts.</li>
        </ul>

        <h2>What happens next</h2>
        <p>
          We review every notice. If it&apos;s complete, we take the content down from DRVN:
          listings come off the marketplace, and the photos are removed wherever DRVN holds them,
          including the copy kept on buyers&apos; orders. We tell the member what was removed and
          why. A notice that is incomplete or doesn&apos;t concern DRVN is closed, and we reply to
          say so.
        </p>
        <p>
          A member who thinks their content was removed by mistake can reply to us at{" "}
          <a href="mailto:hello@drvn.app">hello@drvn.app</a> with their reasons. Accounts that
          repeatedly post other people&apos;s work are suspended (see the{" "}
          <Link href="/terms#copyright">Terms, section 9</Link>).
        </p>
        <p>
          Sending a notice you know is false can make you liable for the harm it causes. If
          you&apos;re not sure the use is unauthorised, &ldquo;Report this listing&rdquo; on the
          listing or post is the lighter way to flag it.
        </p>

        <h2>Designated agent</h2>
      </div>

      {!COPYRIGHT_AGENT.confirmed && (
        <Alert className="my-4" title="Agent details not confirmed yet">
          DRVN hasn&apos;t registered its designated copyright agent yet, so the details below are
          placeholders, not addresses to write to. Use the form on this page: it reaches the same
          review queue.
        </Alert>
      )}
      <div className="mb-8">
        <DataRow label="Agent" value={COPYRIGHT_AGENT.name} />
        <DataRow label="Postal address" value={COPYRIGHT_AGENT.postalAddress} />
        <DataRow label="Email" value={COPYRIGHT_AGENT.email} />
      </div>

      <div className="prose">
        <h2>Send a notice</h2>
      </div>
      <div className="mt-4">
        <CopyrightForm />
      </div>
    </>
  );
}
