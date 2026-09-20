import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";

import { FilterGroup, FilterLink } from "@/components/ui";
import { MarketplaceResults } from "@/features/marketplace/results";
import type { Database } from "@/lib/database.types";
import { fetchStorePage } from "@/lib/store/query";
import { parseStoreTab, storeTabsFor, type StoreTab } from "@/lib/store/visible-statuses";

/** Says what the count is a count of — "12 parts available" over a page of
 *  sold parts was simply untrue. */
function storeHeading(tab: StoreTab, total: number): string {
  const n = total.toLocaleString("en-US");
  const parts = total === 1 ? "part" : "parts";
  if (tab === "sold") return `${n} sold`;
  if (tab === "hidden") return `${n} not live`;
  if (tab === "all") return `${n} ${parts}, for sale and sold`;
  return `${n} ${parts} for sale`;
}

/**
 * A member's store (P-6): the marketplace's grid and card, for one seller.
 *
 * One component because the store is reached two ways — the public profile
 * and the member's own /profile — and they must be the same thing. Which
 * statuses it may show is decided from `isOwner`, which the CALLER derives
 * from the session; the `tab` it is handed can only narrow that.
 */
export async function StorePanel({
  supabase,
  sellerId,
  isOwner,
  viewerId,
  basePath,
  tab: rawTab,
  page,
}: {
  supabase: SupabaseClient<Database>;
  sellerId: string;
  isOwner: boolean;
  viewerId: string | null;
  /** The profile URL this store sits on; `?view=parts` is appended. */
  basePath: string;
  tab: string | undefined;
  page: number;
}) {
  const tab = parseStoreTab(rawTab, isOwner);
  const storePage = await fetchStorePage(supabase, { sellerId, isOwner, tab, page });

  return (
    <>
      <FilterGroup ariaLabel="Which parts to show" scroll className="mb-4">
        {storeTabsFor(isOwner).map((t) => (
          <FilterLink
            key={t.key}
            href={t.key === "active" ? `${basePath}?view=parts` : `${basePath}?view=parts&status=${t.key}`}
            selected={tab === t.key}
            scroll={false}
          >
            {t.label}
          </FilterLink>
        ))}
      </FilterGroup>
      {/* The same grid and the same card as the marketplace — a part should
          not look like a different object because of which page it is on. */}
      <MarketplaceResults
        page={storePage}
        basePath={basePath}
        params={{ view: "parts", status: tab === "active" ? undefined : tab }}
        store={{ pageParam: "listingsPage", heading: (total) => storeHeading(tab, total) }}
        isLoggedIn={Boolean(viewerId)}
        viewerId={viewerId}
        shopping
        ownerActions={(listing) => (
          /* The owner's own store gets the edit link where a stranger gets
             Add to cart — you can't buy your own part. */
          <Link href={`/listings/${listing.id}/edit`} className="relbtn !static shrink-0">
            Edit
          </Link>
        )}
        emptyTitle={isOwner ? "Nothing here yet" : "No parts for sale"}
        emptyBody={
          isOwner
            ? "Parts you list — or release off a build — show up here."
            : "When they list something, it shows up here."
        }
      />
    </>
  );
}

/** The number for the Parts tab: what is for sale, not the page's total. */
export async function forSaleCount(
  supabase: SupabaseClient<Database>,
  sellerId: string
): Promise<number | null> {
  const { count } = await supabase
    .from("listings")
    .select("id", { count: "exact", head: true })
    .eq("seller_id", sellerId)
    .eq("status", "active");
  return count ?? null;
}
