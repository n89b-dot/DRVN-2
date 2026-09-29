import Link from "next/link";
import type { ReactNode } from "react";

import { Avatar, Media } from "@/components/ui";
import { cx, initialsOf } from "@/lib/format";

/**
 * Person-first messaging, the DRVN side (20260928). A conversation is one
 * person; the orders and offers between you are its deals. These render a
 * person's inbox row, a deal as a chip or a card, and a live offer inside the
 * thread. They know deals exist; they don't fetch or decide anything.
 */

export type DealTone = "move" | "ok" | "quiet";

/** Which side you're on, which part, where it stands. `move` = your turn. */
export function DealChip({
  side,
  title,
  label,
  tone = "quiet",
}: {
  side: "buying" | "selling";
  title: string;
  label: string;
  tone?: DealTone;
}) {
  return (
    <span className={cx("dealchip", tone === "move" && "dealchip--move", tone === "ok" && "dealchip--ok")}>
      <span className="dealchip__side">{side === "buying" ? "Buying" : "Selling"}</span>
      <span className="dealchip__title">{title}</span>
      <span aria-hidden="true">·</span>
      <span>{label}</span>
    </span>
  );
}

/** One person in the inbox: who, when, what was said, and the deals between you. */
export function ConversationRow({
  href,
  active = false,
  name,
  avatar,
  when,
  whenLabel,
  preview,
  unread = 0,
  deals,
}: {
  href: string;
  /** The conversation open beside the list. */
  active?: boolean;
  name: string;
  avatar?: string | null;
  when?: string | null;
  whenLabel?: ReactNode;
  preview: ReactNode;
  unread?: number;
  /** DealChip children. */
  deals?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cx("convrow", active && "is-on", unread > 0 && "is-unread")}
      aria-current={active ? "page" : undefined}
    >
      <span className="convrow__avatar">
        {avatar ? <Media src={avatar} alt="" className="h-full w-full" role="avatar" /> : <Avatar size="sm" initials={initialsOf(name)} />}
      </span>
      <span className="convrow__body">
        <span className="convrow__top">
          <span className="convrow__name">
            {name}
            {unread > 0 && <span className="convrow__dot" aria-label={`${unread} unread`} />}
          </span>
          {when && (
            <time dateTime={when} className="convrow__when">
              {whenLabel}
            </time>
          )}
        </span>
        <span className="convrow__preview">{preview}</span>
        {deals && <span className="convrow__deals">{deals}</span>}
      </span>
    </Link>
  );
}

/** A deal in the conversation header: part, side and state, price, one action. */
export function DealCard({
  href,
  title,
  eyebrow,
  amount,
  image,
  tone = "quiet",
  action,
}: {
  href: string;
  title: string;
  /** "Selling · Paid" */
  eyebrow: string;
  amount: ReactNode;
  image?: string | null;
  tone?: DealTone;
  /** A ButtonLink — "Mark shipped", "Pay now". */
  action?: ReactNode;
}) {
  return (
    <div className={cx("dealcard", tone === "move" && "dealcard--move")}>
      <Media src={image ?? undefined} alt={title} className="dealcard__img" role="row" />
      <span className="dealcard__text">
        <span className="dealcard__eyebrow">{eyebrow}</span>
        <Link href={href} className="dealcard__title">
          {title}
        </Link>
        <span className="dealcard__amount">{amount}</span>
      </span>
      {action}
    </div>
  );
}

/** A live offer inside the conversation, with its decision where it's discussed. */
export function OfferCard({
  eyebrow,
  amount,
  note,
  move = false,
  block = false,
  children,
}: {
  eyebrow: ReactNode;
  amount: ReactNode;
  note?: ReactNode;
  /** It's the reader's decision. */
  move?: boolean;
  /** Full-width plate on a record page (the offer page) instead of a
   *  centred card inside a conversation. */
  block?: boolean;
  /** The actions. */
  children?: ReactNode;
}) {
  return (
    <div className={cx("offercard", move && "offercard--move", block && "offercard--block")}>
      <div className="offercard__top">
        <span className="microlabel">{eyebrow}</span>
        <span className="offercard__amount">{amount}</span>
      </div>
      {note && <p className="offercard__note">{note}</p>}
      {children}
    </div>
  );
}
