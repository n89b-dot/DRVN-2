import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Alert, EmptyState, Foot, SellingNav, Pagination, TileHead } from "@/components/ui";
import type {
  SellerListingStat,
  SellerRegisterTally,
} from "@/lib/database.types";
import { loadOffersNeedingAttention } from "@/lib/shell-counts";
import { createClient } from "@/lib/supabase/server";

import {
  ListingsLedger,
  type LedgerOffer,
  type LedgerRow,
} from "./listings-ledger";
import { reportError } from "@/lib/monitoring";

export const metadata = { title: "My Listings - DRVN" };

/**
 * Werkbank's registers: everything, live, under offer, and each of the
 * publish states a listing can sit in. Drafts and paused/archived listings
 * used to have nowhere to be filtered into — they were only reachable by
 * scrolling "All" — so each status gets its own chip.
 */
type Register =
  | "all"
  | "live"
  | "offer"
  | "draft"
  | "paused"
  | "reserved"
  | "archived"
  | "sold";

/**
 * Eight equally-loud chips made the phone layout a wall and gave "Archived"
 * the same weight as "Under offer". The four a seller works from every day
 * lead; the rest are a quieter status row underneath, still URL-addressable
 * and still keyboard-reachable — nothing was hidden behind a disclosure.
 */
const PRIMARY_REGISTERS: { key: Register; label: string }[] = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
  { key: "offer", label: "Under offer" },
  { key: "draft", label: "Draft" },
];

const SECONDARY_REGISTERS: { key: Register; label: string }[] = [
  { key: "paused", label: "Paused" },
  { key: "reserved", label: "Reserved" },
  { key: "sold", label: "Sold" },
  { key: "archived", label: "Archived" },
];

const REGISTERS = [...PRIMARY_REGISTERS, ...SECONDARY_REGISTERS];

type SortKey = "top_offer" | "views" | "watch" | "asking" | "newest";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "top_offer", label: "Top offer" },
  { key: "views", label: "Views" },
  { key: "watch", label: "Watch" },
  { key: "asking", label: "Asking" },
];

const PAGE_SIZE = 50;

// Phrasing for the empty state's "Nothing ___" heading — kept distinct from
// the chip label ("Under offer" reads oddly as "Nothing under offer" → "on offer").
const EMPTY_REGISTER_PHRASE: Record<Register, string> = {
  all: "listed yet",
  live: "live",
  offer: "under offer",
  draft: "in draft",
  paused: "paused",
  reserved: "reserved",
  archived: "archived",
  sold: "sold",
};

const TALLY_FIELD: Record<Register, keyof SellerRegisterTally> = {
  all: "all_count",
  live: "live_count",
  offer: "offer_count",
  draft: "draft_count",
  paused: "paused_count",
  reserved: "reserved_count",
  archived: "archived_count",
  sold: "sold_count",
};

/**
 * The seller's ledger (Werkbank C1/C2). Replaces a flat card list with the
 * tabular scan a seller actually needs — views and watchers against asking and
 * the best live offer, with the offer window ticking in the row.
 *
 * Filtering, sorting, aggregation and pagination all happen in the
 * `seller_listing_stats` / `seller_register_tally` RPCs (migration 0030) —
 * the page only ever holds one page of rows plus the offers behind them.
 */
export default async function SellerListingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    register?: string;
    sort?: string;
    deleted?: string;
    page?: string;
  }>;
}) {
  const {
    register: registerParam,
    sort: sortParam,
    deleted,
    page: pageParam,
  } = await searchParams;
  const register: Register =
    REGISTERS.find((r) => r.key === registerParam)?.key ?? "all";
  const sort: SortKey =
    SORTS.find((s) => s.key === sortParam)?.key ?? "top_offer";
  const page = Math.max(1, Number(pageParam) || 1);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const fetchStats = (forPage: number) =>
    supabase.rpc("seller_listing_stats", {
      p_seller: user.id,
      p_register: register,
      p_sort: sort,
      p_limit: PAGE_SIZE,
      p_offset: (forPage - 1) * PAGE_SIZE,
    });

  const [statsRes, tallyRes, questionsRes, offersCount] = await Promise.all([
    fetchStats(page),
    supabase.rpc("seller_register_tally", { p_seller: user.id }),
    supabase.rpc("seller_open_questions", { p_seller: user.id }),
    loadOffersNeedingAttention(supabase, user.id),
  ]);

  // Fail soft when 0030 hasn't been applied yet (or the RPC errors): the
  // ledger renders empty rather than crashing, and the error is on record.
  if (statsRes.error)
    reportError("[listings] seller_listing_stats failed", statsRes.error);
  if (tallyRes.error)
    reportError("[listings] seller_register_tally failed", tallyRes.error);
  // 0035 — a missing function must not take the ledger down with it.
  if (questionsRes.error)
    reportError("[listings] seller_open_questions failed", questionsRes.error);
  const openQuestions = questionsRes.error ? 0 : (questionsRes.data ?? 0);

  const tallyRow: SellerRegisterTally | null = tallyRes.data?.[0] ?? null;
  const tally = (key: Register) => tallyRow?.[TALLY_FIELD[key]] ?? 0;

  let stats: SellerListingStat[] = statsRes.data ?? [];
  // The window count travels on every row; an empty page falls back to the
  // chip tally (same register semantics) so a stale ?page can be clamped.
  let total = stats[0]?.total_count ?? tally(register);
  const clampedPage = Math.min(page, Math.max(1, Math.ceil(total / PAGE_SIZE)));
  if (clampedPage !== page && total > 0 && !statsRes.error) {
    // A stale page number pointing past the end of the filtered set: refetch
    // the real last page instead of showing an empty table.
    const retry = await fetchStats(clampedPage);
    if (retry.error)
      reportError("[listings] seller_listing_stats failed", retry.error);
    stats = retry.data ?? [];
    total = stats[0]?.total_count ?? total;
  }

  const listingIds = stats.map((s) => s.id);
  const carIds = [
    ...new Set(stats.map((s) => s.source_car_id).filter(Boolean)),
  ] as string[];

  // Offer history only for the rows on screen — the expandable detail is the
  // one thing the RPC doesn't aggregate.
  const [offersRes, carsRes] = await Promise.all([
    listingIds.length
      ? supabase
          .from("offers")
          .select(
            "id, listing_id, buyer_id, amount_cents, counter_amount_cents, status, expires_at, created_at",
          )
          .in("listing_id", listingIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    carIds.length
      ? supabase.from("cars").select("id, name, slug").in("id", carIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (offersRes.error)
    reportError("[listings] offers failed to load", offersRes.error);
  if (carsRes.error)
    reportError("[listings] cars failed to load", carsRes.error);
  const offers = offersRes.data ?? [];

  const buyerIds = [...new Set(offers.map((o) => o.buyer_id))];
  const { data: buyers } = buyerIds.length
    ? await supabase
        .from("profiles")
        .select("id, display_name, username")
        .in("id", buyerIds)
    : { data: [] };
  const buyerById = new Map((buyers ?? []).map((b) => [b.id, b]));
  const buyerName = (id: string) => {
    const b = buyerById.get(id);
    return b?.display_name ?? (b?.username ? `@${b.username}` : "A buyer");
  };

  const offersByListing = new Map<string, LedgerOffer[]>();
  for (const o of offers) {
    const list = offersByListing.get(o.listing_id) ?? [];
    list.push({
      id: o.id,
      amount_cents: o.amount_cents,
      counter_amount_cents: o.counter_amount_cents,
      status: o.status,
      expires_at: o.expires_at,
      created_at: o.created_at,
      buyerName: buyerName(o.buyer_id),
    });
    offersByListing.set(o.listing_id, list);
  }
  const carById = new Map((carsRes.data ?? []).map((c) => [c.id, c]));

  const rows: LedgerRow[] = stats.map((s) => {
    const car = s.source_car_id ? carById.get(s.source_car_id) : null;
    return {
      id: s.id,
      title: s.title,
      partNumber: s.part_number,
      cover: s.cover_url,
      status: s.status,
      priceCents: s.price_cents,
      views: s.view_count ?? 0,
      watchers: s.watch_count ?? 0,
      sourceCar: car ? { slug: car.slug, name: car.name } : null,
      topOfferCents: s.top_offer_cents,
      expiresAt: s.soonest_offer_expiry,
      offers: offersByListing.get(s.id) ?? [],
      unansweredQuestions: s.unanswered_questions ?? 0,
    };
  });

  const pageFrom = (clampedPage - 1) * PAGE_SIZE;
  const hasMore = pageFrom + rows.length < total;

  const href = (
    next: Partial<{ register: Register; sort: SortKey; page: number }>,
  ) => {
    const params = new URLSearchParams();
    const r = next.register ?? register;
    const s = next.sort ?? sort;
    // Changing the filter or sort always resets to page 1 — a stale page
    // number pointing past the end of a newly-filtered set is worse than
    // just starting over.
    const p = "register" in next || "sort" in next ? undefined : next.page;
    if (r !== "all") params.set("register", r);
    if (s !== "top_offer") params.set("sort", s);
    if (p && p > 1) params.set("page", String(p));
    const q = params.toString();
    return q ? `/listings?${q}` : "/listings";
  };

  return (
    <div className="wrap">
      <SellingNav current="listings" offersCount={offersCount} />
      <Rv as="header" className="pagehead pagehead--task">
        <span className="microlabel">My Listings · your inventory</span>
        <h1>
          Every part you&apos;ve <span className="live-word">listed.</span>
        </h1>
        <p className="sub">
          Who&apos;s looking, who&apos;s watching, and the best offer on the
          table — with the clock running on each one.
        </p>
        <Link href="/settings#payouts" className="jumplink mt-2 inline-flex">
          View your payouts →
        </Link>
      </Rv>
      {/* The seller's working state, in four numbers. Each one is a filter or
          a queue — nothing here is a metric for its own sake. */}
      <div className="tally" role="group" aria-label="Listing summary">
        <Link
          href={href({ register: "live" })}
          scroll={false}
          className="tally__cell"
        >
          <span className="tally__n">{tally("live")}</span>
          <span className="tally__label">Live</span>
        </Link>
        <Link
          href={href({ register: "offer" })}
          scroll={false}
          className="tally__cell"
        >
          <span
            className={`tally__n ${tally("offer") > 0 ? "tally__n--live" : ""}`}
          >
            {tally("offer")}
          </span>
          <span className="tally__label">Under offer</span>
        </Link>
        <Link
          href={href({ register: "draft" })}
          scroll={false}
          className="tally__cell"
        >
          <span className="tally__n">{tally("draft")}</span>
          <span className="tally__label">Drafts</span>
        </Link>
        <span className="tally__cell">
          <span
            className={`tally__n ${openQuestions > 0 ? "tally__n--live" : ""}`}
          >
            {openQuestions}
          </span>
          <span className="tally__label">Questions to answer</span>
        </span>
      </div>

      {deleted && (
        <Alert tone="ok" ico="✓" title="Listing deleted" className="mb-6">
          Any past orders for it keep their record.
        </Alert>
      )}

      <div
        className="filters filters--stack filters--scroll"
        role="group"
        aria-label="Filter listings by status"
      >
        {PRIMARY_REGISTERS.map((r) => (
          <Link
            key={r.key}
            href={href({ register: r.key })}
            scroll={false}
            className={`fbtn ${r.key === register ? "is-on" : ""}`}
            aria-current={r.key === register ? "page" : undefined}
          >
            {r.label} {tally(r.key)}
          </Link>
        ))}
      </div>

      <div
        className="filters filters--sub filters--scroll"
        role="group"
        aria-label="Filter listings by other statuses"
      >
        <span className="microlabel filters__label">Status</span>
        {SECONDARY_REGISTERS.map((r) => (
          <Link
            key={r.key}
            href={href({ register: r.key })}
            scroll={false}
            className={`fbtn ${r.key === register ? "is-on" : ""}`}
            aria-current={r.key === register ? "page" : undefined}
          >
            {r.label} {tally(r.key)}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          className="undrawn--hero"
          mark="✎"
          title={
            register === "all"
              ? "Nothing listed yet"
              : `Nothing ${EMPTY_REGISTER_PHRASE[register]}`
          }
          action={
            <Link
              href={register === "all" ? "/sell" : "/listings"}
              className="btn btn--live"
            >
              {register === "all" ? "List a part" : "Show all listings"}
            </Link>
          }
        >
          {register === "all" ? (
            <>
              List your first part and it appears here with its views, watchers and offers.
              Already posted it somewhere else?{" "}
              <Link href="/sell/import" className="jumplink">
                Import an existing listing →
              </Link>
            </>
          ) : (
            "No listings match this filter right now."
          )}
        </EmptyState>
      ) : (
        <section className="deck">
          {/* Plain tile, deliberately outside the reveal system: sorting and
              filtering re-render this region on every click, and replaying an
              entrance spring each time read as the page dropping and
              re-settling. Working surfaces hold still. */}
          <div className="tile">
            <TileHead
              label={
                <>
                  {total === 1 ? "1 listing" : `${total} listings`}
                  {total > PAGE_SIZE && (
                    <>
                      {" · "}
                      showing {pageFrom + 1}–{pageFrom + rows.length}
                    </>
                  )}
                </>
              }
            />
            {/* Sort lives in the column headers, like every product table
                that works — not in a second row repeating the same words. */}
            <ListingsLedger
              rows={rows}
              sorts={SORTS.map((s) => ({
                key: s.key,
                label: s.label,
                href: href({ sort: s.key }),
                active: s.key === sort,
              }))}
            />

            <Pagination
              page={clampedPage}
              hasMore={hasMore}
              hrefFor={(p) => href({ page: p })}
            />
          </div>
        </section>
      )}

      <Foot
        left="DRVN — your listings"
        right={<Link href="/sell">List a part →</Link>}
      />
    </div>
  );
}
