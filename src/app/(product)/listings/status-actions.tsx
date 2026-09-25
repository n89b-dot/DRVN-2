"use client";

import Link from "next/link";
import { useActionState } from "react";
import { unstable_rethrow } from "next/navigation";

import { setListingStatus } from "@/app/(product)/sell/actions";
import type { ListingStatus } from "@/lib/database.types";

/**
 * Publish / pause / archive controls for a listing row.
 *
 * Now a client component so the outcome is SAID (Rev E item 8): the old
 * server-rendered forms called a void action, and a seller without payout
 * onboarding could click Publish and watch nothing happen. A refusal renders
 * inline, and the onboarding gate links straight to /payouts.
 */
export function ListingStatusActions({
  id,
  status,
}: {
  id: string;
  status: ListingStatus;
}) {
  const [state, formAction, pending] = useActionState(async (previous: Parameters<typeof setListingStatus>[0], data: FormData) => {
    try {
      return await setListingStatus(previous, data);
    } catch (error) {
      unstable_rethrow(error);
      return { error: "Couldn’t confirm the change. Try again to check the same request." };
    }
  }, null);

  // Reserved means a checkout is holding it — the seller must not intervene.
  // Sold is terminal; relisting means creating a new listing so order history
  // keeps pointing at what was actually bought. Removed is moderation's.
  if (status === "reserved" || status === "sold" || status === "removed") return null;

  const actions: { label: string; next: ListingStatus; hint: string }[] = [];

  if (status === "draft" || status === "paused" || status === "archived") {
    actions.push({
      label: status === "draft" ? "Publish" : "Relist",
      next: "active",
      hint: "Put this part on the market",
    });
  }
  if (status === "active") {
    actions.push({ label: "Pause", next: "paused", hint: "Hide from the market, keep the sheet" });
  }
  if (status !== "archived") {
    actions.push({ label: "Archive", next: "archived", hint: "File it away" });
  }

  return (
    <>
      {actions.map((action) => (
        <form key={action.next + action.label} action={formAction} className="contents">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value={action.next} />
          <button type="submit" className="relbtn !static" title={action.hint} disabled={pending}>
            {action.label}
          </button>
        </form>
      ))}
      {state?.error && (
        <span role="alert" aria-live="polite" className="field__err basis-full">
          {state.error}
          {state.needsOnboarding && (
            <>
              {" "}
              <Link href="/payouts" className="jumplink">
                Set up payouts →
              </Link>
            </>
          )}
        </span>
      )}
      {state?.ok && (
        <span role="status" aria-live="polite" className="chip chip--ok basis-full">
          {state.ok}
        </span>
      )}
    </>
  );
}
