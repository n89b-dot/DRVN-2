import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admin, anon } from "./environment";
import { mapBounded } from "@/lib/map-bounded";
import { expect, it } from "vitest";
import { ensureSearchCollections } from "@/lib/search/collections";
import { indexCarNow } from "@/lib/explore/search/indexing";
import { indexListingNow } from "@/lib/marketplace/search/indexing";
import { typesenseRequest, typesenseUpsert } from "@/lib/search/typesense";

it("finds matching rows beyond the API cap and counts before pagination", async () => {
  const user = await admin.auth.admin.createUser({ email: `ops-${crypto.randomUUID()}@example.test`, email_confirm: true });
  if (user.error) throw user.error;
  const uid = user.data.user.id;
  try {
    for (let offset = 0; offset < 1100; offset += 100) {
      await admin.from("listings").insert(Array.from({ length: 100 }, (_, i) => ({ seller_id: uid, title: `OpsScaleRotor ${offset + i}`, category: "engine", price_cents: offset + i + 100, status: "active", currency: "GBP" }))).throwOnError();
    }
    const first = await anon.rpc("marketplace_browse_rows", { p_query: "OpsScaleRotor" }, { count: "exact" }).select("id,price_cents,created_at").eq("seller_id", uid).gte("price_cents", 1180).order("price_cents").order("id").range(0, 9).throwOnError();
    expect(first.count).toBe(20); expect(first.data).toHaveLength(10); expect(first.data[0].price_cents).toBe(1180);
    const second = await anon.rpc("marketplace_browse_rows", { p_query: "OpsScaleRotor" }, { count: "exact" }).select("id,price_cents").eq("seller_id", uid).gte("price_cents", 1180).order("price_cents").order("id").range(10, 19).throwOnError();
    expect(new Set([...first.data, ...second.data].map(x => x.id)).size).toBe(20);
    const latencies: number[] = [];
    await mapBounded(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      const started = performance.now();
      await anon.rpc("marketplace_browse_rows", { p_query: "OpsScaleRotor" }, { count: "exact" }).select("id,price_cents").gte("price_cents", 1180).order("price_cents").range(0, 19).throwOnError();
      latencies.push(performance.now() - started);
    });
    latencies.sort((a, b) => a - b);
    console.info(JSON.stringify({ drill: "1100-listing-search", concurrency: 4, requests: 20, p50_ms: Math.round(latencies[9]), p95_ms: Math.round(latencies[18]), max_ms: Math.round(latencies[19]) }));
  } finally {
    const owned = await admin.from("listings").select("id").eq("seller_id", uid).range(0, 999).throwOnError();
    const later = await admin.from("listings").select("id").eq("seller_id", uid).range(1000, 1999).throwOnError();
    await admin.from("listings").delete().eq("seller_id", uid).throwOnError();
    const ids = [...owned.data, ...later.data].map(x => x.id);
    for (let i = 0; i < ids.length; i += 100) await admin.from("remediation_jobs").delete().eq("kind", "search").in("payload->>id", ids.slice(i, i + 100)).throwOnError();
    const deleted = await admin.auth.admin.deleteUser(uid); if (deleted.error) throw deleted.error;
  }
});

it("rebuilds actual Typesense documents and removes private and suspended content after an outage", async () => {
  process.env.TYPESENSE_URL = "http://127.0.0.1:8108";
  process.env.TYPESENSE_API_KEY = "drvn-local-isolated-test-key";
  await ensureSearchCollections(); await ensureSearchCollections();
  const user = await admin.auth.admin.createUser({ email: `ops-${crypto.randomUUID()}@example.test`, email_confirm: true });
  if (user.error) throw user.error;
  const uid = user.data.user.id;
  let carId = "", listingId = "";
  try {
    const car = await admin.from("cars").insert({ owner_id: uid, name: "Operations fixture", slug: `ops-${crypto.randomUUID()}`, is_public: true }).select("id").single().throwOnError(); carId = car.data.id;
    const listing = await admin.from("listings").insert({ seller_id: uid, title: "Operations rotor", category: "engine", price_cents: 2000, status: "active", currency: "GBP" }).select("id").single().throwOnError(); listingId = listing.data.id;
    await indexCarNow(carId); await indexListingNow(listingId);
    expect((await typesenseRequest(`/collections/drvn-cars/documents/${carId}`)).ok).toBe(true);
    await expect(indexCarNow(carId, async () => { throw new Error("expired lease"); })).rejects.toThrow("expired lease");
    process.env.TYPESENSE_URL = "http://127.0.0.1:1";
    await expect(indexCarNow(carId)).rejects.toThrow();
    await admin.from("cars").update({ is_public: false }).eq("id", carId).throwOnError();
    await admin.from("profiles").update({ suspended_at: new Date().toISOString() }).eq("id", uid).throwOnError();
    process.env.TYPESENSE_URL = "http://127.0.0.1:8108";
    await indexCarNow(carId); await indexListingNow(listingId);
    await expect(typesenseRequest(`/collections/drvn-cars/documents/${carId}`)).rejects.toThrow("404");
    await expect(typesenseRequest(`/collections/drvn-listings/documents/${listingId}`)).rejects.toThrow("404");
    const visible = await anon.from("listings").select("id").eq("id", listingId).throwOnError(); expect(visible.data).toHaveLength(0);
    const directory = mkdtempSync(join(tmpdir(), "drvn-index-"));
    const orphans = Array.from({ length: 101 }, () => crypto.randomUUID());
    try {
      await mapBounded(orphans, 4, async id => { const document = { id, name: "Orphan fixture", vehicle: "", tags: [], about: "", mods: "", created_at_unix: 0 }; await typesenseUpsert("drvn-cars", document); });
      const env = { ...process.env, DRVN_SEARCH_PROJECT_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, DRVN_SEARCH_ENGINE_URL: process.env.TYPESENSE_URL };
      const run = (mode: string) => execFileSync(process.execPath, ["scripts/reconcile-search.mjs", mode, directory], { env, stdio: "pipe" });
      run("inventory"); run("apply");
      const first = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
      expect(first.collections.find((entry: { entity: string }) => entry.entity === "car").cursor).toBe(100);
      run("apply");
      const second = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
      expect(second.collections.every((entry: { completed: boolean }) => entry.completed)).toBe(true);
      for (let offset = 0; offset < orphans.length; offset += 100) {
        const ids = orphans.slice(offset, offset + 100);
        const queued = await admin.from("remediation_jobs").select("id").eq("kind", "search").in("payload->>id", ids).throwOnError(); expect(queued.data).toHaveLength(ids.length);
        await mapBounded(ids, 4, id => indexCarNow(id));
        await admin.from("remediation_jobs").delete().eq("kind", "search").in("payload->>id", ids).throwOnError();
      }
      await expect(typesenseRequest(`/collections/drvn-cars/documents/${orphans[100]}`)).rejects.toThrow("404");
    } finally { rmSync(directory, { recursive: true, force: true }); }

  } finally {
    process.env.TYPESENSE_URL = "http://127.0.0.1:8108";
    const owned = await admin.from("listings").select("id").eq("seller_id", uid).range(0, 999).throwOnError();
    const later = await admin.from("listings").select("id").eq("seller_id", uid).range(1000, 1999).throwOnError();
    await admin.from("listings").delete().eq("seller_id", uid).throwOnError();
    const ids = [...owned.data, ...later.data].map(x => x.id);
    for (let i = 0; i < ids.length; i += 100) await admin.from("remediation_jobs").delete().eq("kind", "search").in("payload->>id", ids.slice(i, i + 100)).throwOnError();
    await admin.from("cars").delete().eq("owner_id", uid).throwOnError();
    if (carId) await indexCarNow(carId); if (listingId) await indexListingNow(listingId);
    const deleted = await admin.auth.admin.deleteUser(uid); if (deleted.error) throw deleted.error;
  }
});
