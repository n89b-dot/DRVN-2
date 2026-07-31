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
        <span className="mt-1 block font-mono text-[11px] uppercase tracking-[0.1em] text-live">
          Offer expires <Countdown expiresAt={row.expiresAt} className="cd" />
        </span>
      )}
    </>
  );
}

function OfferHistory({ row }: { row: LedgerRow }) {
  if (!row.offers.length) {
    return (
      <p className="py-1 font-mono text-[12.5px] uppercase tracking-[0.1em] text-dim">
        No offers on this listing yet
      </p>
    );
  }

  return (
    <div className="rowlist">
      {row.offers.map((offer) => {
        const live = offer.status === "open" || offer.status === "countered";
        return (
          <div key={offer.id} className="jobrow">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="flex items-baseline gap-2">
                <span className={cx("chip", live ? "chip--live" : "chip--spent")}>
                  {offer.status}
                </span>
                <span className="order__name !text-[14.5px]">{offer.buyerName}</span>
              </span>
              <span className="kv font-medium">
                {formatPrice(offer.amount_cents)}
                {offer.counter_amount_cents !== null && (
                  <> → countered {formatPrice(offer.counter_amount_cents)}</>
                )}
              </span>
            </div>
            <p className="order__meta mt-0.5">
              Made {new Date(offer.created_at).toLocaleDateString()}
              {offer.expires_at && live && (
                <>
                  {" · lapses in "}
                  <Countdown expiresAt={offer.expires_at} className="cd" />
                </>
              )}
            </p>
          </div>
        );
      })}
      <div className="pt-3">
        <Link href="/orders" className="jumplink">
          Answer offers in Orders →
        </Link>
      </div>
    </div>
  );
}

/**
 * The seller's ledger (Werkbank C1). A part list is the one genuinely tabular
 * surface in the app — a seller scans down views, watchers, asking and top
 * offer to decide what needs attention. Rows expand in place to the offer
 * history rather than navigating away and losing the scan position.
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
          <th scope="col">Part</th>
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
                    aria-label={`${open ? "Hide" : "Show"} offer history for ${row.title}`}
                  >
                    ▸
                  </button>
                </td>

                <td>
                  <span className="flex items-start gap-3">
                    <span className="order__img hidden sm:block">
                      <Media src={row.cover ?? undefined} alt={row.title} className="h-full w-full" />
                    </span>
                    <span className="min-w-0">
                      <Link
                        href={`/listings/${row.id}`}
                        className="order__name block transition-colors hover:text-live"
                      >
                        {row.title}
                      </Link>
                      <span className="order__meta block">
                        {row.partNumber ? `Part no. ${row.partNumber}` : "No part number"}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1.5">
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
                    <span className="microlabel">Offer history</span>
                    <OfferHistory row={row} />
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
