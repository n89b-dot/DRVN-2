import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, afterEach, expect, it } from "vitest";

import { runAgentPass, type AgentDb } from "@/lib/agent/worker";

/**
 * The A2 simulations against the real database (20261021100000–100100): the
 * worker's own code (src/lib/agent/worker.ts) drives agent_* as the
 * agent_worker role, through SET ROLE, while people move through offer_open /
 * offer_move as themselves. Seller agent vs a person, buyer agent vs a person,
 * and agent vs agent, each to a sale within both owners' limits.
 *
 * Everything runs in one transaction that is rolled back, so the drill leaves
 * nothing behind on the database it runs against (the role grant included).
 * Each worker call runs in its own savepoint, as each would be its own
 * transaction in production.
 */
const DB_URL = process.env.DRVN_AGENT_DB_URL ?? process.env.DRVN_OPERATIONS_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!/@(127\.0\.0\.1|localhost):(54322|55442)\//.test(DB_URL)) throw new Error("Agent drills require the isolated local database");

let db: Client;
let savepoint = 0;

async function as(role: "admin" | "worker" | string) {
  if (role === "admin") await db.query("select set_config('role', 'none', true), set_config('request.jwt.claims', '', true)");
  else if (role === "worker") await db.query("select set_config('role', 'agent_worker', true), set_config('request.jwt.claims', '', true)");
  else await db.query("select set_config('role', 'authenticated', true), set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: role, role: "authenticated" })]);
}

/** The worker's connection: agent_worker, one savepoint per call. */
const workerDb: AgentDb = {
  async query(text, values) {
    const name = `w${++savepoint}`;
    await db.query(`savepoint ${name}`);
    try {
      await as("worker");
      const result = await db.query(text, values as unknown[]);
      await as("admin");
      await db.query(`release savepoint ${name}`);
      return { rows: result.rows };
    } catch (error) {
      await db.query(`rollback to savepoint ${name}`);
      await as("admin");
      throw error;
    }
  },
};

async function member(label: string) {
  const id = crypto.randomUUID();
  await db.query("insert into auth.users(id, email) values ($1, $2)", [id, `agent-drill-${label}-${id}@drvn.test`]);
  return id;
}

async function listing(seller: string, price: number, floor: number | null) {
  const id = crypto.randomUUID();
  await db.query(
    "insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, status) values ($1, $2, 'Agent drill part', 'performance', $3, 0, 'active')",
    [id, seller, price],
  );
  // The listing's own minimum lives only in listing_private_terms.
  await db.query(
    "insert into public.listing_private_terms(listing_id, seller_id, offer_floor_cents) values ($1, $2, $3) on conflict (listing_id) do update set offer_floor_cents = excluded.offer_floor_cents",
    [id, seller, floor],
  );
  return id;
}

async function asMember<T>(memberId: string, sql: string, values: unknown[]): Promise<T> {
  const name = `m${++savepoint}`;
  await db.query(`savepoint ${name}`);
  try {
    await as(memberId);
    const result = await db.query(sql, values);
    await as("admin");
    await db.query(`release savepoint ${name}`);
    return result.rows[0] as T;
  } catch (error) {
    await db.query(`rollback to savepoint ${name}`);
    await as("admin");
    throw error;
  }
}

/** The buyer's live offer, else their latest (offers in one transaction share a created_at). */
async function offerOf(listingId: string, buyer: string) {
  const result = await db.query("select * from public.offers where listing_id = $1 and buyer_id = $2 order by (status in ('open', 'countered')) desc, round_count desc limit 1", [listingId, buyer]);
  return result.rows[0] as { id: string; status: string; amount_cents: number; counter_amount_cents: number | null; round_count: number } | undefined;
}

/** Run worker passes until the queue is empty (or a pass makes no progress). */
async function drain() {
  for (let i = 0; i < 12; i++) {
    const pass = await runAgentPass(workerDb, { limit: 10 });
    if (pass.claimed === 0) return;
  }
  throw new Error("The agent queue never drained");
}

async function pendingApproval(owner: string) {
  const result = await db.query("select id, reason from public.agent_approvals where owner_id = $1 and status = 'pending'", [owner]);
  return result.rows[0] as { id: string; reason: string } | undefined;
}

async function soldAt(listingId: string) {
  const result = await db.query("select o.subtotal_cents from public.orders o join public.offers f on f.id = o.origin_offer_id where f.listing_id = $1", [listingId]);
  return result.rows[0]?.subtotal_cents as number | undefined;
}

beforeAll(async () => {
  db = new Client({ connectionString: DB_URL });
  await db.connect();
});

beforeEach(async () => {
  await db.query("begin");
  // SET ROLE needs membership; the grant is inside the rolled-back transaction.
  await db.query("grant agent_worker to current_user");
  await db.query("update public.agent_controls set cleared_at = now() where scope = 'all' and cleared_at is null");
  // Mandates need their side's beta step open (20261026100000).
  await db.query("update public.agent_beta_steps set open = true where step in ('seller', 'buyer')");
});

afterEach(async () => {
  await db.query("rollback");
});

afterAll(async () => {
  await db.end();
});

it("seller's agent vs a person: counters within its minimum, and the person takes the counter", async () => {
  const seller = await member("seller");
  const buyer = await member("buyer");
  const part = await listing(seller, 100_000, 60_000);
  await asMember(seller, "select public.agent_mandate_set('seller', $1, 70000, null, null, null, 'balanced', null, true)", [part]);

  // A probe below the agent's minimum is declined at once and costs an offer.
  const probe = await asMember<{ r: { outcome: string } }>(buyer, "select public.offer_open($1, $2, 65000, null) as r", [crypto.randomUUID(), part]);
  expect(probe.r.outcome).toBe("below_minimum");
  await drain();

  await asMember(buyer, "select public.offer_open($1, $2, 72000, null)", [crypto.randomUUID(), part]);
  await drain();
  const countered = (await offerOf(part, buyer))!;
  expect(countered.status).toBe("countered");
  expect(countered.counter_amount_cents!).toBeGreaterThanOrEqual(70_000);
  expect(countered.counter_amount_cents!).toBeLessThanOrEqual(100_000);
  const round = await db.query("select actor_task_id, actor_member_id, mandate_version from public.offer_rounds where offer_id = $1 and round_no = 2", [countered.id]);
  expect(round.rows[0]).toMatchObject({ actor_member_id: seller, mandate_version: 1 });
  expect(round.rows[0].actor_task_id).not.toBeNull();

  await asMember(buyer, "select public.offer_move($1, 'accept', null, $2, $3)", [countered.id, `accept:${countered.id}:r2:0`, countered.round_count]);
  expect(await soldAt(part)).toBe(countered.counter_amount_cents);
  // The seller's task (and its minimum) stays until the sale completes.
  const waiting = await db.query("select status from public.agent_tasks where owner_id = $1", [seller]);
  expect(waiting.rows[0].status).toBe("waiting_for_event");
  await db.query("update public.listings set status = 'sold', sold_at = now() where id = $1", [part]);
  await db.query("select public.agent_reconcile_outbox(50)");
  const task = await db.query("select status, outcome from public.agent_tasks where owner_id = $1", [seller]);
  expect(task.rows[0]).toEqual({ status: "completed", outcome: "sold" });
});

it("buyer's agent vs a person: opens, counters back, and accepts a counter within its ceiling", async () => {
  const seller = await member("seller");
  const buyer = await member("buyer");
  const part = await listing(seller, 100_000, null);
  await asMember(buyer, "select public.agent_mandate_set('buyer', $1, null, null, 85000, 'item', 'balanced', null, false)", [part]);
  await drain();
  let offer = (await offerOf(part, buyer))!;
  expect(offer.status).toBe("open");
  expect(offer.amount_cents).toBe(70_000);

  // The seller (a person) counters above the buyer's max; the agent counters back.
  await asMember(seller, "select public.offer_move($1, 'counter', 95000, $2, 1)", [offer.id, `counter:${offer.id}:r1:95000`]);
  await drain();
  offer = (await offerOf(part, buyer))!;
  expect(offer.status).toBe("open");
  expect(offer.amount_cents).toBeGreaterThan(70_000);
  expect(offer.amount_cents).toBeLessThanOrEqual(85_000);

  // The seller comes down within the ceiling: the agent takes it by itself.
  await asMember(seller, "select public.offer_move($1, 'counter', 84000, $2, $3)", [offer.id, `counter:${offer.id}:r${offer.round_count}:84000`, offer.round_count]);
  await drain();
  expect(await soldAt(part)).toBe(84_000);
  const accept = await db.query("select actor_task_id is not null as by_agent, actor_member_id from public.offer_rounds where offer_id = $1 and kind = 'accept'", [offer.id]);
  expect(accept.rows[0]).toEqual({ by_agent: true, actor_member_id: buyer });
});

it("agent vs agent: both stay inside their own limits and reach a sale", async () => {
  const seller = await member("seller");
  const buyer = await member("buyer");
  const part = await listing(seller, 100_000, 60_000);
  await asMember(seller, "select public.agent_mandate_set('seller', $1, 70000, null, null, null, 'balanced', null, true)", [part]);
  await asMember(buyer, "select public.agent_mandate_set('buyer', $1, null, null, 88000, 'item', 'balanced', null, false)", [part]);
  await drain();

  // The seller's agent asks its owner when the buyer's last word clears the minimum.
  const approval = await pendingApproval(seller);
  if (approval) {
    expect(approval.reason).toBe("final_offer_clears_minimum");
    await asMember(seller, "select public.agent_approval_decide($1, 'accept')", [approval.id]);
  }
  const price = await soldAt(part);
  expect(price).toBeDefined();
  expect(price!).toBeGreaterThanOrEqual(70_000);
  expect(price!).toBeLessThanOrEqual(88_000);

  const rounds = await db.query("select actor_role, kind, actor_task_id is not null as by_agent from public.offer_rounds where listing_id = $1 order by created_at, round_no", [part]);
  // Every proposal came from an agent; an owner may have taken the last one.
  expect(rounds.rows.filter((r) => r.kind === "counter" || r.kind === "offer").every((r) => r.by_agent)).toBe(true);
  const tasks = await db.query("select scope, status from public.agent_tasks where listing_id = $1 order by scope", [part]);
  expect(tasks.rows).toEqual([{ scope: "buyer", status: "completed" }, { scope: "seller", status: "waiting_for_event" }]);
  const events = await db.query("select count(*)::int as n from public.agent_events where task_id in (select id from public.agent_tasks where listing_id = $1) and kind = 'move'", [part]);
  expect(events.rows[0].n).toBeGreaterThan(1);
});

it("the global switch, as seeded, stops every agent: nothing is claimed", async () => {
  const seller = await member("seller");
  const buyer = await member("buyer");
  const part = await listing(seller, 100_000, 60_000);
  await asMember(seller, "select public.agent_mandate_set('seller', $1, 70000, null, null, null, 'balanced', null, true)", [part]);
  await db.query("insert into public.agent_controls(scope, reason) values ('all', 'drill')");
  await asMember(buyer, "select public.offer_open($1, $2, 75000, null)", [crypto.randomUUID(), part]);
  const pass = await runAgentPass(workerDb, { limit: 10 });
  expect(pass.claimed).toBe(0);
  expect((await offerOf(part, buyer))!.status).toBe("open");
});
