"use server";

import { createHash, randomBytes, randomInt } from "node:crypto";

import QRCode from "qrcode";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { capture } from "@/lib/analytics";
import { reportError } from "@/lib/monitoring";
import { siteUrl } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { postOrderThreadMessage } from "./order-thread";

/**
 * Local pickup confirmation (brief §20-21, migration 0054).
 *
 * The pass is minted on demand and rotates on every show: plaintext exists
 * only in the buyer's current view, the database holds salted hashes, and
 * pickup_redeem() burns a pass atomically (single-use, 10-attempt lockout,
 * 1-hour TTL). The QR carries a random token inside a seller-side redeem
 * URL — never a bare order id.
 */

const PASS_TTL_MS = 60 * 60_000;

export type PickupState = { error?: string; ok?: string };
export type PickupPassState = {
  error?: string;
  code?: string;
  qrDataUrl?: string;
  expiresAt?: string;
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}


/** Seller: the part is boxed and waiting — buyer gets their pass. */
export async function markReadyForPickup(
  _prev: PickupState,
  formData: FormData
): Promise<PickupState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const orderId = String(formData.get("order_id") ?? "");
  if (!orderId) return { error: "Missing order." };

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("orders")
    .update({ pickup_ready_at: new Date().toISOString() })
    .eq("id", orderId)
    .eq("seller_id", user.id)
    .eq("status", "paid")
    .eq("is_collection", true)
    .is("pickup_ready_at", null)
    .select("id");
  if (error) {
    reportError("[pickup] mark ready failed", { orderId, error });
    return { error: "Couldn't mark this ready. Try again." };
  }
  if (!updated?.length) return { error: "This order can't be marked ready for pickup." };

  await postOrderThreadMessage(
    admin,
    orderId,
    user.id,
    "Ready for pickup — open the order to show your Pickup Pass at handoff."
  );
  capture(user.id, { event: "seller_dispatched" });
  revalidatePath(`/orders/${orderId}`);
  return { ok: "Marked ready — the buyer can now show their Pickup Pass." };
}

/** Buyer: mint (rotate) the pass and hand its plaintext back for display. */
export async function showPickupPass(
  _prev: PickupPassState,
  formData: FormData
): Promise<PickupPassState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const orderId = String(formData.get("order_id") ?? "");
  if (!orderId) return { error: "Missing order." };

  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("id, buyer_id, status, is_collection, pickup_ready_at")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.buyer_id !== user.id) return { error: "Not your order." };
  if (!order.is_collection || order.status !== "paid" || !order.pickup_ready_at) {
    return { error: "The pass appears once the seller marks the order ready." };
  }

  // A redeemed pass is done — never re-mintable.
  const { data: existing } = await admin
    .from("pickup_confirmations")
    .select("redeemed_at")
    .eq("order_id", orderId)
    .maybeSingle();
  if (existing?.redeemed_at) return { error: "This pickup was already confirmed." };

  const token = randomBytes(24).toString("hex");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + PASS_TTL_MS).toISOString();

  const { error } = await admin.from("pickup_confirmations").upsert(
    {
      order_id: orderId,
      token_hash: sha256(token),
      code_hash: sha256(`${orderId}:${code}`),
      attempts: 0,
      expires_at: expiresAt,
      redeemed_at: null,
      redeemed_by: null,
    },
    { onConflict: "order_id" }
  );
  if (error) {
    reportError("[pickup] pass mint failed", { orderId, error });
    return { error: "Couldn't create the pass. Try again." };
  }

  const redeemUrl = `${siteUrl()}/orders/${orderId}/pickup?token=${token}`;
  let qrDataUrl: string;
  try {
    qrDataUrl = await QRCode.toDataURL(redeemUrl, { margin: 1, width: 320 });
  } catch (qrError) {
    reportError("[pickup] QR render failed", { orderId, qrError });
    return { error: "Couldn't render the QR — use the six-digit code instead.", code };
  }

  return { code, qrDataUrl, expiresAt };
}

/** Seller: burn the pass — by scanned token or typed six-digit code. */
export async function redeemPickup(
  _prev: PickupState,
  formData: FormData
): Promise<PickupState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const orderId = String(formData.get("order_id") ?? "");
  const token = String(formData.get("token") ?? "").trim();
  const code = String(formData.get("code") ?? "").replace(/\D/g, "");
  if (!orderId) return { error: "Missing order." };
  if (!token && code.length !== 6) {
    return { error: "Enter the buyer's six-digit code (or scan their QR)." };
  }

  const hash = token ? sha256(token) : sha256(`${orderId}:${code}`);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("pickup_redeem", {
    p_order_id: orderId,
    p_seller_id: user.id,
    p_hash: hash,
  });
  if (error) {
    reportError("[pickup] redeem rpc failed", { orderId, error });
    return { error: "Couldn't confirm the pickup. Try again." };
  }

  const result = data as { ok: boolean; reason?: string };
  if (!result.ok) {
    const messages: Record<string, string> = {
      not_your_order: "That isn't your order.",
      not_pickup: "This order isn't a local pickup.",
      not_redeemable: "This order isn't waiting for a handoff.",
      no_pass: "The buyer hasn't opened their Pickup Pass yet — ask them to show it.",
      already_redeemed: "This pickup was already confirmed.",
      expired: "That pass expired — ask the buyer to reopen it for a fresh one.",
      locked: "Too many wrong codes — ask the buyer to reopen their pass.",
      mismatch: "That code doesn't match — check the digits and try again.",
    };
    return { error: messages[result.reason ?? ""] ?? "Couldn't confirm the pickup." };
  }

  await postOrderThreadMessage(admin, orderId, user.id, "Pickup confirmed — handoff complete.");
  capture(user.id, { event: "pickup_confirmed" });
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  return { ok: "Handoff confirmed — the order is delivered and payout clearing has started." };
}
