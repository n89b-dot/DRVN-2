import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring";

import { OfferListRow, type OfferListItem } from "./offer-list-row";

export const metadata = { title: "Offers - DRVN" };

const PAGE_SIZE = 25;

const STATUSES = ["open", "countered", "accepted", "declined", "withdrawn", "expired"] as const;
type StatusFilter = (typeof STATUSES)[number];

function isStatus(value: string | undefined): value is StatusFilter {
  return !!value && (STATUSES as readonly string[]).includes(value);
}

function withParams(
  base: string,
  params: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `${base}?${query}` : base;
}

/**
 * The dedicated offers surface. This used to be two capped, unpaginated
 * queries inlined on /orders (25 each, no way to see older offers, no way
 * to filter). Offers now get their own list with role/status filters and
 * real pagination, and each row links to a full thread rather than
 * rendering its conversation inline.
 */
export default async function OffersPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; status?: string; page?: string; offer?: string }>;
}) {
  const { role: roleParam, status: statusParam, page: pageParam, offer: legacyOfferId } =
    await searchParams;

  // Legacy `/orders?offer=<id>` and other query-param deep links land here —
  // fragment links (`#offer-<id>`) can't be read server-side at all, so
  // those had to be fixed at the source (the link builders that emit them).
  if (legacyOfferId) redirect(`/offers/${legacyOfferId}`);

  const role = roleParam === "made" ? "made" : "received";
  const status = isStatus(statusParam) ? statusParam : undefined;
  const page = Math.max(1, Number(pageParam) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: myListings } = await supabase
    .from("listings")
    .select("id")
    .eq("seller_id", user.id)
    .limit(2000);
  const myListingIds = (myListings ?? []).map((l) => l.id);

  // Cheap counts for the tab labels — head-only queries, no rows fetched.
  const [{ count: receivedOpenCount }, { count: madeCounteredCount }] = await Promise.all([
    myListingIds.length
      ? supabase
          .from("offers")
          .select("id", { count: "exact", head: true })
          .in("listing_id", myListingIds)
          .eq("status", "open")
      : Promise.resolve({ count: 0 }),
    supabase
      .from("offers")
      .select("id", { count: "exact", head: true })
      .eq("buyer_id", user.id)
      .eq("status", "countered"),
  ]);

  let query =
    role === "received"
      ? supabase.from("offers").select("*", { count: "exact" }).in("listing_id", myListingIds.length ? myListingIds : ["00000000-0000-0000-0000-000000000000"])
      : supabase.from("offers").select("*", { count: "exact" }).eq("buyer_id", user.id);

  if (status) query = query.eq("status", status);

  const { data: offers, count, error } = await query
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (error) reportError("[offers] failed to load offers", error);

  const rows = offers ?? [];
  const offerIds = rows.map((o) => o.id);
  const listingIds = [...new Set(rows.map((o) => o.listing_id))];

  // Listings are fetched first — for "made" offers, the counterparty is the
  // listing's seller, which we don't know until this comes back.
  const [{ data: listings }, { data: images }] = await Promise.all([
    listingIds.length
      ? supabase.from("listings").select("id, title, seller_id").in("id", listingIds)
      : Promise.resolve({ data: [] }),
    listingIds.length
      ? supabase.from("listing_images").select("listing_id, url, position").in("listing_id", listingIds).order("position")
      : Promise.resolve({ data: [] }),
  ]);

  const counterpartyIds = [
    ...new Set(
      role === "received"
        ? rows.map((o) => o.buyer_id)
        : rows.map((o) => (listings ?? []).find((l) => l.id === o.listing_id)?.seller_id ?? null)
    ),
  ].filter((x): x is string => Boolean(x) && x !== user.id);

  const [{ data: people }, { data: unreadRows }] = await Promise.all([
    counterpartyIds.length
      ? supabase.from("profiles").select("id, display_name, username").in("id", counterpartyIds)
      : Promise.resolve({ data: [] }),
    offerIds.length
      ? supabase
          .from("messages")
          .select("offer_id")
          .in("offer_id", offerIds)
          .eq("recipient_id", user.id)
          .is("read_at", null)
      : Promise.resolve({ data: [] }),
  ]);

  const coverByListing = new Map<string, string>();
  for (const image of images ?? []) {
    if (!coverByListing.has(image.listing_id)) coverByListing.set(image.listing_id, image.url);
  }
  const unreadOffers = new Set((unreadRows ?? []).map((m) => m.offer_id).filter(Boolean));

  const nameFor = (pid: string | null) => {
    if (!pid) return "DRVN member";
    const p = (people ?? []).find((x) => x.id === pid);
    return p?.display_name ?? (p?.username ? `@${p.username}` : "DRVN member");
  };

  const expiresLabel = (expiresAt: string | null) => {
    if (!expiresAt) return null;
    return `lapses ${new Date(expiresAt).toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  };

  const items: OfferListItem[] = rows.map((o) => {
    const listing = (listings ?? []).find((l) => l.id === o.listing_id);
    return {
      id: o.id,
      listing_id: o.listing_id,
      listing_title: listing?.title ?? "Listing",
      listing_cover_url: coverByListing.get(o.listing_id) ?? null,
      counterparty_name: role === "received" ? nameFor(o.buyer_id) : nameFor(listing?.seller_id ?? null),
      amount_cents: o.amount_cents,
      counter_amount_cents: o.counter_amount_cents,
      status: o.status,
      created_at: o.created_at,
      expiresLabel: expiresLabel(o.expires_at),
      unread: unreadOffers.has(o.id),
    };
  });

  const total = count ?? 0;
  const hasMore = from + PAGE_SIZE < total;
  const firstOnPage = total === 0 ? 0 : from + 1;
  const lastOnPage = from + items.length;

  const params = { role: roleParam, status: statusParam, page: pageParam };

  return (
    <div className="wrap">
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          Offers
          {(receivedOpenCount ?? 0) > 0 && (
            <>
              {" · "}
              <span className="microlabel--live">
                {receivedOpenCount} received open
              </span>
            </>
          )}
          {(madeCounteredCount ?? 0) > 0 && (
            <>
              {" · "}
              <span className="microlabel--live">{madeCounteredCount} countered on you</span>
            </>
          )}
        </span>
        <h1>
          Every offer, <span className="live-word">in one place.</span>
        </h1>
        <p className="sub">Answer what&apos;s come in, track what you&apos;ve sent, and open any thread.</p>
      </Rv>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="filters !my-0" role="group" aria-label="Offer role">
          <span className="microlabel filters__label">Show</span>
          <Link
            href={withParams("/offers", params, { role: undefined, page: undefined })}
            className={`fbtn ${role === "received" ? "is-on" : ""}`}
            aria-current={role === "received" ? "true" : undefined}
          >
            Received{(receivedOpenCount ?? 0) > 0 ? ` (${receivedOpenCount})` : ""}
          </Link>
          <Link
            href={withParams("/offers", params, { role: "made", page: undefined })}
            className={`fbtn ${role === "made" ? "is-on" : ""}`}
            aria-current={role === "made" ? "true" : undefined}
          >
            Made
          </Link>
        </div>

        <div className="filters !my-0" role="group" aria-label="Offer status">
          <span className="microlabel filters__label">Status</span>
          <Link
            href={withParams("/offers", params, { status: undefined, page: undefined })}
            className={`fbtn ${!status ? "is-on" : ""}`}
            aria-current={!status ? "true" : undefined}
          >
            All
          </Link>
          {STATUSES.map((s) => (
            <Link
              key={s}
              href={withParams("/offers", params, { status: s, page: undefined })}
              className={`fbtn ${status === s ? "is-on" : ""}`}
              aria-current={status === s ? "true" : undefined}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </Link>
          ))}
        </div>
      </div>

      {error ? (
        <div className="alert alert--live">
          <h4>Couldn&apos;t load offers</h4>
          <p>Try refreshing — if this keeps happening, it&apos;s on us.</p>
        </div>
      ) : items.length > 0 ? (
        <Rv className="tile">
          <div className="tile__head">
            <span className="microlabel microlabel--ink">
              {total === 1 ? "1 offer" : `${total} offers`}
              {total > PAGE_SIZE && (
                <>
                  {" · "}
                  showing {firstOnPage}–{lastOnPage}
                </>
              )}
            </span>
          </div>
          <div className="rowlist">
            {items.map((offer) => (
              <OfferListRow key={offer.id} offer={offer} incoming={role === "received"} />
            ))}
          </div>
        </Rv>
      ) : (
        <Rv className="undrawn">
          <span className="undrawn__mark" aria-hidden="true">
            ⏱
          </span>
          <h3>No offers here</h3>
          <p>
            {role === "received"
              ? "When someone offers on one of your listings it lands here."
              : "Offers you've made on other people's listings show up here."}
          </p>
          <Link href="/marketplace" className="btn btn--ghost">
            Browse the marketplace
          </Link>
        </Rv>
      )}

      {(page > 1 || hasMore) && (
        <nav className="mt-8 flex items-center justify-between gap-3" aria-label="Pagination">
          {page > 1 ? (
            <Link
              href={withParams("/offers", params, { page: page - 1 === 1 ? undefined : String(page - 1) })}
              className="btn btn--ghost"
              rel="prev"
            >
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="microlabel">Page {page}</span>
          {hasMore ? (
            <Link
              href={withParams("/offers", params, { page: String(page + 1) })}
              className="btn btn--ghost"
              rel="next"
            >
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      <Foot
        left="DRVN — offers expire 72 hours after they're made"
        right={<Link href="/orders">Back to orders →</Link>}
      />
    </div>
  );
}
