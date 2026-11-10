import { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";

/**
 * N954 (20261110100000, review of #196): two app instances offer overlapping
 * signed photo links at the same moment, in opposite orders, the shape of the
 * top of every hour when every instance's memo expires together. With the
 * offer inserting in key order, one waits for the other and both get the same
 * winners; without it, Postgres aborts one as a deadlock and that instance
 * falls back to its own links. Two real sessions, many rounds.
 */
const DB_URL = process.env.DRVN_OPERATIONS_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!/@(127\.0\.0\.1|localhost):54322\//.test(DB_URL)) throw new Error("Photo signature drills require the isolated local database");

let one: Client;
let two: Client;
const owner = "33333333-3333-4333-8333-333333333333";
const baseWindow = 9_000_000 + Math.floor(Math.random() * 1_000_000);

beforeAll(async () => {
  one = new Client({ connectionString: DB_URL });
  two = new Client({ connectionString: DB_URL });
  await Promise.all([one.connect(), two.connect()]);
});

afterAll(async () => {
  await one.query("delete from private.photo_signatures where split_part(path, '/', 1) = $1", [owner]);
  await Promise.all([one.end(), two.end()]);
});

it("N954: overlapping offers in opposite orders never deadlock, and both see the same winners", async () => {
  for (let round = 0; round < 20; round++) {
    const window = baseWindow + round * 10;
    const objects = Array.from({ length: 200 }, (_, i) => ({ bucket: "car-images", path: `${owner}/round-${round}-${String(i).padStart(3, "0")}.webp` }));
    const offer = (client: Client, label: string, list: typeof objects) =>
      client.query<{ bucket: string; path: string; signed_url: string }>(
        "select * from public.photo_signatures_offer($1, $2::jsonb)",
        [window, JSON.stringify(list.map((o) => ({ ...o, signed_url: `https://x/${o.path}?token=${label}` })))],
      );
    const [a, b] = await Promise.all([offer(one, "one", objects), offer(two, "two", [...objects].reverse())]);
    expect(a.rows).toHaveLength(200);
    expect(b.rows).toHaveLength(200);
    const winners = new Map(a.rows.map((r) => [r.path, r.signed_url]));
    for (const r of b.rows) expect(r.signed_url, r.path).toBe(winners.get(r.path));
  }
}, 120_000);
