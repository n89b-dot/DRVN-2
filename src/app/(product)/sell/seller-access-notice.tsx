import Link from "next/link";

import { Alert } from "@/components/ui";

/**
 * The seller beta gate, as a policy notice rather than an empty plate — one
 * component, one wording, for every selling entry point (/sell and
 * /sell/import used to say the same rule two different ways, behind a β mark
 * that meant nothing to a member). It says what still works and gives the
 * two useful next steps: ask for access, or manage what's already listed.
 */
export function SellerAccessNotice() {
  return (
    <div className="wrap pb-10 pt-8">
      <Alert tone="live" ico="!" title="Selling is invite-only during the beta">
        New listings and imports open once your account has seller access. Anything you&apos;ve
        already listed, sold or been paid for stays yours to manage.{" "}
        <a
          href="mailto:hello@drvn.app?subject=Seller%20access%20request"
          className="jumplink"
        >
          Request seller access →
        </a>{" "}
        <Link href="/listings" className="jumplink">
          Manage your listings →
        </Link>
      </Alert>
    </div>
  );
}
