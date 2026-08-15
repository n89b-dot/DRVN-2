"use client";

import Link from "next/link";
import { useState } from "react";

import { cx } from "@/lib/format";

import { AuthIntentDialog } from "./auth-intent-dialog";

/**
 * Marketplace's "List a part" CTA.
 *
 * It's shown to everyone — selling is the other half of the storefront's
 * pitch — but /sell is authenticated. Signed out, the button used to hand the
 * visitor to /login with no explanation and no way back; now it uses the same
 * auth-intent dialog as Buy now and Make an offer, and returns to /sell once
 * they're in.
 */
export function SellCta({
  isLoggedIn,
  className = "",
  children = "List a part",
}: {
  isLoggedIn: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const [askAuth, setAskAuth] = useState(false);

  if (isLoggedIn) {
    return (
      <Link href="/sell" className={cx("btn btn--live", className)}>
        {children}
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAskAuth(true)}
        className={cx("btn btn--live", className)}
      >
        {children}
      </button>
      <AuthIntentDialog
        open={askAuth}
        onClose={() => setAskAuth(false)}
        intent="sell"
        returnPath="/sell"
        resume={false}
      />
    </>
  );
}
