import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";

import type { Database } from "@/lib/database.types";
import { admin } from "./environment";

const CONCURRENCY = 8;

type PurchaseResult = { orders?: { order_id?: string }[]; skipped?: unknown[] };
type PurchaseArgs = Database["public"]["Functions"]["purchase_begin"]["Args"];

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return Number((sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0).toFixed(2));
}

async function timedPurchase(args: PurchaseArgs) {
  const started = performance.now();
  const response = await admin.rpc("purchase_begin", args);
  return { ...response, latencyMs: performance.now() - started };
}

it("bounds local checkout contention to one reservation and replays one request exactly", async () => {
  const userIds: string[] = [];
  const invitationIds: string[] = [];
  const orderIds: string[] = [];
  const stamp = crypto.randomUUID();
  try {
    for (let index = 0; index <= CONCURRENCY; index += 1) {
      const role = index === 0 ? "seller" : "buyer";
      const email = `commerce-load-${role}-${index}-${stamp}@drvn.test`;
      const created = await admin.auth.admin.createUser({ email, email_confirm: true });
      if (created.error || !created.data.user) throw created.error ?? new Error("Missing commerce rehearsal user");
      userIds.push(created.data.user.id);
      const invitation = await admin.from("beta_invitations").insert({
        email_normalized: email,
        roles: [role],
        token_hash: createHash("sha256").update(`${stamp}:${index}`).digest("hex"),
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        consumed_at: new Date().toISOString(),
        consumed_by: created.data.user.id,
      }).select("id").single().throwOnError();
      invitationIds.push(invitation.data.id);
      await admin.from("beta_memberships").insert({
        user_id: created.data.user.id,
        invitation_id: invitation.data.id,
        email_normalized: email,
        roles: [role],
      }).throwOnError();
    }

    const listings = await admin.from("listings").insert([
      { seller_id: userIds[0], title: "Local exact replay fixture", category: "engine", price_cents: 12500, shipping_cents: 0, currency: "USD", status: "active" },
      { seller_id: userIds[0], title: "Local buyer contention fixture", category: "engine", price_cents: 12500, shipping_cents: 0, currency: "USD", status: "active" },
    ]).select("id").throwOnError();
    const [replayListing, contentionListing] = listings.data;
    const checkoutContext = {
      version: 1,
      shipping: { name: "Local Buyer", line1: "1 Test Street", city: "Detroit", postcode: "48201", country: "US", isCollection: false },
      destinationHash: "local-rehearsal-destination",
      quoteIds: {},
    };
    const sharedArgs = {
      p_buyer_id: userIds[1],
      p_listing_ids: [replayListing.id],
      p_idempotency_key: `local-commerce-replay:${stamp}`,
      p_checkout_request_key: `local-commerce-browser:${stamp}`,
      p_shipping_overrides: {},
      p_checkout_context: checkoutContext,
    };

    const exact = await Promise.all(Array.from({ length: CONCURRENCY }, () => timedPurchase(sharedArgs)));
    expect(exact.every(result => !result.error)).toBe(true);
    const exactPayloads = exact.map(result => JSON.stringify(result.data));
    expect(new Set(exactPayloads)).toHaveLength(1);
    const exactResult = exact[0].data as PurchaseResult;
    expect(exactResult.orders).toHaveLength(1);

    const competing = await Promise.all(userIds.slice(1).map((buyerId, index) => timedPurchase({
      p_buyer_id: buyerId,
      p_listing_ids: [contentionListing.id],
      p_idempotency_key: `local-commerce-contender:${index}:${stamp}`,
      p_checkout_request_key: `local-commerce-contender-browser:${index}:${stamp}`,
      p_shipping_overrides: {},
      p_checkout_context: checkoutContext,
    })));
    expect(competing.every(result => !result.error)).toBe(true);
    const winners = competing.filter(result => ((result.data as PurchaseResult).orders?.length ?? 0) === 1);
    expect(winners).toHaveLength(1);
    expect(competing.filter(result => ((result.data as PurchaseResult).skipped?.length ?? 0) === 1)).toHaveLength(CONCURRENCY - 1);

    const itemRows = await admin.from("order_items").select("order_id,listing_id").in("listing_id", [replayListing.id, contentionListing.id]).throwOnError();
    expect(itemRows.data.filter(row => row.listing_id === replayListing.id)).toHaveLength(1);
    expect(itemRows.data.filter(row => row.listing_id === contentionListing.id)).toHaveLength(1);
    expect(new Set(itemRows.data.map(row => row.order_id))).toHaveLength(2);
    orderIds.push(...new Set(itemRows.data.map(row => row.order_id)));

    const report = {
      scope: "isolated local purchase_begin admission and replay; excludes provider calls, hosted capacity, payment settlement, and checkout UI",
      concurrency: CONCURRENCY,
      exactReplay: {
        requests: exact.length,
        errors: exact.filter(result => result.error).length,
        distinctResults: new Set(exactPayloads).size,
        persistedOrders: 1,
        p50Ms: percentile(exact.map(result => result.latencyMs), 0.5),
        p95Ms: percentile(exact.map(result => result.latencyMs), 0.95),
      },
      competingBuyers: {
        requests: competing.length,
        errors: competing.filter(result => result.error).length,
        winners: winners.length,
        skipped: CONCURRENCY - winners.length,
        persistedOrders: 1,
        p50Ms: percentile(competing.map(result => result.latencyMs), 0.5),
        p95Ms: percentile(competing.map(result => result.latencyMs), 0.95),
      },
    };
    if (process.env.DRVN_COMMERCE_REPORT) {
      writeFileSync(process.env.DRVN_COMMERCE_REPORT, JSON.stringify({ observedAt: new Date().toISOString(), ...report }, null, 2) + "\n");
    }
  } finally {
    if (userIds.length > 1) {
      const discovered = await admin.from("orders").select("id").in("buyer_id", userIds.slice(1)).throwOnError();
      orderIds.push(...discovered.data.map(row => row.id));
    }
    const uniqueOrderIds = [...new Set(orderIds)];
    if (uniqueOrderIds.length) {
      await admin.from("orders").delete().in("id", uniqueOrderIds).throwOnError();
    }
    for (const userId of userIds.reverse()) {
      const deleted = await admin.auth.admin.deleteUser(userId);
      if (deleted.error) throw deleted.error;
    }
    if (invitationIds.length) {
      await admin.from("beta_invitations").delete().in("id", invitationIds).throwOnError();
    }
  }
}, 60_000);
