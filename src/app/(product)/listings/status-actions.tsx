import { setListingStatus } from "@/app/(product)/sell/actions";
import type { ListingStatus } from "@/lib/database.types";

/**
 * Publish / pause / archive controls for a listing row.
 *
 * `setListingStatus` was written, tested-looking, and imported nowhere — which
 * meant a saved draft could never be published, and pausing or archiving were
 * unreachable states. This is the missing caller.
 *
 * Server-rendered forms rather than a client component: each is a single POST
 * with no local state, and this renders once per row in the ledger.
 */
export function ListingStatusActions({
  id,
  status,
}: {
  id: string;
  status: ListingStatus;
}) {
  // Reserved means a checkout is holding it — the seller must not intervene.
  // Sold is terminal; relisting means creating a new listing so order history
  // keeps pointing at what was actually bought.
  if (status === "reserved" || status === "sold") return null;

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
        <form key={action.next + action.label} action={setListingStatus} className="contents">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value={action.next} />
          <button type="submit" className="relbtn !static" title={action.hint}>
            {action.label}
          </button>
        </form>
      ))}
    </>
  );
}
