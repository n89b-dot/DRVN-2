import { admin, anon } from "./environment";
import { mapBounded } from "@/lib/map-bounded";
import { expect, it } from "vitest";

// marketplace_browse_rows searched once per part for sale when PostgREST
// passed the words (as a column of a joined row, not a literal): at 1,100
// matching parts the signed-out 3-second limit cancelled it. Migration
// 20261017145500 answers a search from the ids the words found, once; this
// asks the old function through the API the way the app used to
// (supabase/tests/browse_rows_search_once_guard.sql counts the runs).
it("searches through marketplace_browse_rows over the API within the signed-out time limit", async () => {
  const user = await admin.auth.admin.createUser({ email: `ops-${crypto.randomUUID()}@example.test`, email_confirm: true });
  if (user.error) throw user.error;
  const uid = user.data.user.id;
  try {
    for (let offset = 0; offset < 1100; offset += 100) {
      await admin.from("listings").insert(Array.from({ length: 100 }, (_, i) => ({ seller_id: uid, title: `OpsBrowseRotor ${offset + i}`, category: "engine", price_cents: offset + i + 100, status: "active", currency: "USD" }))).throwOnError();
    }
    const first = await anon.rpc("marketplace_browse_rows", { p_query: "OpsBrowseRotor" }, { count: "exact" }).select("id,price_cents").eq("seller_id", uid).gte("price_cents", 1180).order("price_cents").order("id").range(0, 9).throwOnError();
    expect(first.count).toBe(20); expect(first.data).toHaveLength(10); expect(first.data[0].price_cents).toBe(1180);
    const second = await anon.rpc("marketplace_browse_rows", { p_query: "OpsBrowseRotor" }, { count: "exact" }).select("id,price_cents").eq("seller_id", uid).gte("price_cents", 1180).order("price_cents").order("id").range(10, 19).throwOnError();
    expect(new Set([...first.data, ...second.data].map(x => x.id)).size).toBe(20);
    // The same arguments as the search entry point, the same parts.
    const entry = await anon.rpc("marketplace_search_browse_rows", { p_query: "OpsBrowseRotor" }, { count: "exact" }).select("id").eq("seller_id", uid).range(0, 0).throwOnError();
    const all = await anon.rpc("marketplace_browse_rows", { p_query: "OpsBrowseRotor" }, { count: "exact" }).select("id").eq("seller_id", uid).range(0, 0).throwOnError();
    expect(all.count).toBe(1100); expect(entry.count).toBe(1100);
    // The whole match, every request, as the saved-search worker and the
    // offset fallback ask it: an exact count, the words as a parameter.
    const latencies: number[] = [];
    await mapBounded(Array.from({ length: 12 }, (_, i) => i), 4, async () => {
      const started = performance.now();
      await anon.rpc("marketplace_browse_rows", { p_query: "OpsBrowseRotor", p_vehicle: "", p_vyear: 0, p_ymin: 0, p_ymax: 9999, p_fit: false }, { count: "exact" }).select("id,price_cents").order("price_cents").range(0, 19).throwOnError();
      latencies.push(performance.now() - started);
    });
    latencies.sort((a, b) => a - b);
    console.info(JSON.stringify({ drill: "1100-listing-browse-search", concurrency: 4, requests: 12, p50_ms: Math.round(latencies[5]), max_ms: Math.round(latencies[11]) }));
  } finally {
    const owned = await admin.from("listings").select("id").eq("seller_id", uid).range(0, 999).throwOnError();
    const later = await admin.from("listings").select("id").eq("seller_id", uid).range(1000, 1999).throwOnError();
    await admin.from("listings").delete().eq("seller_id", uid).throwOnError();
    const ids = [...owned.data, ...later.data].map(x => x.id);
    for (let i = 0; i < ids.length; i += 100) await admin.from("remediation_jobs").delete().eq("kind", "search").in("payload->>id", ids.slice(i, i + 100)).throwOnError();
    const deleted = await admin.auth.admin.deleteUser(uid); if (deleted.error) throw deleted.error;
  }
});
