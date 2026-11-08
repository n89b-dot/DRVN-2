/**
 * Where a listing view arrived from (OS-W28, OS-R-arrival).
 *
 * PRD §6 "Is it one product?" measures "listing views arriving from a car,
 * profile or post", and "Does the second door work?" measures store visits.
 * Neither could be computed: a listing view was a bare counter on the
 * listing. Each counted view now names the surface it came from, classified
 * from the request's Referer (the app sends `strict-origin-when-cross-origin`,
 * so a same-site referrer keeps its path — on soft navigations too, where the
 * browser sends the current page as the referrer of the RSC request — and an
 * outside one is only an origin).
 *
 * The list is the contract: `listing_view_arrivals.arrival` in
 * `supabase/migrations/20261107220200_listing_view_arrivals.sql` accepts
 * exactly these values (arrival.test.ts reads the migration).
 */
export const LISTING_ARRIVALS = [
  "car",
  "post",
  "profile",
  "store",
  "marketplace",
  "explore",
  "home",
  "front",
  "saved",
  "listing",
  "agent",
  "other",
  "external",
  "direct",
] as const;

export type ListingArrival = (typeof LISTING_ARRIVALS)[number];

export function isListingArrival(value: unknown): value is ListingArrival {
  return typeof value === "string" && (LISTING_ARRIVALS as readonly string[]).includes(value);
}

/**
 * The surface a Referer names. `host` is this request's own host; anything
 * else is an outside site. No referrer at all (typed address, bookmark, an
 * app that strips it) is "direct".
 */
export function classifyArrival(referer: string | null | undefined, host: string | null | undefined): ListingArrival {
  if (!referer) return "direct";
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return "direct";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "direct";
  if (!host || url.host.toLowerCase() !== host.toLowerCase()) return "external";

  const path = url.pathname.replace(/\/+$/, "") || "/";
  const [first, second, third] = path.split("/").filter(Boolean);
  switch (first) {
    case undefined:
      return "front";
    case "cars":
      // A build's update lives under it: /cars/<slug>/activity/<post>.
      return second && third === "activity" ? "post" : "car";
    case "posts":
      return "post";
    case "u": {
      const view = url.searchParams.get("view") ?? url.searchParams.get("tab");
      return view === "parts" || view === "forsale" ? "store" : "profile";
    }
    case "profile":
      return "profile";
    case "marketplace":
    case "catalog":
      return "marketplace";
    case "explore":
      return "explore";
    case "home":
      return "home";
    case "saved":
      return "saved";
    case "listings":
      return "listing";
    case "agent":
      return "agent";
    default:
      return "other";
  }
}
