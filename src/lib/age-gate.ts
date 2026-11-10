import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ageConfirmationPath } from "@/lib/age-confirmation";
import { needsReturningAgeConfirmation } from "@/lib/age-confirmation-record";
import { safeRedirectPath } from "@/lib/safe-redirect";

/**
 * N662 (work review #152): the 18+ confirmation holds the actions that
 * matter, not only page loads. The request proxy asks an earlier member on
 * their next page request, but a Server Action is not a page request: a
 * member with a tab already open could go on messaging, offering, buying and
 * listing without ever answering. Each of those actions calls this first.
 *
 * Only an account from before the confirmation existed costs a lookup
 * (needsReturningAgeConfirmation); every later account answered on the way
 * in. A member who still owes the answer is sent to /confirm-age and comes
 * back to the page they were on. Nothing the action would have written is
 * written. Backing out of a deal (withdrawing or declining an offer,
 * withdrawing a listing) is never held.
 */
export async function requireAgeConfirmed(user: { id: string; created_at?: string | null }): Promise<void> {
  if (!(await needsReturningAgeConfirmation(user))) return;
  redirect(ageConfirmationPath(await pageTheActionCameFrom()));
}

/**
 * The page a Server Action was called from, as a same-origin path: the
 * browser sends it as the Referer. Another origin, or none, gives no path
 * (the member lands on Home after answering).
 */
async function pageTheActionCameFrom(): Promise<string | undefined> {
  const requestHeaders = await headers();
  const referer = requestHeaders.get("referer");
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!referer || !host) return undefined;
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return undefined;
  }
  if (url.host !== host) return undefined;
  return safeRedirectPath(url.pathname + url.search, "") || undefined;
}
