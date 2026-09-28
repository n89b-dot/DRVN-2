import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import {
  Alert,
  ButtonLink,
  EmptyState,
  Foot,
  PageHead,
  SellingNav,
  Pagination,
  TileHead,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring";

import { OfferListRow, type OfferListItem } from "./offer-list-row";

export const metadata = { title: "Offers - DRVN" };

const PAGE_SIZE = 25;

const STATUSES = [
  "open",
  "countered",
  "accepted",
  "declined",
  "withdrawn",
  "expired",
] as const;
type StatusFilter = (typeof STATUSES)[number];

function isStatus(value: string | undefined): value is StatusFilter {
  return !!value && (STATUSES as readonly string[]).includes(value);
}

function withParams(
  base: string,
  params: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>,
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `${base}?${query}` : base;
}

/** A UUID, and nothing else — the listing filter goes straight into a query. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The canonical negotiation surface, for both sides of the marketplace.
 *
 * This used to be two capped, unpaginated queries inlined on /orders (25
 * each, no way to see older offers, no way to filter). Offers now get their
 * own list with role/status filters, a listing scope the seller's ledger
 * hands over, and real pagination — and each row links to a full thread
 * rather than rendering its conversation inline.
 */
export default async function OffersPage({
  searchParams,
}: {
  searchParams: Promise<{
    role?: string;
    status?: string;
    page?: string;
    offer?: string;
    listing?: string;
  }>;
}) {
  const {
    role: roleParam,
    status: statusParam,
    page: pageParam,
    offer: legacyOfferId,
    listing: listingParam,
  } = await searchParams;

  // Legacy `/orders?offer=<id>` and other query-param deep links land here —
  // fragment links (`#offer-<id>`) can't be read server-side at all, so
  // those had to be fixed at the source (the link builders that emit them).
  if (legacyOfferId) redirect(`/offers/${legacyOfferId}`);

  let role: "made" | "received" = roleParam === "made" ? "made" : "received";
  const status = isStatus(statusParam) ? statusParam : undefined;
  // `?listing=<id>` is how the seller's ledger hands a listing over to its
  // canonical offers surface. Ignored unless it's a well-formed id.
  const listingFilter =
    listingParam && UUID_RE.test(listingParam) ? listingParam : undefined;
  const page = Math.max(1, Number(pageParam) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // No explicit tab: someone who has never listed a part only makes offers,
  // so they open on Made rather than an empty Received.
  if (roleParam !== "made" && roleParam !== "received") {
    const { count: listingCount } = await supabase
      .from("listings")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", user.id);
    if (!listingCount) role = "made";
  }

  // The listing rides along on the offer row via a join — for "received"
  // that join is also the scope (offers on listings this user sells), which
  // used to cost a separate fetch of up to 2000 listing ids before anything
  // else could run. With it gone, the page list and both tab counts are one
  // parallel round instead of three serial ones.
  let query =
    role === "received"
      ? supabase
          .from("offers")
          .select("*, listings!inner(id, title, seller_id, price_cents)", { count: "exact" })
          .eq("listings.seller_id", user.id)
      : supabase
          .from("offers")
          .select("*, listings!inner(id, title, seller_id, price_cents)", { count: "exact" })
          .eq("buyer_id", user.id);

  if (status) query = query.eq("status", status);
  // Narrowing to a listing composes with role and status rather than
  // replacing them — and it can't widen access: `received` is still bounded
  // by the seller's own listings via the join, `made` by their buyer_id.
  if (listingFilter) query = query.eq("listing_id", listingFilter);

  // Everything this role has ever held, unfiltered — when it's nothing, the
  // status filters have nothing to refine and stay off the page.
  const roleTotalQuery =
    role === "received"
      ? supabase
          .from("offers")
          .select("id, listings!inner(id)", { count: "exact", head: true })
          .eq("listings.seller_id", user.id)
      : supabase
          .from("offers")
          .select("id", { count: "exact", head: true })
          .eq("buyer_id", user.id);

  const [
    { data: offers, count, error },
    { count: receivedOpenCount },
    { count: madeCounteredCount },
    { count: roleTotal },
  ] = await Promise.all([
    query.order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1),
    supabase
      .from("offers")
      .select("id, listings!inner(id)", { count: "exact", head: true })
      .eq("listings.seller_id", user.id)
      .eq("status", "open"),
    supabase
      .from("offers")
      .select("id", { count: "exact", head: true })
      .eq("buyer_id", user.id)
      .eq("status", "countered"),
    roleTotalQuery,
  ]);

  if (error) reportError("[offers] failed to load offers", error);

  const rows = offers ?? [];
  const offerIds = rows.map((o) => o.id);
  const listingIds = [...new Set(rows.map((o) => o.listing_id))];
  const listingById = new Map(rows.map((o) => [o.listing_id, o.listings]));

  const counterpartyIds = [
    ...new Set(
      role === "received"
        ? rows.map((o) => o.buyer_id)
        : rows.map((o) => o.listings?.seller_id ?? null),
    ),
  ].filter((x): x is string => Boolean(x) && x !== user.id);

  // Everything left depends only on the rows above, so it's one round:
  // covers, counterparty names, unread flags.
  const [{ data: images }, { data: people }, { data: unreadRows }] =
    await Promise.all([
      listingIds.length
        ? supabase
            .from("listing_images")
            .select("listing_id, url, position")
            .in("listing_id", listingIds)
            .order("position")
        : Promise.resolve({ data: [] }),
      counterpartyIds.length
        ? supabase
            .from("profiles")
            .select("id, display_name, username")
            .in("id", counterpartyIds)
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
    if (!coverByListing.has(image.listing_id))
      coverByListing.set(image.listing_id, image.url);
  }
  const unreadOffers = new Set(
    (unreadRows ?? []).map((m) => m.offer_id).filter(Boolean),
  );

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
    const listing = o.listings;
    return {
      id: o.id,
      listing_id: o.listing_id,
      listing_title: listing?.title ?? "Listing",
      listing_cover_url: coverByListing.get(o.listing_id) ?? null,
      asking_cents: listing?.price_cents ?? null,
      counterparty_name:
        role === "received"
          ? nameFor(o.buyer_id)
          : nameFor(listing?.seller_id ?? null),
      amount_cents: o.amount_cents,
      counter_amount_cents: o.counter_amount_cents,
      status: o.status,
      created_at: o.created_at,
      expiresLabel: expiresLabel(o.expires_at),
      unread: unreadOffers.has(o.id),
      // The same definition the rail badge counts: an open offer you received,
      // or a counter that came back on one you made. Never "an offer exists".
      needsYou:
        role === "received" ? o.status === "open" : o.status === "countered",
    };
  });

  const total = count ?? 0;
  const hasMore = from + PAGE_SIZE < total;
  const firstOnPage = total === 0 ? 0 : from + 1;
  const lastOnPage = from + items.length;
  const attentionCount = (receivedOpenCount ?? 0) + (madeCounteredCount ?? 0);
  // The listing filter travels with every other control on the page, so
  // switching role or status keeps the scope you're in. The title comes from
  // the rows where possible; a scope with no rows on this page (a status
  // filter that matches nothing) still has to be able to name itself.
  let scopedListingTitle: string | null = null;
  if (listingFilter) {
    scopedListingTitle = listingById.get(listingFilter)?.title ?? null;
    if (!scopedListingTitle) {
      const { data: scoped } = await supabase
        .from("listings")
        .select("title")
        .eq("id", listingFilter)
        .maybeSingle();
      scopedListingTitle = scoped?.title ?? null;
    }
  }

  const params = {
    role: roleParam,
    status: statusParam,
    page: pageParam,
    listing: listingFilter,
  };

  return (
    <div className="wrap">
      <SellingNav current="offers" offersCount={attentionCount} />
      {/* A plain task title: "Every offer, in one place." repeated the
          Messages formula word for word. The counts that need the reader
          ride in the eyebrow. */}
      <PageHead
        className="pagehead--task"
        eyebrow={
          <>
            Negotiations
            {(receivedOpenCount ?? 0) > 0 && (
              <>
                {" · "}
                <span className="microlabel--live">{receivedOpenCount} received open</span>
              </>
            )}
            {(madeCounteredCount ?? 0) > 0 && (
              <>
                {" · "}
                <span className="microlabel--live">{madeCounteredCount} countered on you</span>
              </>
            )}
          </>
        }
        title="Offers"
        sub="Answer what's come in, track what you've sent, open any thread."
      />
      {/* Arrived from a listing in the ledger: name the scope and give it an
          obvious way out, so a filtered list never reads as an empty inbox. */}
      {listingFilter && (
        <div className="scopebar">
          <span className="scopebar__what">
            <span className="microlabel">Filtered</span>
            <span className="mt-1 block text-body">
              Offers on <b>{scopedListingTitle ?? "this listing"}</b>
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-4">
            <Link href={`/listings/${listingFilter}`} className="jumplink">
              Open the listing →
            </Link>
            <Link
              href={withParams("/offers", params, {
                listing: undefined,
                page: undefined,
              })}
              className="jumplink"
            >
              Clear filter ×
            </Link>
          </span>
        </div>
      )}

      {/* Role leads, status refines — the same two-tier shape Listings and
          Orders use, so the family's filter rows read identically. */}
      <div
        className="filters filters--stack filters--scroll"
        role="group"
        aria-label="Offer role"
      >
        <span className="microlabel filters__label">Show</span>
        <Link
          href={withParams("/offers", params, {
            role: undefined,
            page: undefined,
          })}
          className={`fbtn ${role === "received" ? "is-on" : ""}`}
          aria-current={role === "received" ? "true" : undefined}
        >
          Received
          {(receivedOpenCount ?? 0) > 0 ? ` (${receivedOpenCount})` : ""}
        </Link>
        <Link
          href={withParams("/offers", params, {
            role: "made",
            page: undefined,
          })}
          className={`fbtn ${role === "made" ? "is-on" : ""}`}
          aria-current={role === "made" ? "true" : undefined}
        >
          Made
        </Link>
      </div>

      {/* Status refines a list; over a role with no offers at all it was
          seven chips of chrome with nothing behind them. A status already in
          the URL keeps its row so it can be cleared. */}
      {((roleTotal ?? 0) > 0 || status) && (
      <div
        className="filters filters--sub filters--scroll"
        role="group"
        aria-label="Offer status"
      >
        <span className="microlabel filters__label">Status</span>
        <Link
          href={withParams("/offers", params, {
            status: undefined,
            page: undefined,
          })}
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
      )}

      {error ? (
        <Alert tone="live" title="Couldn't load offers">
          Try refreshing — if this keeps happening, it&apos;s on us.
        </Alert>
      ) : items.length > 0 ? (
        <Rv className="tile">
          <TileHead
            label={
              <>
                {total === 1 ? "1 offer" : `${total} offers`}
                {total > PAGE_SIZE && (
                  <>
                    {" · "}
                    showing {firstOnPage}–{lastOnPage}
                  </>
                )}
              </>
            }
          />
          <div className="rowlist">
            {items.map((offer) => (
              <OfferListRow
                key={offer.id}
                offer={offer}
                incoming={role === "received"}
              />
            ))}
          </div>
        </Rv>
      ) : (
        <EmptyState
          mark="⏱"
          title={listingFilter || status ? "No offers here" : role === "received" ? "No offers yet" : "You haven't made an offer"}
          action={
            listingFilter || status ? (
              <ButtonLink
                variant="ghost"
                href={withParams("/offers", params, {
                  listing: undefined,
                  status: undefined,
                  page: undefined,
                })}
              >
                Show all offers
              </ButtonLink>
            ) : role === "received" ? (
              <ButtonLink variant="ghost" href="/listings">
                My listings
              </ButtonLink>
            ) : (
              <ButtonLink variant="ghost" href="/marketplace">
                Browse the marketplace
              </ButtonLink>
            )
          }
        >
          {listingFilter || status
            ? "Nothing matches this filter right now."
            : role === "received"
              ? "When someone offers on one of your listings it lands here. A lowest-offer floor on each listing (set it when you edit) declines lowballs for you."
              : "Make an offer from any part's page and it's tracked here until the seller answers."}
        </EmptyState>
      )}

      <Pagination
        page={page}
        hasMore={hasMore}
        hrefFor={(p) =>
          withParams("/offers", params, {
            page: p === 1 ? undefined : String(p),
          })
        }
        className="!mt-8"
      />

      {/* The expiry rule belongs here — this is the offers surface. It used
          to be footed on /orders too, where it explained nothing. */}
      <Foot
        left="DRVN — offers expire 72 hours after they're made"
        right={<Link href="/messages">Messages →</Link>}
      />
    </div>
  );
}
