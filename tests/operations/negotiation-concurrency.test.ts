import { createHash } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";

import { admin } from "./environment";

/**
 * Negotiation v2 under contention (migrations 20261017160000, 20261018100200).
 * Two real database sessions race the same offer or listing: the first holds
 * its transaction open, the second must wait on the first's locks (not
 * deadlock, not interleave) and then get the answer the rules give once the
 * first has committed. Every path takes listing → offer → order → payment.
 */
const DB_URL = process.env.DRVN_OPERATIONS_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!/@(127\.0\.0\.1|localhost):54322\//.test(DB_URL)) throw new Error("Negotiation drills require the isolated local database");

const stamp = crypto.randomUUID();
const users: Record<"seller" | "buyer" | "rival", string> = { seller: "", buyer: "", rival: "" };
const invitationIds: string[] = [];
let one: Client;
let two: Client;

async function member(role: "seller" | "buyer", label: string) {
  const email = `negotiation-${label}-${stamp}@drvn.test`;
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("Missing negotiation drill user");
  const id = created.data.user.id;
  const invitation = await admin.from("beta_invitations").insert({
    email_normalized: email,
    roles: [role],
    token_hash: createHash("sha256").update(`${stamp}:${label}`).digest("hex"),
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    consumed_at: new Date().toISOString(),
    consumed_by: id,
  }).select("id").single().throwOnError();
  invitationIds.push(invitation.data.id);
  await admin.from("beta_memberships").insert({ user_id: id, invitation_id: invitation.data.id, email_normalized: email, roles: [role] }).throwOnError();
  return id;
}

async function listing(title: string, price: number) {
  const row = await admin.from("listings").insert({
    seller_id: users.seller, title, category: "engine", price_cents: price, shipping_cents: 0, currency: "USD", status: "active",
  }).select("id").single().throwOnError();
  return row.data.id;
}

/** Acts as a signed-in member for the rest of this session's transaction. */
async function as(client: Client, memberId: string) {
  await client.query("select set_config('role', 'authenticated', true), set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: memberId, role: "authenticated" }),
  ]);
}

async function inTransaction<T>(client: Client, memberId: string | null, sql: string, params: unknown[]): Promise<T> {
  await client.query("begin");
  if (memberId) await as(client, memberId);
  const result = await client.query(sql, params);
  return result.rows[0] as T;
}

/** Resolves to the SQLSTATE a pending statement failed with, or "ok". */
function outcome(promise: Promise<unknown>) {
  return promise.then(() => "ok", (error: { code?: string }) => error.code ?? "error");
}

async function stillWaiting(promise: Promise<unknown>, ms = 300) {
  const settled = await Promise.race([promise.then(() => true, () => true), new Promise((resolve) => setTimeout(() => resolve(false), ms))]);
  return !settled;
}

async function openOffer(listingId: string, buyerId: string, amount: number) {
  const offerId = crypto.randomUUID();
  await one.query("begin");
  await as(one, buyerId);
  await one.query("select public.offer_open($1, $2, $3, null)", [offerId, listingId, amount]);
  await one.query("commit");
  return offerId;
}

async function move(client: Client, memberId: string, offerId: string, kind: string, amount: number | null, round: number) {
  await client.query("begin");
  await as(client, memberId);
  return client.query("select public.offer_move($1, $2, $3, $4, $5) as r", [offerId, kind, amount, `${kind}:${offerId}:r${round}:${amount ?? 0}:${crypto.randomUUID()}`, round]);
}

beforeAll(async () => {
  users.seller = await member("seller", "seller");
  users.buyer = await member("buyer", "buyer");
  users.rival = await member("buyer", "rival");
  one = new Client({ connectionString: DB_URL });
  two = new Client({ connectionString: DB_URL });
  await Promise.all([one.connect(), two.connect()]);
}, 60_000);

afterAll(async () => {
  await Promise.allSettled([one?.query("rollback"), two?.query("rollback")]);
  await Promise.allSettled([one?.end(), two?.end()]);
  const ids = Object.values(users).filter(Boolean);
  if (ids.length) {
    const orders = await admin.from("orders").select("id").in("buyer_id", ids).throwOnError();
    if (orders.data.length) await admin.from("orders").delete().in("id", orders.data.map((row) => row.id)).throwOnError();
  }
  for (const id of ids.reverse()) await admin.auth.admin.deleteUser(id);
  if (invitationIds.length) await admin.from("beta_invitations").delete().in("id", invitationIds).throwOnError();
}, 60_000);

it("lets one of two simultaneous counters land and refuses the other as stale", async () => {
  const listingId = await listing(`Negotiation counters ${stamp}`, 50000);
  const offerId = await openOffer(listingId, users.buyer, 30000);

  await move(one, users.seller, offerId, "counter", 45000, 1);
  const second = move(two, users.seller, offerId, "counter", 46000, 1);
  expect(await stillWaiting(second)).toBe(true);
  await one.query("commit");
  expect(await outcome(second)).toBe("OF003");
  await two.query("rollback");

  const row = await admin.from("offers").select("status, counter_amount_cents, round_count").eq("id", offerId).single().throwOnError();
  expect(row.data).toEqual({ status: "countered", counter_amount_cents: 45000, round_count: 2 });
}, 30_000);

it("settles a buyer's acceptance racing the seller's pass: the first to lock wins, the other is told it's settled", async () => {
  const listingId = await listing(`Negotiation accept vs pass ${stamp}`, 50000);
  const offerId = await openOffer(listingId, users.buyer, 30000);
  await move(one, users.seller, offerId, "counter", 40000, 1);
  await one.query("commit");

  await move(one, users.buyer, offerId, "accept", null, 2);
  const pass = move(two, users.seller, offerId, "decline", null, 2);
  expect(await stillWaiting(pass)).toBe(true);
  await one.query("commit");
  expect(await outcome(pass)).toBe("OF005");
  await two.query("rollback");

  const order = await admin.from("orders").select("id, subtotal_cents, status").eq("origin_offer_id", offerId).single().throwOnError();
  expect(order.data).toMatchObject({ subtotal_cents: 40000, status: "pending" });
}, 30_000);

it("refuses the seller's cancellation once the buyer's checkout has begun, even when they race", async () => {
  const listingId = await listing(`Negotiation freeze vs cancel ${stamp}`, 50000);
  const offerId = await openOffer(listingId, users.buyer, 30000);
  const accepted = await move(one, users.seller, offerId, "accept", null, 1);
  await one.query("commit");
  const orderId = (accepted.rows[0].r as { order_id: string }).order_id;

  const shipping = { name: "Drill Buyer", line1: "1 Test Street", city: "Detroit", postcode: "48201", country: "US", isCollection: false };
  await inTransaction(one, null, "select public.freeze_accepted_offer_checkout($1, $2, $3) as r", [orderId, users.buyer, JSON.stringify(shipping)]);
  await two.query("begin");
  const cancel = two.query("select public.settle_seller_cancellation($1, $2, 'drill') as r", [orderId, users.seller]);
  expect(await stillWaiting(cancel)).toBe(true);
  await one.query("commit");
  const result = (await cancel).rows[0].r as { ok: boolean; reason?: string };
  await two.query("commit");
  expect(result.ok).toBe(false);
  expect(result.reason).toContain("started checkout");

  const order = await admin.from("orders").select("status").eq("id", orderId).single().throwOnError();
  expect(order.data.status).toBe("pending");
}, 30_000);

it("refuses an acceptance once another buyer's checkout has reserved the part", async () => {
  const listingId = await listing(`Negotiation accept vs checkout ${stamp}`, 50000);
  const offerId = await openOffer(listingId, users.buyer, 30000);

  const checkoutContext = {
    version: 1,
    shipping: { name: "Rival Buyer", line1: "2 Test Street", city: "Detroit", postcode: "48201", country: "US", isCollection: false },
    destinationHash: `negotiation-drill-${stamp}`,
    quoteIds: {},
  };
  await inTransaction(one, null, "select public.purchase_begin($1, $2, $3, interval '15 minutes', '{}'::jsonb, $4, $5) as r", [
    users.rival, [listingId], `negotiation-rival:${stamp}`, `negotiation-rival-browser:${stamp}`, JSON.stringify(checkoutContext),
  ]);
  const accept = move(two, users.seller, offerId, "accept", null, 1);
  expect(await stillWaiting(accept)).toBe(true);
  await one.query("commit");
  expect(await outcome(accept)).toBe("OF007");
  await two.query("rollback");

  const items = await admin.from("order_items").select("order_id").eq("listing_id", listingId).throwOnError();
  expect(items.data).toHaveLength(1);
  const offer = await admin.from("offers").select("status").eq("id", offerId).single().throwOnError();
  expect(offer.data.status).toBe("open");
}, 30_000);
