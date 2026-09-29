"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { reportError } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { postOrderEvent } from "./order-thread";
import { readCommercialSnapshot } from "./snapshot";
import { RETURN_SHIP_DAYS } from "./returns";
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
  void _prev;
  void _formData;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const betaAccess = await getBetaAccess(user.id, "seller");
  if (!betaAccess.eligible) return { error: betaCommerceError("seller") };

  const { data, error } = await supabase.rpc("become_shop");
  const result = data as { ok?: boolean; applied?: boolean; repaired?: boolean } | null;
  if (error || !result?.ok) {
    reportError("[shop] conversion failed", { userId: user.id, error });
    return { error: "Couldn't switch this account to a shop. Try again." };
  }

  revalidatePath("/settings");
  if (!result.applied && !result.repaired) return { ok: "You're already set up as a shop." };
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

  const { data, error: createError } = await admin.rpc("create_shop_policy_return", {
    p_order: orderId,
    p_buyer: user.id,
    p_reason: reason || undefined,
  });
  const result = data as { ok?: boolean; return_id?: string; replayed?: boolean } | null;
  if (createError || !result?.ok || !result.return_id) {
    reportError("[shop-return] request failed", { orderId, createError });
    return { error: "Couldn't open the return. Try again." };
  }

  if (!result.replayed) {
    await postOrderEvent(
      admin,
      orderId,
      user.id,
      "Requested a return under the shop's return policy."
    );
  }
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
  const { data, error } = await admin.rpc("respond_shop_policy_return", {
    p_return: returnId,
    p_seller: user.id,
    p_decision: verb,
    p_ship_days: RETURN_SHIP_DAYS,
  });
  const result = data as { ok?: boolean; order_id?: string; replayed?: boolean; reason?: string } | null;
  if (error || !result) {
    reportError("[shop-return] response failed", { returnId, error });
    return { error: "Couldn't update — refresh and try again." };
  }
  if (!result.ok || !result.order_id) return { error: result.reason ?? "This return has already been handled." };
  if (!result.replayed) {
    await postOrderEvent(
      admin,
      result.order_id,
      user.id,
      verb === "approve"
        ? `Return approved — ship it back (tracked) within ${RETURN_SHIP_DAYS} days.`
        : "Return request declined."
    );
  }
  revalidatePath(`/orders/${result.order_id}`);
  return {
    ok: verb === "approve"
      ? "Return approved — the buyer ships it back next."
      : "Return declined.",
  };
}
