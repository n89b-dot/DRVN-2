"use client";

import Link from "next/link";
import { Fragment, useState } from "react";

import { motion } from "motion/react";

import { Countdown } from "@/components/livesheet";
import { expand } from "@/lib/motion";
import { Icon, Media } from "@/components/ui";
import type { ListingStatus } from "@/lib/database.types";
import { cx } from "@/lib/format";
import { formatPrice } from "@/lib/payments/fee";

import { DeleteListing } from "./delete-listing";
import { ListingStatusActions } from "./status-actions";

export type LedgerOffer = {
  id: string;
  amount_cents: number;
  counter_amount_cents: number | null;
  status: string;
  expires_at: string | null;
  created_at: string;
  buyerName: string;
};

export type LedgerRow = {
  id: string;
  title: string;
  partNumber: string | null;
  cover: string | null;
  status: ListingStatus;
  priceCents: number;
  views: number;
  watchers: number;
  sourceCar: { slug: string; name: string } | null;
  /** Best live offer — the number a seller decides on. */
  topOfferCents: number | null;
  /** Soonest expiry among live offers; the row's clock. */
  expiresAt: string | null;
  offers: LedgerOffer[];
  unansweredQuestions: number;
};

/** A sortable column, resolved to a URL by the page (URL-addressable sort). */
export type LedgerSort = { key: string; label: string; href: string; active: boolean };

function StatusCell({ row }: { row: LedgerRow }) {
  const underOffer = row.topOfferCents !== null;
  const chip =
    row.status === "active"
      ? underOffer
        ? "chip chip--live"
        : "chip chip--ok"
      : row.status === "sold"
        ? "chip chip--ok"
        : "chip chip--spent";
  const label =
    row.status === "active" ? (underOffer ? "Under offer" : "Live") : row.status;

  return (
    <>
      <span className={chip}>{label}</span>
      {/* C2 — the offer window is the thing that forces a decision, so it
          rides in the row rather than making the seller open the order. */}
      {row.expiresAt && (
        <span className="ledger__sub text-live">
          Expires <Countdown expiresAt={row.expiresAt} className="cd" />
        </span>
      )}
    </>
  );
}

/** How many live offers to show before handing off to /offers. */
const PREVIEW_LIMIT = 2;

/**
 * The offer *situation* on a listing — not the offer product.
 *
 * The ledger says what needs deciding and hands over to /offers, which is the
 * negotiation's only home.
 */
function OfferSummary({ row }: { row: LedgerRow }) {
  const live = row.offers.filter((o) => o.status === "open" || o.status === "countered");
  const viewHref = `/offers?role=received&listing=${row.id}`;

  if (!row.offers.length) {
    return (
      <p className="py-1 font-mono text-micro uppercase tracking-[0.1em] text-dim">
        No offers on this listing yet
      </p>
    );
  }

  return (
    <div>
      <p className="ledgeroffers__line">
        <b>
          {live.length > 0
            ? `${live.length} active offer${live.length === 1 ? "" : "s"}`
            : "No active offers"}
        </b>
        {row.topOfferCents !== null && <> · Top offer {formatPrice(row.topOfferCents)}</>}
        {row.expiresAt && (
          <>
            {" · Earliest expiry "}
            <Countdown expiresAt={row.expiresAt} className="cd" />
          </>
        )}
        {row.offers.length > live.length && (
          <> · {row.offers.length - live.length} settled</>
        )}
      </p>

      {/* A short preview so a seller can decide without leaving the scan —
          two rows, never the whole thread. */}
      {live.length > 0 && (
        <ul className="ledgeroffers">
          {live.slice(0, PREVIEW_LIMIT).map((offer) => (
            <li key={offer.id}>
              <Link href={`/offers/${offer.id}`} className="ledgeroffers__row">
                <span className={cx("chip", "chip--live")}>{offer.status}</span>
                <span className="order__name min-w-0 truncate !text-body">
                  {offer.buyerName}
                </span>
                <span className="kv shrink-0 font-medium">
                  {formatPrice(offer.amount_cents)}
                  {offer.counter_amount_cents !== null && (
                    <> → {formatPrice(offer.counter_amount_cents)}</>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="pt-3">
        <Link href={viewHref} className="jumplink">
          {live.length > PREVIEW_LIMIT
            ? `View all ${row.offers.length} offers →`
            : "View offers →"}
        </Link>
      </p>
    </div>
  );
}

/** Sortable column header — the sort lives where the number lives. */
function SortableTh({
  sort,
  className,
}: {
  sort: LedgerSort;
  className?: string;
}) {
  return (
    <th scope="col" className={className} aria-sort={sort.active ? "descending" : undefined}>
      <Link
        href={sort.href}
        scroll={false}
        className={cx("ledger__th", sort.active && "is-on")}
        aria-current={sort.active ? "true" : undefined}
      >
        {sort.label}
        <span className="ledger__tharrow" aria-hidden="true">
          ↓
        </span>
      </Link>
    </th>
  );
}

/**
 * The seller's ledger (Werkbank C1). A part list is the one genuinely tabular
 * surface in the app — a seller scans down views, watchers, asking and top
 * offer to decide what needs attention.
 *
 * Reference grammar (Shopify / Square / Fresha product tables):
 *   · one register per row — the title is a handle, actions appear on
 *     hover/focus rather than sitting in every row as permanent furniture;
 *   · the whole row is the disclosure — clicking anywhere that isn't a link
 *     opens the offer situation in place, so the caret is a signpost, not a
 *     14px target carrying the entire interaction;
 *   · sort lives in the column headers, where every product table keeps it,
 *     instead of a second row of the same words above the table.
 */
export function ListingsLedger({
  rows,
  sorts = [],
}: {
  rows: LedgerRow[];
  /** Sortable columns by key — views/watch/asking/top_offer. */
  sorts?: LedgerSort[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  const sortFor = (key: string) => sorts.find((s) => s.key === key);
  const th = (key: string, fallback: string, className?: string) => {
    const sort = sortFor(key);
    return sort ? (
      <SortableTh sort={sort} className={className} />
    ) : (
      <th scope="col" className={className}>
        {fallback}
      </th>
    );
  };

  // Row click = disclosure. Links and buttons inside the row keep their own
  // meaning; the caret button remains the keyboard/AT toggle.
  const onRowClick = (event: React.MouseEvent, id: string) => {
    const target = event.target as HTMLElement;
    if (target.closest("a, button, input")) return;
    setOpenId(openId === id ? null : id);
  };

  return (
    <>
      {/* The table head disappears below 861px, and the column sort with it —
          a compact sort row stands in at those widths only. */}
      {sorts.length > 0 && (
        <div className="ledger__sortbar" role="group" aria-label="Sort listings">
          <span className="microlabel">Sort</span>
          {sorts.map((s) => (
            <Link
              key={s.key}
              href={s.href}
              scroll={false}
              className={cx("jumplink", s.active && "!border-live !text-live")}
              aria-current={s.active ? "true" : undefined}
            >
              {s.label}
            </Link>
          ))}
        </div>
      )}

      <table className="ledger ledger--expand">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Offers</span>
            </th>
            <th scope="col" className="ledger__part">
              Part
            </th>
            <th scope="col">Source car</th>
            {th("views", "Views", "text-right")}
            {th("watch", "Watch", "text-right")}
            {th("asking", "Asking", "text-right")}
            {th("top_offer", "Top offer", "text-right")}
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const open = openId === row.id;
            const liveOffers = row.offers.filter(
              (o) => o.status === "open" || o.status === "countered"
            ).length;
            return (
              <Fragment key={row.id}>
                <tr
                  className={cx("ledger__row", open && "is-open")}
                  onClick={(event) => onRowClick(event, row.id)}
                >
                  <td>
                    <button
                      type="button"
                      onClick={() => setOpenId(open ? null : row.id)}
                      className={cx("ledger__toggle", open && "is-on")}
                      aria-expanded={open}
                      aria-controls={`offers-${row.id}`}
                      aria-label={`${open ? "Hide" : "Show"} offers on ${row.title}`}
                    >
                      {/* The same chevron the rail's section disclosure uses —
                          one disclosure grammar across the app, and an SVG
                          scales to a size you can actually see (the ▸ glyph
                          stayed tiny however much font-size it was given). */}
                      <Icon name="back" className="h-[14px] w-[14px]" />
                    </button>
                  </td>

                  <td className="ledger__part">
                    <span className="flex items-center gap-3">
                      <span className="order__img hidden sm:block">
                        <Media
                          src={row.cover ?? undefined}
                          alt={row.title}
                          className="h-full w-full"
                          role="row"
                        />
                      </span>
                      <span className="min-w-0">
                        <Link
                          href={`/listings/${row.id}`}
                          className="order__name ledger__title transition-colors hover:text-live"
                          title={row.title}
                        >
                          {row.title}
                        </Link>
                        {/* Second line only when it says something: an absent
                            part number is not information. */}
                        {row.partNumber && (
                          <span className="order__meta block">Part no. {row.partNumber}</span>
                        )}
                        {/* Working controls appear when the row is engaged —
                            hover, keyboard focus, or open — and stay put on
                            touch layouts, where there is no hover to reveal
                            them. */}
                        <span className="ledger__acts mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                          <Link href={`/listings/${row.id}/edit`} className="relbtn !static">
                            Edit
                          </Link>
                          <ListingStatusActions id={row.id} status={row.status} />
                          {/* Full deletion, not just archiving — for any row
                              the DB delete guard allows. Reserved/sold rows
                              keep their history and can only be archived. */}
                          {row.status !== "reserved" &&
                            row.status !== "sold" &&
                            row.status !== "removed" && (
                              <DeleteListing listingId={row.id} triggerLabel="Delete" />
                            )}
                          {row.unansweredQuestions > 0 && (
                            <Link href={`/listings/${row.id}#qa`} className="chip chip--live">
                              {row.unansweredQuestions} question
                              {row.unansweredQuestions === 1 ? "" : "s"}
                            </Link>
                          )}
                        </span>
                      </span>
                    </span>
                  </td>

                  <td>
                    {row.sourceCar ? (
                      <Link
                        href={`/cars/${row.sourceCar.slug}`}
                        className="jumplink whitespace-nowrap"
                      >
                        {row.sourceCar.name}
                      </Link>
                    ) : (
                      <span className="order__meta" aria-label="Not linked to a car">
                        —
                      </span>
                    )}
                  </td>

                  <td className="ledger__num" data-label="Views">
                    <span className="ledger__figure">{row.views > 0 ? row.views : "—"}</span>
                  </td>
                  <td className="ledger__num" data-label="Watch">
                    <span className="ledger__figure">{row.watchers > 0 ? row.watchers : "—"}</span>
                  </td>
                  <td className="ledger__num" data-label="Asking">
                    <span className="ledger__figure">{formatPrice(row.priceCents)}</span>
                  </td>
                  <td
                    className={cx("ledger__num", row.topOfferCents !== null && "text-live")}
                    data-label="Top offer"
                  >
                    <span className="ledger__figure">
                      {row.topOfferCents !== null ? formatPrice(row.topOfferCents) : "—"}
                    </span>
                    {/* The disclosure's own signpost: the row that has offers
                        says so where the money is. */}
                    {liveOffers > 0 && (
                      <span className="ledger__sub ledger__offershint">
                        {liveOffers} offer{liveOffers === 1 ? "" : "s"} ▸
                      </span>
                    )}
                  </td>

                  <td>
                    <StatusCell row={row} />
                  </td>
                </tr>

                <tr
                  id={`offers-${row.id}`}
                  hidden={!open}
                  className={cx("ledger__detail", open && "is-open")}
                >
                  <td colSpan={8}>
                    {/* The row keeps its `hidden` semantics; the unfold
                        happens inside the cell so opening reads as the
                        ledger making room rather than a content pop. */}
                    <motion.div
                      className="overflow-hidden"
                      variants={expand}
                      initial="collapsed"
                      animate={open ? "expanded" : "collapsed"}
                    >
                      <div className="pb-2 pl-[18px]">
                        <span className="microlabel">Offers on this listing</span>
                        <OfferSummary row={row} />
                      </div>
                    </motion.div>
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
