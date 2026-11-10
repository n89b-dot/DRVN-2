import type { Metadata } from "next";

import { conditionLabel, formatPrice } from "@/lib/marketplace/taxonomy";
import { ogImageSource } from "@/lib/media-url";
import { vehicleLabel } from "@/lib/vehicles/label";

/**
 * The words DRVN says about itself to search engines and link previews.
 *
 * A source car is optional: a seller links one on the sell form or doesn't,
 * and plenty of good listings have none. So no public claim says every part
 * comes with its car; each one that mentions the car says it is there when
 * the seller links one (PRD: "every card CAN name the car the part came
 * off"). Keeping the descriptions in one place keeps that wording the same
 * everywhere it appears.
 */

/** Root layout: the product, not one door (F-2). */
export const SITE_DESCRIPTION =
  "DRVN is the home for your car and its build. Document what you've done, follow what others are building, and buy or sell the parts that come off — with the car a part came off, when the seller links one.";

/** Landing page: the parts marketplace, tied to the visitor's own car (F-1). */
export const LANDING_DESCRIPTION =
  "The parts marketplace for modified cars. Sell what comes off yours, and shop parts off cars like it — with the car each part came off, when the seller links one.";

/** Landing share text and the line under its headline. */
export const LANDING_SUB =
  "Sell what comes off your car. Shop parts off cars like yours, with the car a part came off when the seller links one.";

export const MARKETPLACE_DESCRIPTION =
  "Buy used and take-off parts for modified cars. Filter by category, brand, condition and what fits your garage — and see the build a part came off, when the seller links one.";

export const MARKETPLACE_SHARE_TITLE = "DRVN Marketplace — parts for modified cars";

export const MARKETPLACE_SHARE_DESCRIPTION =
  "Used and take-off parts for modified cars, with the build a part came off when the seller links one.";

export const EXPLORE_DESCRIPTION =
  "Explore modified cars, build updates and parts for sale on DRVN. Follow the builds you like and see what's changed.";

/** The site's own photograph, used where a page has no picture of its own. */
const SHARE_PHOTO = {
  url: "/landing/rx7-garage.jpg",
  width: 2400,
  height: 1357,
  alt: "A modified red Mazda RX-7 in a garage, with the factory parts that came off it laid out on the floor in front",
};

/** Explore had a title and nothing else, so a shared link unfurled as the site tagline. */
export const EXPLORE_METADATA: Metadata = {
  title: "Explore - DRVN",
  description: EXPLORE_DESCRIPTION,
  alternates: { canonical: "/explore" },
  openGraph: {
    title: "Explore DRVN — modified cars, builds and parts",
    description: EXPLORE_DESCRIPTION,
    url: "/explore",
    type: "website",
    images: [SHARE_PHOTO],
  },
  twitter: {
    card: "summary_large_image",
    title: "Explore DRVN — modified cars, builds and parts",
    description: EXPLORE_DESCRIPTION,
    images: [SHARE_PHOTO.url],
  },
};

type ShareListing = { description: string | null; condition: string | null; price_cents: number };
type ShareSourceCar = {
  is_public: boolean | null;
  name: string | null;
  year?: number | string | null;
  make?: string | null;
  model?: string | null;
} | null;

/**
 * A listing's link-preview text. The seller's own description when there is
 * one; otherwise a line built from what the listing really says — its
 * condition (not "used" for a new part) and its car only when it has a
 * public source car a visitor could open.
 */
export function listingShareDescription(listing: ShareListing, sourceCar: ShareSourceCar): string {
  const own = listing.description?.trim();
  if (own) return own.slice(0, 155);
  const car = sourceCar?.is_public ? vehicleLabel(sourceCar) || sourceCar.name?.trim() || "" : "";
  return [
    conditionLabel(listing.condition),
    formatPrice(listing.price_cents),
    car ? `off a ${car}, on DRVN.` : "for sale on DRVN.",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * What a listing's share card shows (work review #132, N1048). The card is
 * an image DRVN generates at /listings/<id>/opengraph-image, so the link a
 * chat or a search engine keeps is ours and does not run out. The listing's
 * own photo is a signed link that stops working within two hours; it used to
 * be the share image itself, and a pasted listing lost its picture when the
 * preview was fetched again.
 *
 * The photo is drawn only for a listing a visitor can open: on sale, reserved
 * (in someone's checkout, or held by an accepted offer; the page shows it with
 * a Reserved badge), or sold. And only from a signed link to our own storage
 * (ogImageSource): the card renderer fetches it from our server. A link is
 * most often pasted while a part is reserved, and a chat keeps the preview it
 * first fetched, so that card must be the whole card (review of #244).
 */
export type ListingShareCard = { title: string; price: string; label: "For sale" | "Reserved" | "Sold" | "On DRVN"; photo: string | null };

const OPEN_LABEL: Record<string, ListingShareCard["label"]> = { active: "For sale", reserved: "Reserved", sold: "Sold" };

export function listingShareCard(
  listing: { title: string | null; price_cents: number; status: string } | null,
  firstPhotoUrl: string | null | undefined,
): ListingShareCard {
  if (!listing) return { title: "A part on DRVN", price: "", label: "On DRVN", photo: null };
  const label = Object.hasOwn(OPEN_LABEL, listing.status) ? OPEN_LABEL[listing.status] : null;
  const open = label !== null;
  const title = (listing.title ?? "").replace(/\s+/g, " ").trim();
  return {
    title: title ? (title.length > 90 ? `${title.slice(0, 89)}…` : title) : "A part on DRVN",
    price: open ? formatPrice(listing.price_cents) : "",
    label: label ?? "On DRVN",
    photo: open ? ogImageSource(firstPhotoUrl) : null,
  };
}
