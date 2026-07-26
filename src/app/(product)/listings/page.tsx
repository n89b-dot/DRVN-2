import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot, Media } from "@/components/ui";
import { formatPrice } from "@/lib/payments/fee";
import { createClient } from "@/lib/supabase/server";

import { setListingStatus } from "../sell/actions";

export const metadata = { title: "Your listings - DRVN" };

import type { ListingStatus } from "@/lib/database.types";

const STATUS_FILTERS: { key: ListingStatus; label: string }[] = [
  { key: "active", label: "Live" },
  { key: "draft", label: "Drafts" },
  { key: "paused", label: "Paused" },
  { key: "sold", label: "Sold" },
  { key: "archived", label: "Archived" },
];

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  ...STATUS_FILTERS,
];

/**
 * The seller console (Werkbank's "listings management" port). Managing listings
 * used to be five lines at the bottom of /sell with a single sold/relist toggle
 * and no way to edit anything.
 */
export default async function SellerListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; deleted?: string }>;
}) {
  const { status: statusFilter = "all", deleted } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let query = supabase
    .from("listings")
    .select("id, title, price_cents, shipping_cents, status, created_at, category")
    .eq("seller_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const matchedFilter = STATUS_FILTERS.find((f) => f.key === statusFilter);
  if (matchedFilter) {
    query = query.eq("status", matchedFilter.key);
  }

  const { data: listings, error } = await query;
  if (error) console.error("[listings] failed to load", error);

  const listingIds = (listings ?? []).map((l) => l.id);

  const [{ data: images }, { data: offers }, { data: questions }, { data: counts }] =
    await Promise.all([
      listingIds.length
        ? supabase
            .from("listing_images")
            .select("listing_id, url, position")
            .in("listing_id", listingIds)
            .order("position")
        : Promise.resolve({ data: [] }),
      listingIds.length
        ? supabase
            .from("offers")
            .select("id, listing_id, amount_cents, status")
            .in("listing_id", listingIds)
            .in("status", ["open", "countered"])
        : Promise.resolve({ data: [] }),
      // Unanswered questions: sellers had no surface for these at all, so Q&A
      // went unanswered in practice.
      listingIds.length
        ? supabase
            .from("listing_questions")
            .select("id, listing_id, parent_id, body")
            .in("listing_id", listingIds)
        : Promise.resolve({ data: [] }),
      supabase.from("listings").select("status").eq("seller_id", user.id).limit(500),
    ]);

  const cover = new Map<string, string>();
  for (const img of images ?? []) {
    if (!cover.has(img.listing_id)) cover.set(img.listing_id, img.url);
  }

  const offersFor = (id: string) => (offers ?? []).filter((o) => o.listing_id === id);
  const unansweredFor = (id: string) => {
    const forListing = (questions ?? []).filter((q) => q.listing_id === id);
    const roots = forListing.filter((q) => !q.parent_id);
    const answeredIds = new Set(forListing.filter((q) => q.parent_id).map((q) => q.parent_id));
    return roots.filter((q) => !answeredIds.has(q.id));
  };

  const tally = (status: string) => (counts ?? []).filter((c) => c.status === status).length;

  return (
    <div className="wrap">
      <Rv as="header" className="pagehead">
        <span className="microlabel">Your lines · {tally("active")} live</span>
        <h1>
          Every line you&apos;ve <span className="live-word">drawn.</span>
        </h1>
        <p className="sub">
          Edit, pause or end a listing, and see the offers and questions waiting on each one.
        </p>
      </Rv>

      {deleted && (
        <div className="alert alert--ok mb-6">
          <span className="alert__ico" aria-hidden="true">
            ✓
          </span>
          <h4>Listing deleted</h4>
          <p>Any past orders for it keep their record.</p>
        </div>
      )}

      <div className="jumprow" role="group" aria-label="Filter by status">
        {FILTERS.map((filter) => {
          const active = filter.key === statusFilter;
          const count = filter.key === "all" ? (counts ?? []).length : tally(filter.key);
          return (
            <Link
              key={filter.key}
              href={filter.key === "all" ? "/listings" : `/listings?status=${filter.key}`}
              className="jumplink"
              aria-current={active ? "page" : undefined}
              aria-selected={active}
            >
              {filter.label}
              {count > 0 && <span className="n"> {count}</span>}
            </Link>
          );
        })}
      </div>

      {(listings ?? []).length === 0 ? (
        <Rv className="undrawn undrawn--hero">
          <span className="undrawn__mark" aria-hidden="true">
            ✎
          </span>
          <h3>Nothing here yet</h3>
          <p>
            {statusFilter === "all"
              ? "List your first part and it appears here with its offers and questions."
              : `No ${statusFilter} listings.`}
          </p>
          <Link href="/sell" className="btn btn--live">
            List a part
          </Link>
        </Rv>
      ) : (
        <section className="deck">
          <Rv className="tile">
            <div className="rowlist">
              {(listings ?? []).map((listing) => {
                const listingOffers = offersFor(listing.id);
                const unanswered = unansweredFor(listing.id);
                const editable = !["sold", "reserved"].includes(listing.status);

                return (
                  <div key={listing.id} className="order">
                    <span className="order__img">
                      <Media
                        src={cover.get(listing.id) ?? undefined}
                        alt={listing.title}
                        className="h-full w-full"
                      />
                    </span>

                    <span className="min-w-0">
                      <Link
                        href={`/listings/${listing.id}`}
                        className="order__name block truncate transition-colors hover:text-live"
                      >
                        {listing.title}
                      </Link>
                      <span className="order__meta block">
                        {formatPrice(listing.price_cents)}
                        {listing.shipping_cents > 0
                          ? ` + ${formatPrice(listing.shipping_cents)} ship`
                          : " · free ship"}
                        {" · "}
                        {new Date(listing.created_at).toLocaleDateString()}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1.5">
                        <span
                          className={`chip ${
                            listing.status === "active"
                              ? "chip--live"
                              : listing.status === "sold"
                                ? "chip--ok"
                                : "chip--spent"
                          }`}
                        >
                          {listing.status === "active" ? "Live" : listing.status}
                        </span>
                        {listingOffers.length > 0 && (
                          <Link href="/orders" className="chip chip--live">
                            {listingOffers.length} offer
                            {listingOffers.length === 1 ? "" : "s"}
                          </Link>
                        )}
                        {unanswered.length > 0 && (
                          <Link href={`/listings/${listing.id}#qa`} className="chip chip--live">
                            {unanswered.length} question
                            {unanswered.length === 1 ? "" : "s"}
                          </Link>
                        )}
                      </span>
                    </span>

                    <span className="order__actions">
                      {editable && (
                        <Link href={`/listings/${listing.id}/edit`} className="relbtn !static">
                          Edit
                        </Link>
                      )}
                      {listing.status === "active" && (
                        <form action={setListingStatus}>
                          <input type="hidden" name="id" value={listing.id} />
                          <input type="hidden" name="status" value="paused" />
                          <button type="submit" className="relbtn !static">
                            Pause
                          </button>
                        </form>
                      )}
                      {["paused", "draft"].includes(listing.status) && (
                        <form action={setListingStatus}>
                          <input type="hidden" name="id" value={listing.id} />
                          <input type="hidden" name="status" value="active" />
                          <button type="submit" className="relbtn !static">
                            {listing.status === "draft" ? "Publish" : "Resume"}
                          </button>
                        </form>
                      )}
                      {listing.status === "active" && (
                        <form action={setListingStatus}>
                          <input type="hidden" name="id" value={listing.id} />
                          <input type="hidden" name="status" value="archived" />
                          <button type="submit" className="relbtn !static">
                            End
                          </button>
                        </form>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </Rv>
        </section>
      )}

      <Foot
        left="DRVN / Livesheet — your side of the market"
        right={<Link href="/sell">List a part →</Link>}
      />
    </div>
  );
}
