"use client";

import Link from "next/link";
import { Fragment, useState } from "react";

import { Countdown } from "@/components/livesheet";
import { Media } from "@/components/ui";
import type { ListingStatus } from "@/lib/database.types";
import { cx } from "@/lib/format";
import { formatPrice } from "@/lib/payments/fee";

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
        <span className="mt-1 block font-mono text-micro uppercase tracking-[0.1em] text-live">
          Offer expires <Countdown expiresAt={row.expiresAt} className="cd" />
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
 * This row used to render the full negotiation history inline: every offer
 * ever made, its counter, its clock, and a stale "Answer offers in Orders"
 * link, which meant a seller could read offers in three places and act on
 * them in none of them. Offers have one canonical home (/offers), so the
 * ledger says what needs deciding and hands over.
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

/**
 * The seller's ledger (Werkbank C1). A part list is the one genuinely tabular
 * surface in the app — a seller scans down views, watchers, asking and top
 * offer to decide what needs attention. Rows expand in place to the offer
 * situation rather than navigating away and losing the scan position; the
 * negotiation itself lives on /offers, which is its only home.
 */
export function ListingsLedger({ rows }: { rows: LedgerRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <table className="ledger">
      <thead>
        <tr>
          <th scope="col">
            <span className="sr-only">Expand</span>
          </th>
          <th scope="col" className="ledger__part">
            Part
          </th>
          <th scope="col">Source car</th>
          <th scope="col" className="text-right">
            Views
          </th>
          <th scope="col" className="text-right">
            Watch
          </th>
          <th scope="col" className="text-right">
            Asking
          </th>
          <th scope="col" className="text-right">
            Top offer
          </th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const open = openId === row.id;
          return (
            <Fragment key={row.id}>
              <tr className={cx(open && "is-open")}>
                <td>
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : row.id)}
                    className={cx("ledger__toggle", open && "is-on")}
                    aria-expanded={open}
                    aria-controls={`offers-${row.id}`}
                    aria-label={`${open ? "Hide" : "Show"} the offer situation on ${row.title}`}
                  >
                    ▸
                  </button>
                </td>

                <td className="ledger__part">
                  <span className="flex items-start gap-3">
                    <span className="order__img hidden sm:block">
                      <Media src={row.cover ?? undefined} alt={row.title} className="h-full w-full" role="row" />
                    </span>
                    <span className="min-w-0">
                      <Link
                        href={`/listings/${row.id}`}
                        className="order__name ledger__title transition-colors hover:text-live"
                        title={row.title}
                      >
                        {row.title}
                      </Link>
                      <span className="order__meta block">
                        {row.partNumber ? `Part no. ${row.partNumber}` : "No part number"}
                      </span>
                      <span className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                        <Link href={`/listings/${row.id}/edit`} className="relbtn !static">
                          Edit
                        </Link>
                        <ListingStatusActions id={row.id} status={row.status} />
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
                    <Link href={`/cars/${row.sourceCar.slug}`} className="jumplink whitespace-nowrap">
                      {row.sourceCar.name}
                    </Link>
                  ) : (
                    <span className="order__meta">Not linked to a car</span>
                  )}
                </td>

                <td className="ledger__num" data-label="Views">
                  {row.views > 0 ? row.views : "—"}
                </td>
                <td className="ledger__num" data-label="Watch">
                  {row.watchers > 0 ? row.watchers : "—"}
                </td>
                <td className="ledger__num" data-label="Asking">
                  {formatPrice(row.priceCents)}
                </td>
                <td
                  className={cx("ledger__num", row.topOfferCents !== null && "text-live")}
                  data-label="Top offer"
                >
                  {row.topOfferCents !== null ? formatPrice(row.topOfferCents) : "—"}
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
                  <div className="pb-2 pl-[18px]">
                    <span className="microlabel">Offers on this listing</span>
                    <OfferSummary row={row} />
                  </div>
                </td>
              </tr>
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
