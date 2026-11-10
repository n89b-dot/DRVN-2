/**
 * Member photos are private objects since 20261108160000 (N455): a private
 * car's photos, a draft listing's photos and a private car's post photos used
 * to be readable by anyone holding their public URL, though the pages that
 * showed them were not.
 *
 * The database keeps every photo in its one canonical spelling,
 * `<origin>/storage/v1/object/public/<bucket>/<path>`, which stays the
 * object's identity for the reference checks, cleanup, takedowns and the
 * storage report (20261107203000). Only the app sees another spelling: a
 * signed URL, minted after the row was read under the reader's own row
 * policies, so a photo reaches exactly the people who can see the row it
 * belongs to. src/lib/supabase/photo-signing.ts signs on the way out of the
 * database and turns signed URLs back into canonical ones on the way in.
 *
 * These are the pure rules (no server-only import, so they can be tested).
 */

/** The buckets whose objects are read through signed URLs. Avatars stay public. */
export const SIGNED_PHOTO_BUCKETS = ["car-images", "listing-images", "activity-images"] as const;

/** One signing window: URLs minted inside it are reused until it ends. */
export const SIGNING_WINDOW_SECONDS = 3600;

const BUCKETS = SIGNED_PHOTO_BUCKETS.join("|");
const PATH = "[^\"'\\s\\\\?#<>]+";

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The storage origin photo URLs are minted on, or null when unconfigured. */
export function storageOrigin(env: Record<string, string | undefined> = process.env): string | null {
  try {
    return env.NEXT_PUBLIC_SUPABASE_URL ? new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin : null;
  } catch {
    return null;
  }
}

function publicPattern(origin: string, flags = "g"): RegExp {
  return new RegExp(`${escapeRegExp(origin)}/storage/v1/object/public/(${BUCKETS})/(${PATH})`, flags);
}

function signedPattern(origin: string, flags = "g"): RegExp {
  return new RegExp(`${escapeRegExp(origin)}/storage/v1/object/sign/(${BUCKETS})/(${PATH})\\?token=[A-Za-z0-9._~-]+`, flags);
}

/** A decoded object path is safe to name: no empty, `.` or `..` segment, no control characters, \ ? # %. */
function safePath(raw: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (path.length < 3 || path.length > 512 || path.indexOf("/") < 1 || path.endsWith("/") || path.includes("//")) return null;
  if (path.split("/").some((segment) => segment === "." || segment === "..")) return null;
  return /[\u0000-\u001f\u007f-\u009f\\?#%]/.test(path) ? null : path;
}

/**
 * The canonical spelling of a member photo URL: a signed URL for one of our
 * signed photo buckets becomes the public-route URL the database stores.
 * Anything else comes back unchanged.
 */
export function canonicalPhotoUrl<T>(value: T, origin: string | null = storageOrigin()): T {
  if (typeof value !== "string" || !origin) return value;
  const match = signedPattern(origin, "").exec(value);
  if (!match || match.index !== 0 || match[0].length !== value.length) return value;
  const path = safePath(match[2]);
  return (path ? `${origin}/storage/v1/object/public/${match[1]}/${path}` : value) as T;
}

/** Every signed photo URL in a text (a request body, a query string) back to its canonical spelling. */
export function canonicalizePhotoUrlsInText(text: string, origin: string | null = storageOrigin()): string {
  if (!origin || !text.includes("/storage/v1/object/sign/")) return text;
  return text.replace(signedPattern(origin), (whole, bucket: string, raw: string) => {
    const path = safePath(raw);
    return path ? `${origin}/storage/v1/object/public/${bucket}/${path}` : whole;
  });
}

/** The distinct canonical photo URLs a text (a database response) contains, in a signed bucket. */
export function canonicalPhotoUrlsInText(text: string, origin: string | null = storageOrigin()): string[] {
  if (!origin || !text.includes("/storage/v1/object/public/")) return [];
  const found = new Set<string>();
  for (const match of text.matchAll(publicPattern(origin))) {
    if (safePath(match[2])) found.add(match[0]);
  }
  return [...found];
}

/** Replaces each canonical photo URL in a text with its signed spelling, where one was minted. */
export function replacePhotoUrlsInText(text: string, signed: ReadonlyMap<string, string>, origin: string | null = storageOrigin()): string {
  if (!origin || !signed.size) return text;
  return text.replace(publicPattern(origin), (whole) => signed.get(whole) ?? whole);
}

/** (bucket, path) of a canonical photo URL in a signed bucket, or null. */
export function signedPhotoObject(url: string, origin: string | null = storageOrigin()): { bucket: string; path: string } | null {
  if (!origin) return null;
  const match = publicPattern(origin, "").exec(url);
  if (!match || match.index !== 0 || match[0].length !== url.length) return null;
  const path = safePath(match[2]);
  return path ? { bucket: match[1], path } : null;
}

/**
 * The window a URL is minted in and how long to make it last: to the end of
 * the next window, so a page rendered at the end of one window still shows
 * its photos for at least an hour.
 */
export function signingWindow(nowMs: number): { window: number; expiresIn: number } {
  const now = Math.floor(nowMs / 1000);
  const window = Math.floor(now / SIGNING_WINDOW_SECONDS);
  return { window, expiresIn: (window + 2) * SIGNING_WINDOW_SECONDS - now };
}

const UNSIGNED_MEMBER_PHOTO = new RegExp(`/storage/v1/object/public/(?:${BUCKETS})/`);
const MEMBER_PHOTO = new RegExp(`/storage/v1/object/(?:public|sign)/(?:${BUCKETS})/`);

/** A member photo in either spelling (#196 review: only these get the plate on a failed load). */
export function isMemberPhotoSource(src: string | null | undefined): boolean {
  return typeof src === "string" && MEMBER_PHOTO.test(src);
}

/**
 * A member photo still in its canonical spelling: signing failed or a loader
 * read it without the signing wrapper, and the storage layer will refuse it.
 * `Media` shows the no-photo plate for it rather than a broken image (#105).
 * Origin-agnostic on purpose, so it works in the browser bundle too.
 */
export function isUnsignedMemberPhoto(src: string | null | undefined): boolean {
  return typeof src === "string" && UNSIGNED_MEMBER_PHOTO.test(src);
}

/**
 * Where a database answer may hold a photo the app signs (N940; #178 and
 * #196 reviews). The rule: a value is signed only when it sits at a place
 * the database guards, and the database guards a place only if every value
 * written there, by any writer, names an object in the folder of the row's
 * owner, resolved from the row's parent (its car, listing, post or order),
 * never from the row's own text (20261110190000). So the signer needs no
 * owner column in the select, and a reader who may see the row may see its
 * photo: a buyer reading an order, an offer or a conversation sees the
 * seller's listing photos because the row is theirs to read and the photo
 * is the seller's own.
 *
 * This list must equal private.photo_signable_positions() in the latest
 * migration that defines it (src/lib/photo-urls.test.ts), and
 * supabase/tests/photo_signing_rules_guard.sql holds that list to the
 * triggers the database runs.
 *
 *  - column: `relation.field` is a photo column, signed when a table read
 *    (`/rest/v1/<relation>`, or an embed of that relation) returns it whole;
 *  - body: `relation.field` is a post body, signed only in bodyPhotoUrls'
 *    shape;
 *  - rpc: `field` is a dotted path in the RPC's answer (arrays are walked
 *    through) holding a copy of `source`.
 *
 * Nothing else is signed: no JSON column, no Json-returning RPC that isn't
 * listed, no key name on its own. Everything else stays canonical, which
 * the storage layer refuses.
 */
export type PhotoPosition =
  | { kind: "column" | "body"; relation: string; field: string; source: null }
  | { kind: "rpc"; relation: string; field: string; source: string };

export const PHOTO_POSITIONS: readonly PhotoPosition[] = [
  { kind: "column", relation: "cars", field: "cover_image_url", source: null },
  { kind: "column", relation: "car_images", field: "url", source: null },
  { kind: "column", relation: "car_hotspots", field: "image_url", source: null },
  { kind: "column", relation: "mod_items", field: "image_url", source: null },
  { kind: "column", relation: "listing_images", field: "url", source: null },
  { kind: "column", relation: "activity_images", field: "url", source: null },
  { kind: "column", relation: "order_item_snapshot_images", field: "url", source: null },
  { kind: "body", relation: "activity_posts", field: "body", source: null },
  { kind: "rpc", relation: "feed_hydration", field: "posts.cover_url", source: "activity_images.url" },
  { kind: "rpc", relation: "feed_hydration", field: "posts.body", source: "activity_posts.body" },
  { kind: "rpc", relation: "feed_hydration", field: "cars.cover_image_url", source: "cars.cover_image_url" },
  { kind: "rpc", relation: "feed_hydration", field: "listings.cover_url", source: "listing_images.url" },
  { kind: "rpc", relation: "feed_hydration", field: "post_cars.cover_image_url", source: "cars.cover_image_url" },
  { kind: "rpc", relation: "garage_car_stats", field: "latest_update.cover_url", source: "activity_images.url" },
  { kind: "rpc", relation: "garage_car_stats", field: "latest_update.body", source: "activity_posts.body" },
  { kind: "rpc", relation: "seller_listing_stats", field: "cover_url", source: "listing_images.url" },
  { kind: "rpc", relation: "car_update_page", field: "body", source: "activity_posts.body" },
];

/**
 * Columns whose name looks like a photo but that the signer never signs, and
 * why. src/lib/photo-urls.test.ts fails when the schema gains a photo-like
 * column (url, urls, image_url, cover_…, photo…, avatar_url…) that is in
 * neither this list nor PHOTO_POSITIONS (N940).
 */
export const NOT_SIGNED_PHOTO_LIKE_COLUMNS: Readonly<Record<string, string>> = {
  "activity_posts.video_url": "a video link, not a member object",
  "agent_messages.images": "agent-chat-photos objects, signed for their owner by signChatPhotos",
  "copyright_notices.content_urls": "the URLs a notice names, shown to staff as text",
  "dispute_evidence.url": "dispute-evidence objects, signed for the case's parties by evidence-urls",
  "listing_imports.canonical_url": "the external page an import read",
  "listing_imports.imported_images": "what an import copied in; not owner-checked by the database (the member saves chosen ones as listing_images)",
  "listing_imports.source_url": "the external page an import read",
  "messages.attachments": "message-photos objects, signed for the conversation by conversations.ts",
  "mod_items.product_url": "an external product page",
  "profiles.avatar_url": "avatars are a public bucket",
  "staged_uploads.url": "the upload ledger, read by the server only",
};

const BODY_SOURCES = new Set(PHOTO_POSITIONS.filter((p) => p.kind === "body").map((p) => `${p.relation}.${p.field}`));
const positionKind = (relation: string, field: string): "column" | "body" | null => {
  const found = PHOTO_POSITIONS.find((p) => p.kind !== "rpc" && p.relation === relation && p.field === field);
  return found ? (found.kind as "column" | "body") : null;
};
const rpcPaths = (fn: string) =>
  PHOTO_POSITIONS.flatMap((p) => (p.kind === "rpc" && p.relation === fn ? [{ path: p.field.split("."), body: BODY_SOURCES.has(p.source) }] : []));

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * A post body's photos, the one shape private.activity_body_media checks on
 * write (20261110190000): the top-level array's blocks of type "images" with
 * an array `urls` (its string elements), and blocks of type "before_after"
 * (string `beforeUrl` / `afterUrl`). Nothing nested, nothing in any other
 * block. supabase/tests/photo_signing_rules_guard.sql runs the same cases.
 */
export function mapBodyPhotos(body: unknown, onPhoto: (url: string) => string | void): unknown {
  if (!Array.isArray(body)) return body;
  return body.map((block) => {
    if (!isPlainObject(block)) return block;
    if (block.type === "images" && Array.isArray(block.urls)) {
      return { ...block, urls: block.urls.map((u) => (typeof u === "string" && u !== "" ? (onPhoto(u) ?? u) : u)) };
    }
    if (block.type === "before_after") {
      const out = { ...block };
      for (const key of ["beforeUrl", "afterUrl"] as const) {
        const u = block[key];
        if (typeof u === "string" && u !== "") out[key] = onPhoto(u) ?? u;
      }
      return out;
    }
    return block;
  });
}

/** The distinct photo strings a post body holds, in bodyPhotoUrls' shape. */
export function bodyPhotoUrls(body: unknown): string[] {
  const found = new Set<string>();
  mapBodyPhotos(body, (url) => { found.add(url); });
  return [...found];
}

/**
 * A PostgREST select, as far as the signer needs it: which response key is
 * which whole column, and which is which embedded relation. `null` when it
 * can't be read, and then nothing is signed.
 */
export type Selection = {
  star: boolean;
  /** A spread (`...relation(…)`) puts another table's columns on the row: the star is not trusted then. */
  spread: boolean;
  keys: Map<string, { column: string | null } | { relation: string; selection: Selection }>;
};

const IDENT = String.raw`(?:[A-Za-z_][A-Za-z0-9_]*|"[^"]+")`;
const EMBED = new RegExp(String.raw`^(?:(${IDENT}):)?(${IDENT})((?:!${IDENT})*)\(([\s\S]*)\)$`);
const COLUMN = new RegExp(String.raw`^(?:(${IDENT}):)?(${IDENT})((?:->>?(?:${IDENT}|\d+))*)(?:::[A-Za-z_][A-Za-z0-9_ \[\]]*)?$`);
const AGGREGATE = new RegExp(String.raw`^(?:(${IDENT}):)?(?:(${IDENT})\.)?(count|sum|avg|min|max)\(\)(?:::[A-Za-z_][A-Za-z0-9_ \[\]]*)?$`);
const unquote = (name: string) => (name.startsWith('"') ? name.slice(1, -1) : name);

function splitTopLevel(text: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === "(") depth++;
    else if (!quoted && c === ")") { if (--depth < 0) return null; }
    else if (!quoted && depth === 0 && c === ",") { parts.push(text.slice(start, i)); start = i + 1; }
  }
  if (depth !== 0 || quoted) return null;
  parts.push(text.slice(start));
  return parts;
}

export function parseSelect(select: string | null | undefined): Selection | null {
  const items = splitTopLevel((select ?? "*").replace(/\s+/g, ""));
  if (!items) return null;
  const out: Selection = { star: false, spread: false, keys: new Map() };
  for (const item of items) {
    if (item === "") continue;
    if (item === "*") { out.star = true; continue; }
    if (item.startsWith("...")) {
      if (!EMBED.test(item.slice(3))) return null;
      out.spread = true;
      continue;
    }
    const embed = EMBED.exec(item);
    if (embed) {
      const selection = parseSelect(embed[4]);
      if (!selection) return null;
      out.keys.set(unquote(embed[1] ?? embed[2]), { relation: unquote(embed[2]), selection });
      continue;
    }
    const column = COLUMN.exec(item);
    if (column) {
      const path = column[3] ? column[3].split(/->>?/).filter(Boolean) : [];
      // A JSON path is named by its last key and is never a whole column.
      const key = unquote(column[1] ?? (path.length ? path[path.length - 1] : column[2]));
      out.keys.set(key, { column: path.length ? null : unquote(column[2]) });
      continue;
    }
    const aggregate = AGGREGATE.exec(item);
    if (aggregate) {
      out.keys.set(unquote(aggregate[1] ?? aggregate[3]), { column: null });
      continue;
    }
    return null;
  }
  return out;
}

function resolveKey(selection: Selection, key: string) {
  const known = selection.keys.get(key);
  if (known) return known;
  return selection.star && !selection.spread ? { column: key } : null;
}

/** What a PostgREST answer is: rows of a table (with its select) or an RPC's answer. */
export type SigningContext = { table: string; selection: Selection } | { rpc: string; selection: Selection | null };

const NAME = /^[a-z_][a-z0-9_]*$/;

/** Why an answer has no signing context. `not-rest` is ordinary (Storage, Auth); the others mean a read the signer can't place, and are reported. */
export type NoContextReason = "not-rest" | "bad-path" | "two-selects" | "unparsable-select";

/** The answer's context from its request URL (`/rest/v1/<table>` or `/rest/v1/rpc/<fn>`), or why there is none: then nothing is signed. */
export function signingContextFor(requestUrl: string): { context: SigningContext } | { reason: NoContextReason } {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return { reason: "not-rest" };
  }
  const at = url.pathname.indexOf("/rest/v1/");
  if (at < 0) return { reason: "not-rest" };
  let rest: string;
  try {
    rest = decodeURIComponent(url.pathname.slice(at + "/rest/v1/".length));
  } catch {
    return { reason: "bad-path" };
  }
  const select = url.searchParams.getAll("select");
  if (select.length > 1) return { reason: "two-selects" };
  if (rest.startsWith("rpc/")) {
    const fn = rest.slice(4);
    if (!NAME.test(fn)) return { reason: "bad-path" };
    if (!select.length) return { context: { rpc: fn, selection: null } };
    const selection = parseSelect(select[0]);
    return selection ? { context: { rpc: fn, selection } } : { reason: "unparsable-select" };
  }
  if (!NAME.test(rest)) return { reason: "bad-path" };
  const selection = parseSelect(select[0] ?? "*");
  return selection ? { context: { table: rest, selection } } : { reason: "unparsable-select" };
}

/** The answer's context, or null when there is none. */
export function signingContext(requestUrl: string): SigningContext | null {
  const found = signingContextFor(requestUrl);
  return "context" in found ? found.context : null;
}

/** A table read's context from its name and select (an export section's projection). */
export function tableContext(table: string, select: string | null | undefined): SigningContext | null {
  const selection = parseSelect(select);
  return selection && NAME.test(table) ? { table, selection } : null;
}

function isWholeCanonicalPhoto(value: string, origin: string): boolean {
  return value.startsWith(origin) && signedPhotoObject(value, origin) !== null;
}

/**
 * The owner column of the tables that own photos (#196 review, P2-2). The
 * database guarantees a listed photo is in its row owner's folder, but only
 * once 20261110190000 is applied; where a read carries the owner anyway, the
 * signer checks it too, cheaply, so a row the database never checked can't
 * have someone else's photo signed. A photo table without its own owner
 * (car_images, listing_images…) takes its parent's; an owning table read
 * without its owner column has no known owner, and a null owner is never
 * treated as a mismatch.
 */
const OWNER_COLUMN: Readonly<Record<string, string>> = { cars: "owner_id", listings: "seller_id", activity_posts: "author_id", orders: "seller_id" };
const RPC_OWNER_KEYS = ["owner_id", "seller_id", "author_id"] as const;

type OnPhoto = (url: string, owner: string | undefined) => string | void;

function ownerOfRow(row: Record<string, unknown>, table: string, selection: Selection, inherited: string | undefined): string | undefined {
  const column = OWNER_COLUMN[table];
  if (!column) return inherited;
  for (const [key, value] of Object.entries(row)) {
    const at = resolveKey(selection, key);
    if (at && "column" in at && at.column === column) return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function walkRows(node: unknown, table: string, selection: Selection, photo: OnPhoto, inherited: string | undefined): unknown {
  if (Array.isArray(node)) return node.map((row) => walkRows(row, table, selection, photo, inherited));
  if (!isPlainObject(node)) return node;
  const owner = ownerOfRow(node, table, selection, inherited);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    const at = resolveKey(selection, key);
    if (at && "relation" in at) out[key] = walkRows(value, at.relation, at.selection, photo, owner);
    else if (at?.column && positionKind(table, at.column) === "column") out[key] = typeof value === "string" ? (photo(value, owner) ?? value) : value;
    else if (at?.column && positionKind(table, at.column) === "body") out[key] = mapBodyPhotos(value, (url) => photo(url, owner));
    else out[key] = value;
  }
  return out;
}

function walkPath(node: unknown, path: string[], body: boolean, photo: OnPhoto, owner: string | undefined): unknown {
  // The leaf first: a body is itself an array, walked in its own shape.
  if (!path.length && body) return mapBodyPhotos(node, (url) => photo(url, owner));
  if (Array.isArray(node)) return node.map((item) => walkPath(item, path, body, photo, owner));
  if (!path.length) return typeof node === "string" ? (photo(node, owner) ?? node) : node;
  if (!isPlainObject(node) || !(path[0] in node)) return node;
  const key = RPC_OWNER_KEYS.find((k) => typeof node[k] === "string");
  const here = key ? (node[key] as string) : owner;
  return { ...node, [path[0]]: walkPath(node[path[0]], path.slice(1), body, photo, here) };
}

function walkRpc(node: unknown, fn: string, selection: Selection | null, photo: OnPhoto): unknown {
  let out = node;
  for (const { path, body } of rpcPaths(fn)) {
    // A select on an RPC renames its columns: follow the first segment to whichever key now holds it.
    const keys = selection
      ? [...selection.keys].flatMap(([key, at]) => ("column" in at && at.column === path[0] ? [key] : [])).concat(
          selection.star && !selection.spread && !selection.keys.has(path[0]) ? [path[0]] : [],
        )
      : [path[0]];
    for (const key of keys) out = walkPath(out, [key, ...path.slice(1)], body, photo, undefined);
  }
  return out;
}

function walk(value: unknown, context: SigningContext, origin: string, onPhoto: (url: string) => string | void): unknown {
  const photo: OnPhoto = (url, owner) => {
    if (!isWholeCanonicalPhoto(url, origin)) return undefined;
    if (owner !== undefined && signedPhotoObject(url, origin)?.path.split("/")[0] !== owner) return undefined;
    return onPhoto(url);
  };
  return "table" in context ? walkRows(value, context.table, context.selection, photo, undefined) : walkRpc(value, context.rpc, context.selection, photo);
}

/** The canonical photo URLs held at signable places of a parsed answer. */
export function photoFieldUrls(value: unknown, context: SigningContext | null, origin: string | null = storageOrigin()): string[] {
  if (!origin || !context) return [];
  const found = new Set<string>();
  walk(value, context, origin, (url) => { found.add(url); });
  return [...found];
}

/** The same answer with each signable photo replaced by its signed spelling, where one was minted. */
export function replacePhotoFields<T>(value: T, context: SigningContext | null, signed: ReadonlyMap<string, string>, origin: string | null = storageOrigin()): T {
  if (!origin || !context || !signed.size) return value;
  return walk(value, context, origin, (url) => signed.get(url)) as T;
}

const MEMBER_ROUTE = new RegExp(`^/storage/v1/(?:object|render/image)/(public|sign|authenticated)/(?:${BUCKETS})/`);

/**
 * How an image source names a member photo, read the way a server would
 * (#196 review, D): the URL parsed, its path percent-decoded once, its query
 * decoded by URLSearchParams. `unreadable` when it looks like storage but
 * can't be parsed or decoded.
 */
function memberPhotoRoute(source: string): { route: "public" | "sign" | "authenticated"; url: URL } | "unreadable" | null {
  let url: URL;
  try {
    url = new URL(source, "https://relative.invalid");
  } catch {
    return source.includes("/storage/") ? "unreadable" : null;
  }
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return url.pathname.includes("/storage/") ? "unreadable" : null;
  }
  const match = MEMBER_ROUTE.exec(path);
  return match ? { route: match[1] as "public" | "sign" | "authenticated", url } : null;
}

/** The expiry (seconds) a Storage token carries, or null when there is no single readable one. */
function tokenExpiry(url: URL): number | null {
  const tokens = url.searchParams.getAll("token");
  if (tokens.length !== 1) return null;
  const parts = tokens[0].split(".");
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")));
    return typeof json?.exp === "number" ? json.exp : null;
  } catch {
    return null;
  }
}

/**
 * Whether an image source is a member-photo link whose token has run out, or
 * can't be read (#178 review, P2; #196 review, D). Next keeps a resized copy
 * for the larger of its TTL and the object's own Cache-Control, so an old
 * link could keep serving a photo long after it expired, including after its
 * car went private. Any `/object/sign/<bucket>/` source (or the render
 * route's), however it is spelled, counts as expired unless it carries
 * exactly one token whose payload says it is still live. A token with a later
 * expiry that wasn't minted by Storage misses the cache and is refused by
 * Storage itself.
 */
export function signedPhotoLinkExpired(source: string | null, nowMs = Date.now()): boolean {
  if (!source) return false;
  const route = memberPhotoRoute(source);
  if (route === "unreadable") return true;
  if (!route || route.route !== "sign") return false;
  const exp = tokenExpiry(route.url);
  return exp === null || exp * 1000 <= nowMs;
}

/**
 * Whether the image gate refuses a source: a member photo in any spelling
 * that isn't a live signed link (a canonical or authenticated route, an
 * expired or unreadable token), decoded as signedPhotoLinkExpired decodes it.
 */
export function memberPhotoSourceRefused(source: string | null, nowMs = Date.now()): boolean {
  if (!source) return false;
  const route = memberPhotoRoute(source);
  if (route === "unreadable") return true;
  if (!route) return false;
  return route.route !== "sign" || signedPhotoLinkExpired(source, nowMs);
}
