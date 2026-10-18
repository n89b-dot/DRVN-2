/**
 * The shared copy of public data: what it may hold, how old it may get, and
 * how it is cleared.
 *
 * Three rules keep it safe.
 *
 *  1. Only reads go in. A table read (GET/HEAD) or a function on the
 *     read-only list below; anything else — a view-count bump, a write —
 *     always reaches the database.
 *  2. A copy is never served past its age limit. Next's own data cache hands
 *     out an expired copy once more while it refreshes in the background, so
 *     on a quiet page a visitor could be shown something hours old. Here an
 *     expired copy is thrown away and the database is asked again.
 *  3. Writes clear it (`clearPublicData`), so a change normally shows at
 *     once; the age limit is the backstop for a write that clears nothing
 *     (a database job, a path nobody tagged).
 *
 * No `server-only` import: the rules are plain functions so they can be
 * tested. The only caller is `./public`, which is server-only.
 */

/** What a cached read depends on. A write clears every copy tagged with the
 *  kind of thing it changed — coarse on purpose: a missed clear shows stale
 *  data, an extra one only costs a database read. */
export const PUBLIC_TAGS = {
  /** Parts for sale: rows, photos, fitment, price, status. */
  listings: "public:listings",
  /** Builds: the car, its photos, mods, hotspots. */
  cars: "public:cars",
  /** Updates: posts, their photos and tagged parts. */
  posts: "public:posts",
  /** Names, handles, avatars, bios. */
  profiles: "public:profiles",
  /** Counts other people cause: likes, comments, questions, reviews, follows. */
  engagement: "public:engagement",
} as const;
export type PublicDataKind = keyof typeof PUBLIC_TAGS;

/** Every kind — for a page that shows a bit of everything. */
export const ALL_PUBLIC_KINDS = Object.keys(PUBLIC_TAGS) as PublicDataKind[];

/**
 * Which kinds of public data a write may have changed, judged by the page it
 * revalidates. Actions already name the pages a change shows on; this turns
 * that into what to clear, so no action has to remember a second call.
 * Generous by design — an order page clears listings because paying for a
 * part is what marks it sold.
 */
const KINDS_BY_PATH: [prefix: string, kinds: PublicDataKind[]][] = [
  ["/admin", ALL_PUBLIC_KINDS],
  ["/marketplace", ["listings"]],
  ["/listings", ["listings", "engagement"]],
  ["/sell", ["listings"]],
  ["/cart", ["listings"]],
  ["/checkout", ["listings"]],
  ["/orders", ["listings", "engagement"]],
  ["/offers", ["listings"]],
  ["/garage", ["cars", "posts", "listings"]],
  ["/cars", ["cars", "posts", "engagement"]],
  ["/posts", ["posts", "engagement"]],
  ["/explore", ["posts", "cars", "engagement"]],
  ["/home", ["posts", "cars", "engagement"]],
  ["/saved", ["engagement"]],
  ["/u", ["profiles", "engagement"]],
  ["/profile", ["profiles"]],
  ["/settings", ["profiles"]],
];

export function publicKindsForPath(path: string): PublicDataKind[] {
  if (path === "/") return ALL_PUBLIC_KINDS;
  const pathname = path.split(/[?#]/)[0];
  const match = KINDS_BY_PATH.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return match ? match[1] : [];
}

/** Age limits, in seconds. Commerce state (price, availability) is held for
 *  less time than content. */
export const PUBLIC_MAX_AGE = { commerce: 60, content: 300 } as const;

/**
 * Database functions that only read, and return the same rows to every
 * signed-out visitor. A function call is a POST, so nothing else tells a
 * read from a write — a function missing from this list is simply never
 * cached.
 */
export const PUBLIC_READ_FUNCTIONS: ReadonlySet<string> = new Set([
  "explore_build_rows",
  "explore_update_rows",
  "explore_update_search_rows",
  "feed_event_page",
  "feed_hydration",
  "listing_public_offer_floor",
  "listing_watch_counts",
  "local_feed_rows",
  "marketplace_brand_counts",
  "marketplace_browse_rows",
  "marketplace_category_counts",
  "marketplace_count",
  "marketplace_page",
  "marketplace_search_browse_rows",
  "mod_purchase_sources",
  "profile_follow_counts",
  "profile_sales_count",
  "search_listing_ids",
  "seller_active_counts",
  "suggested_builders",
  "trending_models",
]);

/** Whether this request may be answered from the shared copy. */
export function isCacheablePublicRead(method: string | undefined, url: string): boolean {
  const verb = (method ?? "GET").toUpperCase();
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  if (!pathname.includes("/rest/v1/")) return false;
  const rpc = pathname.match(/\/rest\/v1\/rpc\/([^/]+)$/);
  if (rpc) return (verb === "POST" || verb === "GET" || verb === "HEAD") && PUBLIC_READ_FUNCTIONS.has(rpc[1]);
  return verb === "GET" || verb === "HEAD";
}

/** Allowed disagreement between this server's clock and the database host's. */
const CLOCK_SLACK_MS = 5_000;

/**
 * Whether a response is young enough to show. Its `Date` header is when the
 * database answered — the cache stores it with the body, so a copy carries
 * its own age. No readable date means the age is unknown, and unknown is not
 * young enough.
 */
export function isWithinMaxAge(response: Response, maxAgeSeconds: number, now = Date.now()): boolean {
  const answered = Date.parse(response.headers.get("date") ?? "");
  if (!Number.isFinite(answered)) return false;
  return now - answered <= maxAgeSeconds * 1000 + CLOCK_SLACK_MS;
}

/** The isolated e2e stack inserts rows and expects the next page to show
 *  them; `DRVN_PUBLIC_CACHE=off` is the same switch for any other host. */
export function publicCacheEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DRVN_PUBLIC_CACHE !== "off" && env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation";
}

/** A fetch that answers cacheable reads from the shared copy, within the age
 *  limit, and sends everything else straight to the database. */
export function cachedPublicFetch(
  options: { maxAge: number; tags: string[] },
  baseFetch: typeof fetch = fetch
): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : undefined);
    const live = () => baseFetch(input, { ...init, cache: "no-store" });
    if (options.maxAge <= 0 || !publicCacheEnabled() || !isCacheablePublicRead(method, url)) return live();
    const response = await baseFetch(input, {
      ...init,
      next: { revalidate: options.maxAge, tags: options.tags },
    } as RequestInit);
    return isWithinMaxAge(response, options.maxAge) ? response : live();
  };
}
