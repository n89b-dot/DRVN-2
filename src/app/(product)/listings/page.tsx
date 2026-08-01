import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot } from "@/components/ui";
import { fetchWatchCounts } from "@/lib/marketplace/query";
import { createClient } from "@/lib/supabase/server";

import { ListingsLedger, type LedgerOffer, type LedgerRow } from "./listings-ledger";
import { reportError } from "@/lib/monitoring";

export const metadata = { title: "Your listings - DRVN" };

/**
 * Werkbank's registers: everything, live, under offer, and each of the
 * publish states a listing can sit in. Drafts and paused/archived listings
 * used to have nowhere to be filtered into — they were only reachable by
 * scrolling "All" — so each status gets its own chip.
 */
type Register = "all" | "live" | "offer" | "draft" | "paused" | "reserved" | "archived" | "sold";

const REGISTERS: { key: Register; label: string }[] = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
  { key: "offer", label: "Under offer" },
  { key: "draft", label: "Draft" },
  { key: "paused", label: "Paused" },
  { key: "reserved", label: "Reserved" },
  { key: "archived", label: "Archived" },
  { key: "sold", label: "Sold" },
];

type SortKey = "top_offer" | "views" | "watch" | "asking" | "newest";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "top_offer", label: "Top offer" },
  { key: "views", label: "Views" },
  { key: "watch", label: "Watch" },
  { key: "asking", label: "Asking" },
];

const LIVE_OFFER_STATES = ["open", "countered"];

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

function sortRows(rows: LedgerRow[], sort: SortKey): LedgerRow[] {
  const by = [...rows];
  switch (sort) {
    // Descending on every measure: a seller opens this page to find the
    // listing that most needs an answer, not the quietest one.
    case "top_offer":
      return by.sort((a, b) => (b.topOfferCents ?? -1) - (a.topOfferCents ?? -1));
    case "views":
      return by.sort((a, b) => b.views - a.views);
    case "watch":
      return by.sort((a, b) => b.watchers - a.watchers);
    case "asking":
      return by.sort((a, b) => b.priceCents - a.priceCents);
    default:
      return by;
  }
}

/**
 * The seller's ledger (Werkbank C1/C2). Replaces a flat card list with the
 * tabular scan a seller actually needs — views and watchers against asking and
 * the best live offer, with the offer window ticking in the row.
 */
export default async function SellerListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ register?: string; sort?: string; deleted?: string }>;
}) {
  const { register: registerParam, sort: sortParam, deleted } = await searchParams;
  const register: Register =
    REGISTERS.find((r) => r.key === registerParam)?.key ?? "all";
  const sort: SortKey = SORTS.find((s) => s.key === sortParam)?.key ?? "top_offer";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: listings, error } = await supabase
    .from("listings")
    .select(
      "id, title, part_number, price_cents, status, view_count, created_at, source_car_id"
    )
    .eq("seller_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) reportError("[listings] failed to load", error);

  const all = listings ?? [];
  const listingIds = all.map((l) => l.id);
  const carIds = [...new Set(all.map((l) => l.source_car_id).filter(Boolean))] as string[];

  const [{ data: images }, { data: offers }, { data: questions }, { data: cars }, watchCounts] =
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
            .select("id, listing_id, buyer_id, amount_cents, counter_amount_cents, status, expires_at, created_at")
            .in("listing_id", listingIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
      listingIds.length
        ? supabase
            .from("listing_questions")
            .select("id, listing_id, parent_id")
            .in("listing_id", listingIds)
        : Promise.resolve({ data: [] }),
      carIds.length
        ? supabase.from("cars").select("id, name, slug").in("id", carIds)
        : Promise.resolve({ data: [] }),
      fetchWatchCounts(supabase, listingIds),
    ]);

  const buyerIds = [...new Set((offers ?? []).map((o) => o.buyer_id))];
  const { data: buyers } = buyerIds.length
    ? await supabase.from("profiles").select("id, display_name, username").in("id", buyerIds)
    : { data: [] };
  const buyerName = (id: string) => {
    const b = (buyers ?? []).find((x) => x.id === id);
    return b?.display_name ?? (b?.username ? `@${b.username}` : "A buyer");
  };

  const cover = new Map<string, string>();
  for (const img of images ?? []) {
    if (!cover.has(img.listing_id)) cover.set(img.listing_id, img.url);
  }
  const carById = new Map((cars ?? []).map((c) => [c.id, c]));

  const unansweredFor = (id: string) => {
    const forListing = (questions ?? []).filter((q) => q.listing_id === id);
    const answered = new Set(forListing.filter((q) => q.parent_id).map((q) => q.parent_id));
    return forListing.filter((q) => !q.parent_id && !answered.has(q.id)).length;
  };

  const rows: LedgerRow[] = all.map((listing) => {
    const listingOffers = (offers ?? []).filter((o) => o.listing_id === listing.id);
    const live = listingOffers.filter((o) => LIVE_OFFER_STATES.includes(o.status));

    // The top offer is the best *live* one — a declined £2k offer is history,
    // not a number to price against.
    const topOfferCents = live.length
      ? Math.max(...live.map((o) => o.counter_amount_cents ?? o.amount_cents))
      : null;

    const expiries = live
      .map((o) => o.expires_at)
      .filter(Boolean)
      .sort() as string[];

    const car = listing.source_car_id ? carById.get(listing.source_car_id) : null;

    return {
      id: listing.id,
      title: listing.title,
      partNumber: listing.part_number,
      cover: cover.get(listing.id) ?? null,
      status: listing.status,
      priceCents: listing.price_cents,
      views: listing.view_count ?? 0,
      watchers: watchCounts.get(listing.id) ?? 0,
      sourceCar: car ? { slug: car.slug, name: car.name } : null,
      topOfferCents,
      expiresAt: expiries[0] ?? null,
      offers: listingOffers.map<LedgerOffer>((o) => ({
        id: o.id,
        amount_cents: o.amount_cents,
        counter_amount_cents: o.counter_amount_cents,
        status: o.status,
        expires_at: o.expires_at,
        created_at: o.created_at,
        buyerName: buyerName(o.buyer_id),
      })),
      unansweredQuestions: unansweredFor(listing.id),
    };
  });

  // Shared with the tally below so a chip's count always matches what
  // clicking it shows.
  const matchesRegister = (row: LedgerRow, key: Register) => {
    if (key === "all") return true;
    if (key === "live") return row.status === "active" && row.topOfferCents === null;
    if (key === "offer") return row.topOfferCents !== null;
    return row.status === key;
  };

  const visible = sortRows(
    rows.filter((row) => matchesRegister(row, register)),
    sort
  );
  const tally = (key: Register) => rows.filter((row) => matchesRegister(row, key)).length;

  const href = (next: Partial<{ register: Register; sort: SortKey }>) => {
    const params = new URLSearchParams();
    const r = next.register ?? register;
    const s = next.sort ?? sort;
    if (r !== "all") params.set("register", r);
    if (s !== "top_offer") params.set("sort", s);
    const q = params.toString();
    return q ? `/listings?${q}` : "/listings";
  };

  return (
    <div className="wrap">
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          Listings &amp; offers · {tally("live")} live · {tally("offer")} under offer
          {tally("draft") > 0 ? ` · ${tally("draft")} draft` : ""}
        </span>
        <h1>
          Every part you&apos;ve <span className="live-word">listed.</span>
        </h1>
        <p className="sub">
          Who&apos;s looking, who&apos;s watching, and the best offer on the table — with the
          clock running on each one.
        </p>
        <Link href="/payouts" className="jumplink mt-2 inline-flex">
          View your payout ledger →
        </Link>
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

      <div className="filters" role="group" aria-label="Filter listings by status">
        {REGISTERS.map((r) => (
          <Link
            key={r.key}
            href={href({ register: r.key })}
            className={`fbtn ${r.key === register ? "is-on" : ""}`}
            aria-current={r.key === register ? "page" : undefined}
          >
            {r.label} {tally(r.key)}
          </Link>
        ))}
      </div>

      {visible.length === 0 ? (
        <Rv className="undrawn undrawn--hero">
          <span className="undrawn__mark" aria-hidden="true">
            ✎
          </span>
          <h3>{register === "all" ? "Nothing listed yet" : `Nothing ${EMPTY_REGISTER_PHRASE[register]}`}</h3>
          <p>
            {register === "all"
              ? "List your first part and it appears here with its views, watchers and offers."
              : "No listings match this filter right now."}
          </p>
          <Link href={register === "all" ? "/sell" : "/listings"} className="btn btn--live">
            {register === "all" ? "List a part" : "Show all listings"}
          </Link>
        </Rv>
      ) : (
        <section className="deck">
          <Rv className="tile">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">
                Your listings · click a row for offer history
              </span>
              <span className="flex flex-wrap items-baseline gap-3">
                <span className="microlabel">Sort</span>
                {SORTS.map((s) => (
                  <Link
                    key={s.key}
                    href={href({ sort: s.key })}
                    className={`jumplink ${s.key === sort ? "!border-live !text-live" : ""}`}
                    aria-current={s.key === sort ? "true" : undefined}
                  >
                    {s.label}
                    {s.key === sort ? " ↓" : ""}
                  </Link>
                ))}
              </span>
            </div>
            <ListingsLedger rows={visible} />
          </Rv>
        </section>
      )}

      <Foot
        left="DRVN — your listings"
        right={<Link href="/sell">List a part →</Link>}
      />
    </div>
  );
}
