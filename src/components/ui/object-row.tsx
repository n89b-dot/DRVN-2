import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "@/lib/format";

import { Media, MEDIA_SIZES } from "./primitives";

/**
 * The `.order` dense-row recipe as a structural contract — leading media
 * plate, name, dim meta line, trailing actions — inside a `.rowlist`.
 * The row every collection surface (saved, cart, checkout items, payment
 * methods, inbox, task lists) previously re-typed by hand.
 *
 * This is the *structural* row. Object-specific compositions (a seller's
 * listing, an offer, an order line) layer on top of it in the domain layer;
 * business meaning never lives here.
 */
export function ObjectRow({
  href,
  as: Tag = "div",
  state,
  media,
  mediaHref,
  leading,
  title,
  meta,
  actions,
  className,
  children,
}: {
  /** Makes the whole row a navigation (`<Link className="order">`). */
  href?: string;
  /** Row element when not a link — "div", "li", or "label" (radio rows). */
  as?: "div" | "li" | "label";
  /** Lifecycle tint: `is-done`, `is-gone`, `is-invalid`. */
  state?: "done" | "gone" | "invalid";
  /** Leading media — `{src, alt}` renders the `.order__img` plate (with the
   *  undrawn fallback); use `leading` instead for an Avatar or custom node. */
  media?: { src?: string; alt: string };
  /** Wraps the media plate in its own link (rows whose body isn't a link). */
  mediaHref?: string;
  /** Custom leading node (e.g. `<Avatar/>`) when `media` doesn't fit. */
  leading?: ReactNode;
  title?: ReactNode;
  meta?: ReactNode;
  /** Trailing slot (`.order__actions`) — chips, forms, `quiet` buttons. */
  actions?: ReactNode;
  className?: string;
  /** Extra direct children after the meta line (rare). */
  children?: ReactNode;
}) {
  // `.order`'s child rule (`> *:not(.order__img):not(.order__actions)`) makes
  // any other direct child the flexing body — so the media *wrapper* must be
  // the element carrying `.order__img`, link or not.
  const plate = media ? (
    mediaHref ? (
      <Link href={mediaHref} className="order__img">
        <Media src={media.src} alt={media.alt} className="h-full w-full" sizes={MEDIA_SIZES.row} />
      </Link>
    ) : (
      <Media src={media.src} alt={media.alt} className="order__img" sizes={MEDIA_SIZES.row} />
    )
  ) : (
    leading ?? null
  );

  // Name over meta, as one text column. As two sibling flex children they
  // sat side by side on desktop (the price floating mid-row) and landed in
  // different grid columns on phones — which is why callers took to nesting
  // meta spans inside `title`, where they inherited the name's weight.
  const hasMeta = meta !== undefined && meta !== null;
  const text = hasMeta ? (
    <div className="min-w-0">
      {title !== undefined && <p className="order__name">{title}</p>}
      <p className="order__meta">{meta}</p>
      {children}
    </div>
  ) : (
    <>
      {title !== undefined && <p className="order__name">{title}</p>}
      {children}
    </>
  );
  const body = (
    <>
      {plate}
      {text}
      {actions && <div className="order__actions">{actions}</div>}
    </>
  );

  const rowClass = cx("order", state && `is-${state}`, className);
  if (href) {
    return (
      <Link href={href} className={rowClass}>
        {body}
      </Link>
    );
  }
  return <Tag className={rowClass}>{body}</Tag>;
}
