"use client";
import { useActionState } from "react";
import { Button, ResultNote } from "@/components/ui";
import { removeFromCart } from "./cart-actions";
import type { CommerceState } from "./action-types";

export function CartRemoveButton({ listingId }: { listingId: string }) {
  const [state, action, pending] = useActionState<CommerceState, FormData>(async (_previous, data) => {
    try { return await removeFromCart(data); }
    catch { return { error: "Couldn't confirm removal. Try again." }; }
  }, {});
  return <div>
    <form action={action}>
      <input type="hidden" name="listing_id" value={listingId} />
      <Button type="submit" variant="quiet" loading={pending} pendingLabel="Removing…">Remove</Button>
    </form>
    <ResultNote error={state.error} />
  </div>;
}
