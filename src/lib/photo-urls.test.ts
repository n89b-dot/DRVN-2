import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { MEMBER_JSON_COLUMNS, SERVER_JSON_COLUMNS } from "./json-columns";
import {
  bodyPhotoUrls,
  canonicalizePhotoUrlsInText,
  canonicalPhotoUrl,
  canonicalPhotoUrlsInText,
  memberPhotoSourceRefused,
  NOT_SIGNED_PHOTO_LIKE_COLUMNS,
  parseSelect,
  PHOTO_POSITIONS,
  photoFieldUrls,
  replacePhotoUrlsInText,
  signedPhotoLinkExpired,
  signedPhotoObject,
  signingContext,
  signingContextFor,
  signingWindow,
  SIGNING_WINDOW_SECONDS,
} from "./photo-urls";

const O = "https://proj.supabase.co";
const ME = "11111111-1111-4111-8111-111111111111";
const canonical = (bucket: string, file = "a.webp") => `${O}/storage/v1/object/public/${bucket}/${ME}/${file}`;
const signed = (bucket: string, file = "a.webp") => `${O}/storage/v1/object/sign/${bucket}/${ME}/${file}?token=not-a-real-token_1.2`;

describe("member photo spellings (N455)", () => {
  it("N455: a signed photo URL in a signed bucket turns back into its canonical URL; nothing else changes", () => {
    for (const bucket of ["car-images", "listing-images", "activity-images"]) {
      expect(canonicalPhotoUrl(signed(bucket), O)).toBe(canonical(bucket));
    }
    expect(canonicalPhotoUrl(signed("avatars"), O)).toBe(signed("avatars"));
    expect(canonicalPhotoUrl(signed("message-photos"), O)).toBe(signed("message-photos"));
    expect(canonicalPhotoUrl(canonical("car-images"), O)).toBe(canonical("car-images"));
    expect(canonicalPhotoUrl(`${signed("car-images")}&download=1`, O)).toBe(`${signed("car-images")}&download=1`);
    expect(canonicalPhotoUrl(signed("car-images").replace(O, "https://evil.example"), O)).toBe(signed("car-images").replace(O, "https://evil.example"));
    expect(canonicalPhotoUrl(`${O}/storage/v1/object/sign/car-images/${ME}/../x.webp?token=a`, O)).toBe(`${O}/storage/v1/object/sign/car-images/${ME}/../x.webp?token=a`);
    expect(canonicalPhotoUrl(null, O)).toBeNull();
  });

  it("N455: a request body's signed photo URLs are all canonical before the database sees them", () => {
    const body = JSON.stringify({ p_image_urls: [signed("activity-images"), signed("activity-images", "b.webp")], cover: signed("car-images"), avatar: signed("avatars") });
    const out = JSON.parse(canonicalizePhotoUrlsInText(body, O));
    expect(out).toEqual({ p_image_urls: [canonical("activity-images"), canonical("activity-images", "b.webp")], cover: canonical("car-images"), avatar: signed("avatars") });
  });

  it("N455: a response's canonical photo URLs are found once each and replaced with their signed spelling", () => {
    const rows = JSON.stringify([{ url: canonical("car-images") }, { url: canonical("car-images") }, { body: [{ urls: [canonical("listing-images")] }] }, { avatar: canonical("avatars") }]);
    expect(canonicalPhotoUrlsInText(rows, O)).toEqual([canonical("car-images"), canonical("listing-images")]);
    const map = new Map([[canonical("car-images"), signed("car-images")]]);
    const out = JSON.parse(replacePhotoUrlsInText(rows, map, O));
    expect(out[0].url).toBe(signed("car-images"));
    expect(out[1].url).toBe(signed("car-images"));
    expect(out[2].body[0].urls[0]).toBe(canonical("listing-images"));
    expect(out[3].avatar).toBe(canonical("avatars"));
  });

  it("N455: names the object a canonical photo URL points at", () => {
    expect(signedPhotoObject(canonical("car-images", "car-1/p%20q.webp"), O)).toEqual({ bucket: "car-images", path: `${ME}/car-1/p q.webp` });
    expect(signedPhotoObject(canonical("avatars"), O)).toBeNull();
    expect(signedPhotoObject(`${canonical("car-images")}?x=1`, O)).toBeNull();
  });

  it("N455: URLs minted in one window are reused for it and last to the end of the next", () => {
    const start = 1_800_000_000 - (1_800_000_000 % SIGNING_WINDOW_SECONDS);
    const early = signingWindow(start * 1000);
    const late = signingWindow((start + SIGNING_WINDOW_SECONDS - 1) * 1000);
    expect(early.window).toBe(late.window);
    expect(early.expiresIn).toBe(2 * SIGNING_WINDOW_SECONDS);
    expect(late.expiresIn).toBe(SIGNING_WINDOW_SECONDS + 1);
    expect(signingWindow((start + SIGNING_WINDOW_SECONDS) * 1000).window).toBe(early.window + 1);
  });
});

const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, relative), "utf8");
const STRANGER = "22222222-2222-4222-8222-222222222222";
const theirs = `${O}/storage/v1/object/public/car-images/${STRANGER}/private.webp`;
/** The canonical photos an answer to `request` would have signed. */
const signedAt = (request: string, value: unknown) => photoFieldUrls(value, signingContext(`${O}/rest/v1/${request}`), O);

describe("the signable places are the latest migration's list (N940, #196 review A)", () => {
  it("PHOTO_POSITIONS equals private.photo_signable_positions() in the latest migration that defines it", () => {
    const dir = path.resolve(__dirname, "../../supabase/migrations");
    const file = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
      .filter((f) => fs.readFileSync(path.join(dir, f), "utf8").includes("function private.photo_signable_positions()"))
      .pop();
    expect(file, "no migration defines private.photo_signable_positions()").toBeTruthy();
    const sql = fs.readFileSync(path.join(dir, file!), "utf8");
    const body = sql.slice(sql.indexOf("function private.photo_signable_positions()"));
    const values = body.slice(body.indexOf("values"), body.indexOf("$$;"));
    const rows = [...values.matchAll(/\('(\w+)', '(\w+)', '([\w.]+)', (?:null::text|'([\w.]+)')\)/g)]
      .map((m) => `${m[1]} ${m[2]} ${m[3]} ${m[4] ?? "-"}`);
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.sort()).toEqual(PHOTO_POSITIONS.map((p) => `${p.kind} ${p.relation} ${p.field} ${p.source ?? "-"}`).sort());
  });

  it("only a post body is signed inside a JSON column, and every JSON column is classified, per table (A2)", () => {
    const types = read("database.generated.ts");
    const tables = types.slice(types.indexOf("    Tables: {"), types.indexOf("    Views: {"));
    const json: string[] = [];
    for (const table of tables.matchAll(/\n {6}([a-z_]+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/g)) {
      // One column per line, the line end not consumed, so adjacent Json columns are both seen.
      for (const column of table[2].matchAll(/^ {10}([a-z_]+): Json(?: \| null)?$/gm)) json.push(`${table[1]}.${column[1]}`);
    }
    expect(json).toContain("order_items.condition_snapshot");
    expect(json).toContain("agent_events.result");
    const known = new Set([...MEMBER_JSON_COLUMNS, ...SERVER_JSON_COLUMNS]);
    expect(json.filter((c) => !known.has(c)), "classify these JSON columns in src/lib/json-columns.ts").toEqual([]);
    const places = PHOTO_POSITIONS.filter((p) => p.kind !== "rpc").map((p) => `${p.relation}.${p.field}`);
    expect(places.filter((p) => json.includes(p))).toEqual(["activity_posts.body"]);
    expect(PHOTO_POSITIONS.filter((p) => p.kind === "body").map((p) => `${p.relation}.${p.field}`)).toEqual(["activity_posts.body"]);
  });

  it("every RPC path copies a listed column or body", () => {
    const places = new Set(PHOTO_POSITIONS.filter((p) => p.kind !== "rpc").map((p) => `${p.relation}.${p.field}`));
    for (const p of PHOTO_POSITIONS.filter((p) => p.kind === "rpc")) expect(places.has(p.source!), `${p.relation} ${p.field}`).toBe(true);
  });
});

describe("a post body's photos are the shape its guard checks (N940, #196 review B)", () => {
  it("bodyPhotoUrls gives the guard's expected list for every case in photo_signing_rules_guard.sql", () => {
    const guard = read("../../supabase/tests/photo_signing_rules_guard.sql");
    const block = guard.slice(guard.indexOf("-- body-cases:begin"), guard.indexOf("-- body-cases:end"));
    const cases = [...block.matchAll(/^\s*\(\$c\$(.*)\$c\$, \$c\$(.*)\$c\$\),?$/gm)];
    expect(cases.length).toBeGreaterThan(10);
    for (const [, body, expected] of cases) {
      expect(bodyPhotoUrls(JSON.parse(body)).sort(), body).toEqual(JSON.parse(expected));
    }
  });

  it("a nested images block, a string urls, a non-array body and other block types are never signed", () => {
    const at = (body: unknown) => signedAt("activity_posts?select=id,body", [{ id: "p", body }]);
    expect(at([{ type: "text", x: { type: "images", urls: [theirs] } }])).toEqual([]);
    expect(at([{ type: "images", urls: theirs }])).toEqual([]);
    expect(at({ type: "images", urls: [theirs] })).toEqual([]);
    expect(at([{ type: "embed", url: theirs }])).toEqual([]);
    expect(at([{ type: "images", urls: [theirs] }])).toEqual([theirs]);
  });
});

describe("only the places the database guards are signed, by table and by RPC (N940, #196 review A)", () => {
  const mine = `${O}/storage/v1/object/public/car-images/${ME}/mine.webp`;

  it("url is signed on a photo table and nowhere else", () => {
    expect(signedAt("car_images?select=url", [{ url: mine }])).toEqual([mine]);
    expect(signedAt("order_item_snapshot_images?select=url", [{ url: mine }])).toEqual([mine]);
    for (const table of ["dispute_evidence", "mod_items", "messages", "listings", "profiles", "agent_events"]) {
      expect(signedAt(`${table}?select=url`, [{ url: theirs }]), table).toEqual([]);
    }
    expect(signedAt("mod_items?select=*", [{ image_url: mine, product_url: theirs }])).toEqual([mine]);
    expect(signedAt("cars", [{ cover_image_url: mine, image: theirs, cover: theirs, url: theirs }])).toEqual([mine]);
  });

  it("follows aliases both ways: a guarded column renamed is signed, an unguarded column named like one is not", () => {
    expect(signedAt("car_images?select=photo:url", [{ photo: mine }])).toEqual([mine]);
    expect(signedAt("mod_items?select=image_url:product_url", [{ image_url: theirs }])).toEqual([]);
    expect(signedAt("mod_items?select=*,image_url:product_url", [{ image_url: theirs }])).toEqual([]);
    expect(signedAt("car_images?select=url::text", [{ url: mine }])).toEqual([mine]);
    expect(signedAt("activity_posts?select=url:body->0->>url", [{ url: theirs }])).toEqual([]);
  });

  it("follows embeds by relation, whatever the response key", () => {
    const select = encodeURIComponent("id,photos:car_images(url),seller:profiles!orders_seller_id_fkey(avatar_url),order_items(order_item_snapshot_images(url),listings(id))");
    const value = [{ id: "o", photos: [{ url: mine }], seller: { avatar_url: theirs }, order_items: [{ order_item_snapshot_images: [{ url: mine }], listings: { id: "l", url: theirs } }] }];
    expect(signedAt(`orders?select=${select}`, value)).toEqual([mine]);
    // A key that isn't in the select (an embed the parser didn't see) is not trusted.
    expect(signedAt("cars?select=id", [{ id: "c", car_images: [{ url: theirs }] }])).toEqual([]);
    // A spread puts another table's columns on the row: the star stops naming columns.
    expect(signedAt(`cars?select=${encodeURIComponent("*,...car_images(url)")}`, [{ url: theirs, cover_image_url: theirs }])).toEqual([]);
  });

  it("an RPC is signed only at its listed paths, and an RPC not listed not at all", () => {
    const feed = { posts: [{ cover_url: mine, body: [{ type: "images", urls: [mine] }], image: theirs }], cars: [{ cover_image_url: mine }], owners: [{ avatar_url: theirs }], garage: [{ url: theirs }] };
    expect(signedAt("rpc/feed_hydration", feed)).toEqual([mine]);
    expect(signedAt("rpc/feed_hydration", { posts: [{ cover_url: theirs }] })).toEqual([theirs]);
    expect(signedAt("rpc/feed_hydration", { owners: [{ cover_url: theirs }], listings: [{ image: theirs }] })).toEqual([]);
    expect(signedAt("rpc/seller_listing_stats", [{ cover_url: mine, title: theirs }])).toEqual([mine]);
    expect(signedAt("rpc/garage_car_stats", [{ latest_update: { cover_url: mine, body: [{ type: "before_after", beforeUrl: mine }] } }])).toEqual([mine]);
    expect(signedAt("rpc/agent_chat_turn_status", { member: { cards: [{ image: theirs, image_url: theirs, url: theirs }] } })).toEqual([]);
    expect(signedAt("rpc/edit_car_gallery", { image: { url: theirs } })).toEqual([]);
    expect(signedAt("rpc/seller_listing_stats?select=cover:cover_url", [{ cover: mine }])).toEqual([mine]);
    expect(signedAt("rpc/seller_listing_stats?select=cover_url:title", [{ cover_url: theirs }])).toEqual([]);
  });

  it("an answer with no readable context signs nothing", () => {
    expect(signingContext(`${O}/rest/v1/car_images?select=url(`)).toBeNull();
    expect(signingContext(`${O}/rest/v1/car_images?select=url&select=id`)).toBeNull();
    expect(signingContext(`${O}/storage/v1/object/car-images/x`)).toBeNull();
    expect(signingContext(`${O}/rest/v1/rpc/Bad-Name`)).toBeNull();
    expect(photoFieldUrls([{ url: mine }], null, O)).toEqual([]);
  });

  it("every select the app sends parses, so no read loses its photos to a parse failure", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(full);
      }
    };
    walk(path.resolve(__dirname, ".."));
    let seen = 0;
    for (const file of files) {
      for (const m of fs.readFileSync(file, "utf8").matchAll(/\.select\(\s*"([^"$]*)"/g)) {
        seen++;
        expect(parseSelect(m[1]), `${path.relative(path.resolve(__dirname, ".."), file)}: ${m[1]}`).not.toBeNull();
      }
    }
    expect(seen).toBeGreaterThan(100);
    // The export signs by its sections' projections.
    const projections = [...read("account-export-contract.ts").matchAll(/(?:sourceProjection|projection): "([^"]*)"/g)];
    expect(projections.length).toBeGreaterThan(20);
    for (const [, projection] of projections) expect(parseSelect(projection), projection).not.toBeNull();
  });
});

describe("expired, unreadable and respelled signed links are refused at the image gate (N940, #196 review D)", () => {
  const at = Date.UTC(2026, 10, 10, 12);
  const token = (payload: object | null) => `e30.${payload ? Buffer.from(JSON.stringify(payload)).toString("base64url") : ""}.s`;
  const link = (payload: object | null, base = "https://p.supabase.co/storage/v1/object/sign/listing-images/u/a.webp") => `${base}?token=${token(payload)}`;
  const live = { exp: at / 1000 + 600 };

  it("an expired or malformed signed link reads as expired; a live one and anything else does not", () => {
    expect(signedPhotoLinkExpired(link({ exp: at / 1000 - 1 }), at)).toBe(true);
    expect(signedPhotoLinkExpired(link(live), at)).toBe(false);
    expect(signedPhotoLinkExpired(link({}), at)).toBe(true);
    expect(signedPhotoLinkExpired(link(null), at)).toBe(true);
    expect(signedPhotoLinkExpired("https://p.supabase.co/storage/v1/object/public/listing-images/u/a.webp", at)).toBe(false);
    expect(signedPhotoLinkExpired("/hero.png", at)).toBe(false);
    expect(signedPhotoLinkExpired(null, at)).toBe(false);
  });

  it("a percent-encoded token, a missing or doubled token, or an encoded route is decoded before it is judged", () => {
    const old = token({ exp: at / 1000 - 1 });
    const base = "https://p.supabase.co/storage/v1/object/sign/listing-images/u/a.webp";
    // ?token=%65yJ… is the same token to Storage; it used to slip past the literal `token=` match.
    expect(signedPhotoLinkExpired(`${base}?token=%65${old.slice(1)}`, at)).toBe(true);
    expect(signedPhotoLinkExpired(`${base}?%74oken=${old}`, at)).toBe(true);
    expect(signedPhotoLinkExpired(base, at)).toBe(true);
    expect(signedPhotoLinkExpired(`${base}?download=1`, at)).toBe(true);
    expect(signedPhotoLinkExpired(`${base}?token=${token(live)}&token=${old}`, at)).toBe(true);
    expect(signedPhotoLinkExpired(link({ exp: at / 1000 - 1 }, base.replace("/sign/", "/%73ign/")), at)).toBe(true);
    expect(signedPhotoLinkExpired(link({ exp: at / 1000 - 1 }, base.replace("/object/", "/x/../object/")), at)).toBe(true);
    expect(signedPhotoLinkExpired(link({ exp: at / 1000 - 1 }, base.replace("/object/sign/", "/render/image/sign/")), at)).toBe(true);
    expect(signedPhotoLinkExpired(`/storage/v1/object/sign/car-images/u/a.webp?token=${old}`, at)).toBe(true);
    expect(signedPhotoLinkExpired(`${base}?token=${encodeURIComponent(token(live))}`, at)).toBe(false);
  });

  it("the gate refuses every member-photo spelling but a live signed link", () => {
    const base = "https://p.supabase.co/storage/v1/object";
    expect(memberPhotoSourceRefused(link(live), at)).toBe(false);
    expect(memberPhotoSourceRefused(`${base}/public/car-images/u/a.webp`, at)).toBe(true);
    expect(memberPhotoSourceRefused(`${base}/%70ublic/car-images/u/a.webp`, at)).toBe(true);
    expect(memberPhotoSourceRefused(`${base}/authenticated/car-images/u/a.webp`, at)).toBe(true);
    expect(memberPhotoSourceRefused(`${base}/sign/car-images/u/a.webp?token=%zz`, at)).toBe(true);
    expect(memberPhotoSourceRefused(`${base}/public/avatars/u/a.webp`, at)).toBe(false);
    expect(memberPhotoSourceRefused("/hero.png", at)).toBe(false);
    expect(memberPhotoSourceRefused(null, at)).toBe(false);
  });
});

describe("where a read carries its owner, a photo outside the owner's folder isn't signed (N940, #196 review P2-2)", () => {
  const mine = `${O}/storage/v1/object/public/car-images/${ME}/mine.webp`;

  it("checks a row's own owner column, and a photo table takes its parent's", () => {
    expect(signedAt("cars?select=owner_id,cover_image_url", [{ owner_id: ME, cover_image_url: theirs }])).toEqual([]);
    expect(signedAt("cars?select=owner_id,cover_image_url", [{ owner_id: ME, cover_image_url: mine }])).toEqual([mine]);
    const select = encodeURIComponent("owner_id,car_images(url)");
    expect(signedAt(`cars?select=${select}`, [{ owner_id: ME, car_images: [{ url: mine }, { url: theirs }] }])).toEqual([mine]);
    const order = encodeURIComponent("seller_id,order_items(order_item_snapshot_images(url))");
    expect(signedAt(`orders?select=${order}`, [{ seller_id: STRANGER, order_items: [{ order_item_snapshot_images: [{ url: mine }, { url: theirs }] }] }])).toEqual([theirs]);
  });

  it("an owning table read without its owner, or with a null owner, isn't checked (the database is)", () => {
    expect(signedAt("cars?select=cover_image_url", [{ cover_image_url: theirs }])).toEqual([theirs]);
    expect(signedAt("cars?select=owner_id,cover_image_url", [{ owner_id: null, cover_image_url: theirs }])).toEqual([theirs]);
    expect(signedAt("orders?select=seller_id,order_items(order_item_snapshot_images(url))", [{ seller_id: null, order_items: [{ order_item_snapshot_images: [{ url: theirs }] }] }])).toEqual([theirs]);
  });

  it("an embedded owning table answers for itself, never for its parent's owner", () => {
    // A listing (seller ME) embedding a post by someone else: the post's photo is its author's.
    const select = encodeURIComponent("seller_id,activity_posts(author_id,activity_images(url))");
    expect(signedAt(`listings?select=${select}`, [{ seller_id: ME, activity_posts: [{ author_id: STRANGER, activity_images: [{ url: theirs }] }] }])).toEqual([theirs]);
    const noAuthor = encodeURIComponent("seller_id,activity_posts(activity_images(url))");
    expect(signedAt(`listings?select=${noAuthor}`, [{ seller_id: ME, activity_posts: [{ activity_images: [{ url: theirs }] }] }])).toEqual([theirs]);
    // An alias of the owner column still counts.
    expect(signedAt(`cars?select=${encodeURIComponent("who:owner_id,cover_image_url")}`, [{ who: ME, cover_image_url: theirs }])).toEqual([]);
  });

  it("an RPC path checks the owner on the object that holds it", () => {
    expect(signedAt("rpc/feed_hydration", { posts: [{ author_id: ME, cover_url: theirs }], cars: [{ owner_id: STRANGER, cover_image_url: theirs }] })).toEqual([theirs]);
    expect(signedAt("rpc/feed_hydration", { posts: [{ author_id: ME, body: [{ type: "images", urls: [theirs, mine] }] }] })).toEqual([mine]);
  });

  it("says why an answer has no context, so the boundary can report it", () => {
    expect(signingContextFor(`${O}/rest/v1/car_images?select=url(`)).toEqual({ reason: "unparsable-select" });
    expect(signingContextFor(`${O}/rest/v1/car_images?select=url&select=id`)).toEqual({ reason: "two-selects" });
    expect(signingContextFor(`${O}/rest/v1/rpc/Bad-Name`)).toEqual({ reason: "bad-path" });
    expect(signingContextFor(`${O}/auth/v1/user`)).toEqual({ reason: "not-rest" });
  });
});

describe("every photo-like column is signed or named as not signed (N940, #196 review P3)", () => {
  it("fails on a new url, image_url, cover_… or photo column that neither list names", () => {
    const types = read("database.generated.ts");
    const tables = types.slice(types.indexOf("    Tables: {"), types.indexOf("    Views: {"));
    const found: string[] = [];
    for (const table of tables.matchAll(/\n {6}([a-z_]+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/g)) {
      for (const column of table[2].matchAll(/^ {10}([a-z_]+): (?:string|string\[\]|Json)(?: \| null)?$/gm)) {
        if (/(^|_)(url|urls|image|images|photo|photos|thumbnail|attachments)$|^cover|_cover|photo/.test(column[1])) found.push(`${table[1]}.${column[1]}`);
      }
    }
    expect(found.length).toBeGreaterThan(10);
    const signed = new Set(PHOTO_POSITIONS.filter((p) => p.kind === "column").map((p) => `${p.relation}.${p.field}`));
    expect(found.filter((c) => !signed.has(c) && !(c in NOT_SIGNED_PHOTO_LIKE_COLUMNS)), "add these to PHOTO_POSITIONS (with a guard) or NOT_SIGNED_PHOTO_LIKE_COLUMNS").toEqual([]);
    for (const c of Object.keys(NOT_SIGNED_PHOTO_LIKE_COLUMNS)) expect(found, `${c} is no longer in the schema`).toContain(c);
    for (const c of signed) expect(found).toContain(c);
  });
});

describe("every select the app sends, constant and template ones too, parses and signs its photos (N940, #196 review P3)", () => {
  const SRC = path.resolve(__dirname, "..");
  const files: string[] = [];
  (function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(full);
    }
  })(SRC);
  const sources = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));
  /** A string constant's value: in the file, else wherever it is exported; `${X}` filled in. */
  const constant = (name: string, file: string, depth = 0): string | null => {
    const def = new RegExp(String.raw`(?:^|\n)\s*(?:export\s+)?const\s+${name}\s*=\s*(?:"([^"]*)"|\x60([^\x60]*)\x60)`);
    const hit = def.exec(sources.get(file)!) ?? [...sources.values()].map((t) => (/export\s+const/.test(t) ? def.exec(t) : null)).find(Boolean) ?? null;
    if (!hit) return null;
    const text = hit[1] ?? hit[2];
    if (depth > 3) return null;
    return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, inner: string) => constant(inner, file, depth + 1) ?? "\u0000");
  };
  // Parameters of generic helpers, not selects of their own: the callers' projections are checked elsewhere.
  const PARAMETERS: Record<string, string> = {
    projection: "the account export's section projections (checked below)",
    field: "the account export's id column for a related table",
    columns: "generic money-table readers (ledger reconciliation, admin queries); no photo tables",
  };
  type Found = { file: string; table: string | null; select: string };
  const selects: Found[] = [];
  const unresolved: string[] = [];
  for (const [file, text] of sources) {
    for (const m of text.matchAll(/\.select\(\s*(?:"([^"]*)"|'([^']*)'|\x60([^\x60]*)\x60|([A-Za-z_][A-Za-z0-9_]*)\s*[,)])/g)) {
      let select: string | null = m[1] ?? m[2] ?? m[3] ?? null;
      if (m[3] !== undefined) select = m[3].replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, n: string) => constant(n, file) ?? "\u0000");
      if (m[4] !== undefined) {
        if (m[4] in PARAMETERS) continue;
        select = constant(m[4], file);
      }
      if (select === null || select.includes("\u0000")) { unresolved.push(`${path.relative(SRC, file)}: ${m[0]}`); continue; }
      const before = text.slice(Math.max(0, m.index! - 600), m.index!);
      const from = [...before.matchAll(/\.(from|rpc)\(\s*"([a-z_]+)"/g)].pop();
      selects.push({ file: path.relative(SRC, file), table: from && from[1] === "from" ? from[2] : null, select });
    }
  }

  it("finds them all, and every one parses", () => {
    expect(unresolved, "a select whose text the test can't find; add it to PARAMETERS with a reason only if it is a helper's parameter").toEqual([]);
    expect(selects.length).toBeGreaterThan(120);
    for (const s of selects) expect(parseSelect(s.select), `${s.file}: ${s.select}`).not.toBeNull();
  });

  /**
   * A second, plain reading of a select that shares no code with parseSelect:
   * each top-level item as the key its answer carries and the column or
   * relation it names. Enough for the selects this app writes; a select it
   * can't read (a spread, a JSON path) is skipped, not guessed.
   */
  type PlainItem = { key: string; column: string } | { key: string; relation: string; inner: string };
  const plainItems = (select: string): PlainItem[] | null => {
    const text = select.replace(/\s+/g, "");
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
      else if (text[i] === "," && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
    }
    parts.push(text.slice(start));
    const items: PlainItem[] = [];
    for (const part of parts.filter(Boolean)) {
      if (part.startsWith("...") || part.includes("->") || part.includes('"')) return null;
      const open = part.indexOf("(");
      const head = (open < 0 ? part : part.slice(0, open)).split("::")[0];
      const [first, second] = head.split(":");
      const name = (second ?? first).split("!")[0];
      if (open < 0) items.push({ key: second === undefined ? first : first, column: name });
      else if (/^(count|sum|avg|min|max)$/.test(name) && part.endsWith("()")) continue;
      else items.push({ key: second === undefined ? name : first, relation: name, inner: part.slice(open + 1, part.lastIndexOf(")")) });
    }
    return items;
  };

  it("N940: each select that reads a photo place signs a photo there, by a reading of the select that is not the signer's", () => {
    const photoFields = (table: string) => PHOTO_POSITIONS.filter((p) => p.kind !== "rpc" && p.relation === table);
    let checked = 0;
    let skipped = 0;
    for (const s of selects) {
      if (!s.table) continue;
      const urls: string[] = [];
      let readable = true;
      const sample = (table: string, select: string): Record<string, unknown> => {
        const row: Record<string, unknown> = {};
        const items = plainItems(select);
        if (!items) { readable = false; return row; }
        const place = (key: string, kind: string) => {
          const url = `${O}/storage/v1/object/public/car-images/${ME}/sample-${urls.length}.webp`;
          urls.push(url);
          row[key] = kind === "body" ? [{ type: "images", urls: [url] }] : url;
        };
        for (const item of items) {
          if ("relation" in item) row[item.key] = [sample(item.relation, item.inner)];
          else if (item.column === "*") for (const p of photoFields(table)) place(p.field, p.kind);
          else {
            const p = photoFields(table).find((field) => field.field === item.column);
            if (p) place(item.key, p.kind);
          }
        }
        return row;
      };
      const value = [sample(s.table, s.select)];
      if (!readable) { skipped++; continue; }
      if (!urls.length) continue;
      checked++;
      const found = photoFieldUrls(value, signingContext(`${O}/rest/v1/${s.table}?select=${encodeURIComponent(s.select)}`), O);
      expect([...found].sort(), `${s.file}: ${s.table} ${s.select}`).toEqual([...urls].sort());
    }
    expect(checked).toBeGreaterThan(30);
    // The plain reading has to cover nearly all of them, or this proves little.
    expect(skipped).toBeLessThan(5);
  });
});

describe("an RPC's body path is walked as a body (N940, review of #210)", () => {
  it("signs the photos in car_update_page's and garage_car_stats' bodies, which are arrays themselves", () => {
    const mine = `${O}/storage/v1/object/public/activity-images/${ME}/update.webp`;
    expect(signedAt("rpc/car_update_page", [{ id: "p", body: [{ type: "images", urls: [mine] }, { type: "text", text: theirs }] }])).toEqual([mine]);
    expect(signedAt("rpc/garage_car_stats", [{ latest_update: { body: [{ type: "before_after", beforeUrl: mine }] } }])).toEqual([mine]);
    expect(signedAt("rpc/car_update_page", [{ id: "p", body: [{ type: "text", x: { type: "images", urls: [theirs] } }] }])).toEqual([]);
  });
});
