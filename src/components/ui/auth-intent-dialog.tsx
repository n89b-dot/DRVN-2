"use client";

import Link from "next/link";

import {
  AUTH_INTENT_COPY,
  authHref,
  authReturnTo,
  type AuthIntent,
} from "@/lib/auth-intent";

import { Dialog } from "./dialog";

/**
 * The one place DRVN asks a signed-out visitor for an account.
 *
 * Make an Offer and Buy Now used to jump straight to /login — a public page
 * replaced by a form, with no explanation and the original intent lost. This
 * says what the account is *for* in that specific moment and hands both auth
 * routes a `next` that carries the action back to this listing.
 *
 * One component, contextual copy: Save, Follow and List a part use the same
 * dialog rather than each growing their own.
 */
export function AuthIntentDialog({
  open,
  onClose,
  intent,
  /** Internal path to come back to — the action is appended as `?action=`. */
  returnPath,
  resume = true,
}: {
  open: boolean;
  onClose: () => void;
  intent: AuthIntent;
  returnPath: string;
  /**
   * Whether the destination needs `?action=` to resume something. False when
   * the destination *is* the action — /sell has nothing to reopen, so tagging
   * it would leave a parameter on the URL that means nothing.
   */
  resume?: boolean;
}) {
  const copy = AUTH_INTENT_COPY[intent];
  const returnTo = resume ? authReturnTo(returnPath, intent) : returnPath;

  return (
    <Dialog open={open} onClose={onClose} label={copy.title} align="center">
      <div className="sheet">
        <span className="microlabel microlabel--ink">Account needed</span>
        <h2 className="mt-2 text-[22px] font-[600] leading-[1.15] tracking-[-0.02em]">
          {copy.title}
        </h2>
        <p className="mt-2 text-body text-dim">{copy.lead}</p>

        <ul className="authintent__why">
          {copy.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>

        <div className="sheet__actions">
          <Link href={authHref("/login", returnTo)} className="btn btn--live flex-1">
            {copy.signIn}
          </Link>
          <Link href={authHref("/signup", returnTo)} className="btn btn--ghost flex-1">
            Create account
          </Link>
        </div>
        <p className="spec-note">{copy.returnNote}</p>
      </div>
    </Dialog>
  );
}
