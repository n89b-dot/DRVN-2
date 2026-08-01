"use server";

import { revalidatePath } from "next/cache";

import { auditedAction } from "./audit";
import { getAdminContext } from "./guard";
import { refundOrder } from "@/lib/payments/refunds";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { reportError } from "@/lib/monitoring";

/**
 * Admin mutations. Every action:
 *   1. re-verifies admin membership itself (defence in depth — never trusts
 *      the layout gate alone),
 *   2. requires a non-empty reason,
 *   3. performs the mutation via the service role,
 *   4. writes the append-only audit row in the same code path (auditedAction).
 *
 * Money-touching actions route through lib/payments/refunds.ts — the one
 * correct refund path (transfer reversal, per-order idempotency, fee
 * reconciliation, recovery cases).
 */

export type AdminActionState = { ok?: string; error?: string } | null;

type Ctx = { userId: string; admin: ReturnType<typeof createAdminClient> };

async function requireAdmin(): Promise<Ctx | null> {
  const ctx = await getAdminContext();
  if (!ctx) return null;
  return { userId: ctx.userId, admin: createAdminClient() };
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

async function notifyBothParties(
  admin: ReturnType<typeof createAdminClient>,
  order: { id: string; buyer_id: string | null; seller_id: string | null },
  title: string,
  body: string
) {
  const rows = [order.buyer_id, order.seller_id]
    .filter((id): id is string => Boolean(id))
    .map((userId) => ({
      user_id: userId,
      kind: "admin_action",
      section: "marketplace" as const,
      title,
      body,
      href: `/orders/${order.id}`,
      actor_id: null,
    }));
  if (rows.length) {
    const { error } = await admin.from("notifications").insert(rows);
    if (error) reportError("[admin] notification insert failed", { orderId: order.id, error });
  }
}

function revalidateOrder(orderId: string) {
  revalidatePath("/admin", "layout");
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
}

// ---------- Refunds / disputes ----------

export async function adminForceRefund(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not found." };

  const orderId = field(formData, "order_id");
  const reason = field(formData, "reason");
  const amountRaw = field(formData, "amount");
  if (!orderId) return { error: "Missing order." };
  if (!reason) return { error: "A reason is required — it goes in the audit log." };

  // Amount arrives in major units from the form; blank means full refund.
  let amountCents: number | undefined;
  if (amountRaw) {
    const parsed = Math.round(Number(amountRaw) * 100);
    if (!Number.isFinite(parsed) || parsed <= 0) return { error: "Enter a valid amount." };
    amountCents = parsed;
  }

  try {
    const outcome = await auditedAction(
      ctx.admin,
      {
        actorId: ctx.userId,
        action: "order.force_refund",
        subjectType: "order",
        subjectId: orderId,
        orderId,
        reason,
        metadata: { amountCents: amountCents ?? "full" },
      },
      async () => {
        const result = await refundOrder(ctx.admin, {
          orderId,
          amountCents,
          reason: `Admin refund: ${reason}`,
          initiator: { kind: "admin", adminId: ctx.userId },
          resolveDispute: true,
        });
        if (!result.ok) throw new Error(result.error);
        return result;
      }
    );

    const { data: order } = await ctx.admin
      .from("orders")
      .select("id, buyer_id, seller_id, currency")
      .eq("id", orderId)
      .maybeSingle();
    if (order) {
      await notifyBothParties(
        ctx.admin,
        order,
        "DRVN support resolved this order",
        `A refund of ${formatPrice(outcome.refundedCents)} was issued by support.`
      );
    }

    revalidateOrder(orderId);
    const reversalNote = outcome.recoveryId
      ? " Transfer reversal FAILED — a recovery case was opened in Payments."
      : outcome.reversedCents > 0
        ? ` ${formatPrice(outcome.reversedCents)} reclaimed from the seller.`
        : "";
    return { ok: `Refunded ${formatPrice(outcome.refundedCents)}.${reversalNote}` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Refund failed." };
  }
}

export async function adminResolveForSeller(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not found." };

  const orderId = field(formData, "order_id");
  const reason = field(formData, "reason");
  if (!orderId) return { error: "Missing order." };
  if (!reason) return { error: "A reason is required — it goes in the audit log." };

  try {
    await auditedAction(
      ctx.admin,
      {
        actorId: ctx.userId,
        action: "dispute.resolve_for_seller",
        subjectType: "dispute",
        subjectId: orderId,
        orderId,
        reason,
      },
      async () => {
        const { data: order } = await ctx.admin
          .from("orders")
          .select("id, status, pre_dispute_status, buyer_id, seller_id")
          .eq("id", orderId)
          .maybeSingle();
        if (!order) throw new Error("Order not found.");
        if (order.status !== "disputed") throw new Error("This order isn't in dispute.");

        const { data: closed, error } = await ctx.admin
          .from("orders")
          .update({
            status: order.pre_dispute_status ?? "delivered",
            dispute_resolved_at: new Date().toISOString(),
            refund_offer_cents: null,
            refund_offered_at: null,
          })
          .eq("id", orderId)
          .eq("status", "disputed")
          .select("id");
        if (error) throw new Error(error.message);
        if (!closed?.length) throw new Error("This dispute has already been settled.");

        await notifyBothParties(
          ctx.admin,
          order,
          "DRVN support resolved this dispute",
          "The dispute was closed in the seller's favour after review."
        );
        return { restored: order.pre_dispute_status };
      }
    );
    revalidateOrder(orderId);
    return { ok: "Dispute resolved in the seller's favour." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not resolve the dispute." };
  }
}

// ---------- Listings ----------

export async function adminRemoveListing(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not found." };

  const listingId = field(formData, "listing_id");
  const reason = field(formData, "reason");
  if (!listingId) return { error: "Missing listing." };
  if (!reason) return { error: "A reason is required — it is shown to the seller." };

  try {
    await auditedAction(
      ctx.admin,
      {
        actorId: ctx.userId,
        action: "listing.remove",
        subjectType: "listing",
        subjectId: listingId,
        reason,
      },
      async () => {
        const { data: listing } = await ctx.admin
          .from("listings")
          .select("id, seller_id, title, status")
          .eq("id", listingId)
          .maybeSingle();
        if (!listing) throw new Error("Listing not found.");
        if (["reserved", "sold"].includes(listing.status)) {
          throw new Error("This listing is mid-checkout or sold — resolve the order instead.");
        }
        if (listing.status === "removed") throw new Error("Already removed.");

        const { error } = await ctx.admin
          .from("listings")
          .update({
            status: "removed",
            removed_at: new Date().toISOString(),
            removed_reason: reason,
          })
          .eq("id", listingId)
          .not("status", "in", "(reserved,sold)");
        if (error) throw new Error(error.message);

        const { error: noteError } = await ctx.admin.from("notifications").insert({
          user_id: listing.seller_id,
          kind: "listing_removed",
          section: "marketplace",
          title: "A listing was removed",
          body: `"${listing.title}" — ${reason}`,
          href: "/listings",
          actor_id: null,
        });
        if (noteError) reportError("[admin] takedown notification failed", { listingId, noteError });
        return { previousStatus: listing.status };
      }
    );
    revalidatePath("/admin", "layout");
    revalidatePath("/listings");
    revalidatePath(`/listings/${listingId}`);
    return { ok: "Listing removed from the marketplace." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Takedown failed." };
  }
}

export async function adminRestoreListing(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not found." };

  const listingId = field(formData, "listing_id");
  const reason = field(formData, "reason");
  if (!listingId) return { error: "Missing listing." };
  if (!reason) return { error: "A reason is required — it goes in the audit log." };

  try {
    await auditedAction(
      ctx.admin,
      {
        actorId: ctx.userId,
        action: "listing.restore",
        subjectType: "listing",
        subjectId: listingId,
        reason,
      },
      async () => {
        const { data: restored, error } = await ctx.admin
          .from("listings")
          .update({ status: "paused", removed_at: null, removed_reason: null })
          .eq("id", listingId)
          .eq("status", "removed")
          .select("id");
        if (error) throw new Error(error.message);
        if (!restored?.length) throw new Error("This listing isn't removed.");
        return {};
      }
    );
    revalidatePath("/admin", "layout");
    return { ok: "Listing restored (as paused — the seller republishes it)." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Restore failed." };
  }
}

// ---------- Users ----------

export async function adminSuspendUser(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not found." };

  const userId = field(formData, "user_id");
  const reason = field(formData, "reason");
  if (!userId) return { error: "Missing user." };
  if (!reason) return { error: "A reason is required — it goes in the audit log." };
  if (userId === ctx.userId) return { error: "You cannot suspend yourself." };

  try {
    await auditedAction(
      ctx.admin,
      {
        actorId: ctx.userId,
        action: "user.suspend",
        subjectType: "user",
        subjectId: userId,
        reason,
      },
      async () => {
        // Refuse to suspend another admin from the console; that's a SQL job.
        const { data: isTargetAdmin } = await ctx.admin
          .from("admin_users")
          .select("user_id")
          .eq("user_id", userId)
          .maybeSingle();
        if (isTargetAdmin) throw new Error("Admins are managed in SQL, not from the console.");

        const { data: suspended, error } = await ctx.admin
          .from("profiles")
          .update({ suspended_at: new Date().toISOString(), suspended_reason: reason })
          .eq("id", userId)
          .is("suspended_at", null)
          .select("id");
        if (error) throw new Error(error.message);
        if (!suspended?.length) throw new Error("Already suspended.");

        // Pause their live stock; record which listings, so unsuspend can
        // restore exactly this set and nothing else.
        const { data: paused } = await ctx.admin
          .from("listings")
          .update({ status: "paused" })
          .eq("seller_id", userId)
          .eq("status", "active")
          .select("id");
        return { pausedListingIds: (paused ?? []).map((l) => l.id) };
      }
    );
    revalidatePath("/admin", "layout");
    return { ok: "User suspended; their active listings were paused." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Suspension failed." };
  }
}

export async function adminUnsuspendUser(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not found." };

  const userId = field(formData, "user_id");
  const reason = field(formData, "reason");
  if (!userId) return { error: "Missing user." };
  if (!reason) return { error: "A reason is required — it goes in the audit log." };

  try {
    await auditedAction(
      ctx.admin,
      {
        actorId: ctx.userId,
        action: "user.unsuspend",
        subjectType: "user",
        subjectId: userId,
        reason,
      },
      async () => {
        const { data: cleared, error } = await ctx.admin
          .from("profiles")
          .update({ suspended_at: null, suspended_reason: null })
          .eq("id", userId)
          .not("suspended_at", "is", null)
          .select("id");
        if (error) throw new Error(error.message);
        if (!cleared?.length) throw new Error("This user isn't suspended.");

        // Reactivate exactly the set the suspension paused.
        const { data: lastSuspend } = await ctx.admin
          .from("admin_audit_log")
          .select("metadata")
          .eq("subject_type", "user")
          .eq("subject_id", userId)
          .eq("action", "user.suspend")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const meta = lastSuspend?.metadata as { result?: { pausedListingIds?: string[] } } | null;
        const pausedIds = meta?.result?.pausedListingIds ?? [];
        if (pausedIds.length) {
          await ctx.admin
            .from("listings")
            .update({ status: "active" })
            .in("id", pausedIds)
            .eq("status", "paused");
        }
        return { reactivatedListingIds: pausedIds };
      }
    );
    revalidatePath("/admin", "layout");
    return { ok: "Suspension lifted; previously paused listings reactivated." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not lift the suspension." };
  }
}

// ---------- Reports ----------

export async function adminResolveReport(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not found." };

  const reportId = field(formData, "report_id");
  const outcome = field(formData, "outcome");
  const note = field(formData, "note");
  if (!reportId) return { error: "Missing report." };
  if (!["actioned", "dismissed"].includes(outcome)) return { error: "Pick an outcome." };
  if (!note) return { error: "A note is required — it goes in the audit log." };

  try {
    await auditedAction(
      ctx.admin,
      {
        actorId: ctx.userId,
        action: `report.${outcome}`,
        subjectType: "report",
        subjectId: reportId,
        reason: note,
      },
      async () => {
        const { data: resolved, error } = await ctx.admin
          .from("reports")
          .update({
            status: outcome as "actioned" | "dismissed",
            resolved_by: ctx.userId,
            resolved_at: new Date().toISOString(),
            resolution_note: note,
          })
          .eq("id", reportId)
          .eq("status", "open")
          .select("id");
        if (error) throw new Error(error.message);
        if (!resolved?.length) throw new Error("This report is already resolved.");
        return {};
      }
    );
    revalidatePath("/admin", "layout");
    return { ok: outcome === "actioned" ? "Report actioned." : "Report dismissed." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not resolve the report." };
  }
}

// ---------- Payment recoveries ----------

export async function adminResolveRecovery(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not found." };

  const recoveryId = field(formData, "recovery_id");
  const outcome = field(formData, "outcome");
  const note = field(formData, "note");
  if (!recoveryId) return { error: "Missing recovery case." };
  if (!["recovered", "written_off"].includes(outcome)) return { error: "Pick an outcome." };
  if (!note) return { error: "A note is required — it goes in the audit log." };

  try {
    await auditedAction(
      ctx.admin,
      {
        actorId: ctx.userId,
        action: `recovery.${outcome}`,
        subjectType: "payment",
        subjectId: recoveryId,
        reason: note,
      },
      async () => {
        const { data: resolved, error } = await ctx.admin
          .from("payment_recoveries")
          .update({
            status: outcome as "recovered" | "written_off",
            resolved_by: ctx.userId,
            resolved_at: new Date().toISOString(),
            resolution_note: note,
          })
          .eq("id", recoveryId)
          .eq("status", "open")
          .select("id");
        if (error) throw new Error(error.message);
        if (!resolved?.length) throw new Error("This case is already closed.");
        return {};
      }
    );
    revalidatePath("/admin", "layout");
    return { ok: "Recovery case closed." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not close the case." };
  }
}
