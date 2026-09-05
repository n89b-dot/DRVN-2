"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { reportError } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { postOrderThreadMessage } from "./order-thread";
import { readCommercialSnapshot } from "./snapshot";
import { RETURN_SHIP_DAYS, returnEntitlementCents } from "./returns";
import { betaCommerceError, getBetaAccess } from "@/lib/beta-access";

/**
 * Shop profiles + shop-policy returns (brief §34-§37, migration 0056).
 *
 * Conversion is a controlled server path: profiles.profile_type is guarded
 * from self-escalation (0017), so becoming a shop happens here on the
 * service role — same account, shop features switched on. Verification is a
 * separate, admin-granted state; nothing here can set it.
 *
 * Shop-policy returns (§24B/§26): judged against the policy FROZEN IN THE
 * PURCHASE SNAPSHOT — a shop tightening its policy tomorrow cannot strip a
 * right yesterday's buyer bought with. Buyer-responsibility: original
 * shipping stays with the seller and the buyer arranges tracked postage.
 */

export type ShopState = { error?: string; ok?: string };

const ALLOWED_WINDOWS = new Set([14, 30, 60]);

export async function becomeShop(_prev: ShopState, _formData: FormData): Promise<ShopState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const betaAccess = await getBetaAccess(user.id, "seller");
  if (!betaAccess.eligible) return { error: betaCommerceError("seller") };

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("profile_type")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return { error: "Profile not found." };
  if (profile.profile_type === "shop") return { ok: "You're already set up as a shop." };

  const { error: typeError } = await admin
    .from("profiles")
    .update({ profile_type: "shop" })
    .eq("id", user.id);
  if (typeError) {
    reportError("[shop] conversion failed", { userId: user.id, typeError });
    return { error: "Couldn't switch this account to a shop. Try again." };
  }
  const { error: shopError } = await admin
    .from("shop_profiles")
    .upsert({ profile_id: user.id }, { onConflict: "profile_id" });
  if (shopError) {
    reportError("[shop] shop row failed", { userId: user.id, shopError });
  }

  revalidatePath("/settings");
  return {
    ok: "You're selling as a shop now. Verification is a separate review DRVN grants — self-declaring never shows a verified badge.",
  };
}

export async function updateShopReturnPolicy(
  _prev: ShopState,
  formData: FormData
): Promise<ShopState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const accepted = formData.get("returns_accepted") === "on";
  const windowDays = Number(String(formData.get("return_window_days") ?? "30"));
  if (!ALLOWED_WINDOWS.has(windowDays)) return { error: "Pick one of the offered windows." };

  const admin = createAdminClient();
  const { data: shop } = await admin
    .from("shop_profiles")
    .select("profile_id")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!shop) return { error: "Set the account up as a shop first." };

  const { error } = await admin
    .from("shop_profiles")
    .update({ returns_accepted: accepted, return_window_days: windowDays })
    .eq("profile_id", user.id);
  if (error) {
    reportError("[shop] policy update failed", { userId: user.id, error });
    return { error: "Couldn't save the policy. Try again." };
  }

  revalidatePath("/settings");
  return {
    ok: accepted
      ? `Returns accepted within ${windowDays} days. Sales from before this change keep the policy they were bought under.`
      : "Preference returns switched off. Existing orders keep the policy they were bought under; DRVN Protection always applies.",
  };
}

/**
 * Buyer: request a preference return under the shop policy frozen in the
 * purchase snapshot (§24B). Creates a `requested` RMA the shop approves or
 * rejects; postage responsibility is the buyer's.
 */
export async function requestShopReturn(
  _prev: ShopState,
  formData: FormData
): Promise<ShopState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const orderId = String(formData.get("order_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 1000);
  if (!orderId) return { error: "Missing order." };

  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("id, buyer_id, status, delivered_at")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.buyer_id !== user.id) return { error: "Not your order." };
  if (!["delivered", "completed"].includes(order.status) || !order.delivered_at) {
    return { error: "Preference returns start once the order has been delivered." };
  }

  const { data: items } = await admin
    .from("order_items")
    .select("id, price_cents, shipping_cents, commercial_snapshot")
    .eq("order_id", orderId);
  if (!items?.length) return { error: "No items on this order." };

  // The FROZEN policy decides (§37) — never the shop's current setting.
  const snapshot = readCommercialSnapshot(items[0].commercial_snapshot);
  const policy = snapshot?.commercial.returnPolicy;
  if (!policy?.returnsAccepted) {
    return {
      error:
        "This seller doesn't take preference returns. If something's wrong with the part, report a problem instead — DRVN Protection covers that.",
    };
  }
  const deadline = new Date(order.delivered_at).getTime() + policy.windowDays * 86_400_000;
  if (Date.now() > deadline) {
    return {
      error: `The ${policy.windowDays}-day return window on this order closed on ${new Date(deadline).toLocaleDateString()}.`,
    };
  }

  const { data: ret, error: insertError } = await admin
    .from("returns")
    .insert({
      order_id: orderId,
      requested_by: user.id,
      return_type: "shop_policy",
      reason: reason || "Preference return within the shop's window",
      responsibility: "buyer",
      status: "requested",
      // Item value only — the buyer keeps paying the original outbound
      // shipping and their own return postage (§26).
      refund_amount_cents: returnEntitlementCents(items, { includeShipping: false }),
    })
    .select("id")
    .single();
  if (insertError || !ret) {
    reportError("[shop-return] request failed", { orderId, insertError });
    return { error: "Couldn't open the return. Try again." };
  }
  const { error: itemsError } = await admin
    .from("return_items")
    .insert(items.map((item) => ({ return_id: ret.id, order_item_id: item.id, reason })));
  if (itemsError) {
    await admin.from("returns").delete().eq("id", ret.id);
    if (itemsError.code === "42501") {
      return { error: "This order already has an active return." };
    }
    reportError("[shop-return] items failed", { returnId: ret.id, itemsError });
    return { error: "Couldn't open the return. Try again." };
  }

  await postOrderThreadMessage(
    admin,
    orderId,
    user.id,
    "Requested a return under the shop's return policy."
  );
  revalidatePath(`/orders/${orderId}`);
  return { ok: "Return requested — the shop reviews it next." };
}

/** Shop: approve a requested preference return — the ship-by clock starts. */
export async function approveShopReturn(
  _prev: ShopState,
  formData: FormData
): Promise<ShopState> {
  return respondToShopReturn(formData, "approve");
}

/** Shop: decline a requested preference return (policy edge cases — a part
 *  bought outside the window can't reach here; escalation stays available). */
export async function rejectShopReturn(
  _prev: ShopState,
  formData: FormData
): Promise<ShopState> {
  return respondToShopReturn(formData, "reject");
}

async function respondToShopReturn(
  formData: FormData,
  verb: "approve" | "reject"
): Promise<ShopState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const returnId = String(formData.get("return_id") ?? "");
  if (!returnId) return { error: "Missing return." };

  const admin = createAdminClient();
  const { data: ret } = await admin.from("returns").select("*").eq("id", returnId).maybeSingle();
  if (!ret) return { error: "Return not found." };
  const { data: order } = await admin
    .from("orders")
    .select("id, seller_id")
    .eq("id", ret.order_id)
    .maybeSingle();
  if (!order || order.seller_id !== user.id) return { error: "Not your order." };
  if (ret.status !== "requested") return { error: "This return has already been handled." };

  if (verb === "reject") {
    const { data: updated } = await admin
      .from("returns")
      .update({ status: "rejected" })
      .eq("id", returnId)
      .eq("status", "requested")
      .select("id");
    if (!updated?.length) return { error: "Couldn't update — refresh and try again." };
    await postOrderThreadMessage(admin, order.id, user.id, "Return request declined.");
    revalidatePath(`/orders/${order.id}`);
    return { ok: "Return declined." };
  }

  const now = Date.now();
  const { data: approved } = await admin
    .from("returns")
    .update({
      status: "approved",
      approved_at: new Date(now).toISOString(),
      ship_by: new Date(now + RETURN_SHIP_DAYS * 86_400_000).toISOString(),
    })
    .eq("id", returnId)
    .eq("status", "requested")
    .select("id");
  if (!approved?.length) return { error: "Couldn't update — refresh and try again." };
  // approved → awaiting_shipment: the buyer's move starts immediately.
  await admin
    .from("returns")
    .update({ status: "awaiting_shipment" })
    .eq("id", returnId)
    .eq("status", "approved");

  await postOrderThreadMessage(
    admin,
    order.id,
    user.id,
    `Return approved — ship it back (tracked) within ${RETURN_SHIP_DAYS} days.`
  );
  revalidatePath(`/orders/${order.id}`);
  return { ok: "Return approved — the buyer ships it back next." };
}
