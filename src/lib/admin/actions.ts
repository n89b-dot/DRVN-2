"use server";

import { randomUUID } from "node:crypto";

import type Stripe from "stripe";

import { revalidatePath } from "next/cache";

import { auditedAction } from "./audit";
import { sendAdminAlert } from "./alerts";
import { processDisputeSla } from "@/lib/payments/dispute-sla";
import { dispatchStripeEvent } from "@/lib/payments/settlement";
import { processDueTransfers } from "@/lib/payments/transfer-worker";
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

export type AdminActionState =
  | {
      ok?: string;
      error?: string;
      /** Partial-failure detail for bulk actions — populated alongside `ok`
       *  so the dialog can render per-id failures instead of a single count. */
      results?: { done: number; failed: { id: string; error: string }[] };
    }
  | null;

type Ctx = { userId: string; admin: ReturnType<typeof createAdminClient> };

/**
 * Mutation gate: full admins only. Viewers (0023 read-only role) pass the
 * layout's read gate but every action refuses them here with an explicit
 * message — not a 404, because they legitimately know the console exists.
 */
async function requireAdmin(): Promise<Ctx | { error: string } | null> {
  const ctx = await getAdminContext();
  if (!ctx) return null;
  if (ctx.role !== "admin") {
    return { error: "Read-only access — this console login can look, not act." };
  }
  return { userId: ctx.userId, admin: createAdminClient() };
}

function isCtx(v: Ctx | { error: string } | null): v is Ctx {
  return Boolean(v && "admin" in v);
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
  if (!isCtx(ctx)) return ctx;

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
  if (!isCtx(ctx)) return ctx;

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
            dispute_outcome: "admin_resolved",
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
  if (!isCtx(ctx)) return ctx;

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
  if (!isCtx(ctx)) return ctx;

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
  if (!isCtx(ctx)) return ctx;

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
  if (!isCtx(ctx)) return ctx;

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
  if (!isCtx(ctx)) return ctx;

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

// ---------- Transfer worker ----------

/**
 * Manual run of the transfer worker — the dev path (pg_net can't reach
 * localhost) and the human retry for stuck funds. Same code the scheduled
 * job invokes via /api/jobs/transfers.
 */
export async function adminRunTransferWorker(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not found." };
  if (!isCtx(ctx)) return ctx;

  const reason = field(formData, "reason");
  if (!reason) return { error: "A reason is required — it goes in the audit log." };

  try {
    const summary = await auditedAction(
      ctx.admin,
      {
        actorId: ctx.userId,
        action: "payments.run_transfer_worker",
        subjectType: "payment",
        subjectId: randomUUID(),
        reason,
      },
      async () => {
        const transfers = await processDueTransfers(ctx.admin);
        const disputes = await processDisputeSla(ctx.admin);
        return { ...transfers, ...disputes };
      }
    );
    revalidatePath("/admin", "layout");
    return {
      ok: `Worker ran: ${summary.transferred} transferred, ${summary.blocked} blocked, ${summary.failed} failed, ${summary.cancelled} cancelled, ${summary.requeued} requeued; ${summary.autoRefunded} dispute${summary.autoRefunded === 1 ? "" : "s"} auto-refunded.`,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Worker run failed." };
  }
}

// ---------- Payment recoveries ----------

export async function adminResolveRecovery(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not found." };
  if (!isCtx(ctx)) return ctx;

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

// ---------- Internal notes / party messaging (console audit follow-ups) ----------

/**
 * An internal note IS an audit entry — same append-only table, action
 * `note.internal`, mutation a no-op. It shows up in the subject's admin
 * history and the audit page with zero extra machinery, and inherits the
 * same immutability guarantees as every other admin action.
 */
export async function adminAddNote(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not found." };
  if (!isCtx(ctx)) return ctx;

  const subjectType = field(formData, "subject_type");
  const subjectId = field(formData, "subject_id");
  const orderId = field(formData, "order_id");
  const note = field(formData, "reason");
  if (!["order", "user"].includes(subjectType)) return { error: "Bad subject." };
  if (!subjectId) return { error: "Missing subject." };
  if (!note) return { error: "Write the note first." };

  try {
    await auditedAction(
      ctx.admin,
      {
        actorId: ctx.userId,
        action: "note.internal",
        subjectType: subjectType as "order" | "user",
        subjectId,
        orderId: orderId || undefined,
        reason: note,
      },
      async () => ({})
    );
    revalidatePath("/admin", "layout");
    return { ok: "Note recorded." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not record the note." };
  }
}

/**
 * Message both parties on an order. Deliberately notifications, not the order
 * thread: the thread is the buyer↔seller channel (1:1 rows), and support
 * words do not belong in their mouths. Both parties get the same text,
 * attributed to DRVN support, and the full text lands in the audit log.
 */
export async function adminMessageParties(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not found." };
  if (!isCtx(ctx)) return ctx;

  const orderId = field(formData, "order_id");
  const message = field(formData, "reason");
  if (!orderId) return { error: "Missing order." };
  if (!message) return { error: "Write the message first." };

  try {
    await auditedAction(
      ctx.admin,
      {
        actorId: ctx.userId,
        action: "order.message_parties",
        subjectType: "order",
        subjectId: orderId,
        orderId,
        reason: message,
      },
      async () => {
        const { data: order } = await ctx.admin
          .from("orders")
          .select("id, buyer_id, seller_id")
          .eq("id", orderId)
          .maybeSingle();
        if (!order) throw new Error("Order not found.");
        await notifyBothParties(ctx.admin, order, "A message from DRVN support", message);
        return { recipients: [order.buyer_id, order.seller_id].filter(Boolean).length };
      }
    );
    revalidateOrder(orderId);
    return { ok: "Message sent to both parties." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not send the message." };
  }
}

// ---------- Bulk report resolution ----------

/**
 * Resolve every report in the submitted id set (an explicit selection made
 * by the admin — checkboxes + select-all-on-page, never an implicit "every
 * report shown") with one outcome and note. One audit row per report, same
 * as resolving them one by one; capped at 50 ids. Every id is validated
 * independently — a bad or already-resolved id is skipped and reported, not
 * an abort of the whole batch.
 */
export async function adminResolveReports(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not found." };
  if (!isCtx(ctx)) return ctx;

  const ids = field(formData, "report_ids").split(",").map((x) => x.trim()).filter(Boolean);
  const outcome = field(formData, "outcome");
  const note = field(formData, "note");
  if (!ids.length) return { error: "No reports selected." };
  if (ids.length > 50) return { error: "50 at a time, tops." };
  if (!["actioned", "dismissed"].includes(outcome)) return { error: "Pick an outcome." };
  if (!note) return { error: "A note is required — it goes in the audit log." };

  let done = 0;
  const failed: { id: string; error: string }[] = [];
  for (const reportId of ids) {
    try {
      await auditedAction(
        ctx.admin,
        {
          actorId: ctx.userId,
          action: `report.${outcome}`,
          subjectType: "report",
          subjectId: reportId,
          reason: `${note} (bulk: ${ids.length} selected)`,
        },
        async () => {
          const { data: updated, error } = await ctx.admin
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
          if (!updated?.length) throw new Error("Already resolved.");
          return {};
        }
      );
      done += 1;
    } catch (error) {
      failed.push({ id: reportId, error: error instanceof Error ? error.message : "Failed." });
    }
  }
  revalidatePath("/admin", "layout");
  return {
    ok: `${done} report${done === 1 ? "" : "s"} ${outcome}${failed.length ? `; ${failed.length} failed` : ""}.`,
    results: { done, failed },
  };
}

// ---------- Webhook replay ----------

/**
 * Re-run a recorded Stripe event through the same idempotent handlers the
 * live webhook uses (dispatchStripeEvent). For investigations where an event
 * half-applied — replaying an already-applied event is a no-op by design.
 * Events recorded before payload retention (0023) cannot be replayed.
 */
export async function adminReplayWebhookEvent(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not found." };
  if (!isCtx(ctx)) return ctx;

  const eventId = field(formData, "event_id");
  const reason = field(formData, "reason");
  if (!eventId) return { error: "Missing event." };
  if (!reason) return { error: "A reason is required — it goes in the audit log." };

  try {
    const outcome = await auditedAction(
      ctx.admin,
      {
        actorId: ctx.userId,
        action: "payments.replay_webhook",
        subjectType: "payment",
        subjectId: randomUUID(),
        reason: `${reason} (event ${eventId})`,
      },
      async () => {
        const { data: row } = await ctx.admin
          .from("webhook_events")
          .select("id, payload")
          .eq("id", eventId)
          .maybeSingle();
        if (!row) throw new Error("Event not found.");
        if (!row.payload) {
          throw new Error("Recorded before payload retention (0023) — nothing stored to replay.");
        }
        const result = await dispatchStripeEvent(ctx.admin, row.payload as Stripe.Event);
        if (result === "ok") {
          await ctx.admin
            .from("webhook_events")
            .update({ processed_at: new Date().toISOString() })
            .eq("id", eventId);
        }
        return { result };
      }
    );
    revalidatePath("/admin", "layout");
    return {
      ok:
        outcome.result === "ok"
          ? "Event replayed and applied."
          : outcome.result === "partial"
            ? "Replayed — some orders could not finalize; check recovery cases."
            : "Replayed — event type has no handler (ignored).",
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Replay failed." };
  }
}

/**
 * Settings page: fire a test alert down the configured webhook. Gated like
 * every action, but deliberately NOT audited — it mutates no data, the audit
 * subject enum has no row for it, and a test ping is operational plumbing,
 * not an intervention.
 */
export async function adminSendTestAlert(
  // useActionState fixes the (prev, formData) shape; a test ping needs neither.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prev: AdminActionState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData
): Promise<AdminActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not found." };
  if (!isCtx(ctx)) return ctx;

  if (!process.env.ADMIN_ALERT_WEBHOOK_URL) {
    return { error: "No webhook configured — set ADMIN_ALERT_WEBHOOK_URL and redeploy." };
  }
  await sendAdminAlert({
    kind: "test",
    title: "Test alert from the console settings page",
    detail: "If you can read this, delivery works.",
  });
  // sendAdminAlert swallows delivery failures by design (money paths must not
  // depend on the messenger) — so "sent" here means handed to the webhook.
  return { ok: "Test alert dispatched — check the channel the webhook feeds." };
}

// ---------- Operations cases (§K1, 0046) ----------

/** Claim a case (or release your own claim). Audited like every mutation. */
export async function adminCaseClaim(formData: FormData) {
  const ctx = await requireAdmin();
  if (!isCtx(ctx)) return ctx ?? { error: "Not found." };
  const caseId = field(formData, "case_id");
  if (!caseId) return { error: "Missing case." };

  const { data: opsCase } = await ctx.admin
    .from("ops_cases")
    .select("id, status, assigned_to, kind, order_id, report_id")
    .eq("id", caseId)
    .maybeSingle();
  if (!opsCase || opsCase.status === "resolved") return { error: "Case not open." };

  const releasing = opsCase.assigned_to === ctx.userId;
  try {
    await auditedAction(
      ctx.admin,
      {
        actorId: ctx.userId,
        action: releasing ? "case.release" : "case.claim",
        subjectType: opsCase.kind === "dispute" ? "order" : "report",
        subjectId: (opsCase.order_id ?? opsCase.report_id)!,
        orderId: opsCase.order_id,
        reason: releasing ? "Released the case" : "Claimed the case",
      },
      async () => {
        const { error } = await ctx.admin
          .from("ops_cases")
          .update(
            releasing
              ? { assigned_to: null, status: "open", updated_at: new Date().toISOString() }
              : { assigned_to: ctx.userId, status: "claimed", updated_at: new Date().toISOString() },
          )
          .eq("id", caseId);
        if (error) throw new Error(error.message);
        return { released: releasing };
      },
    );
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't update the case." };
  }
  revalidatePath("/admin/cases");
  return { ok: releasing ? "Released." : "Claimed — it's yours." };
}

/** Set labels (comma-separated) and priority on a case. */
export async function adminCaseUpdate(formData: FormData) {
  const ctx = await requireAdmin();
  if (!isCtx(ctx)) return ctx ?? { error: "Not found." };
  const caseId = field(formData, "case_id");
  const priority = field(formData, "priority");
  const labels = field(formData, "labels")
    .split(",")
    .map((label) => label.trim().toLowerCase().slice(0, 30))
    .filter(Boolean)
    .slice(0, 6);
  if (!caseId || !["normal", "high"].includes(priority)) return { error: "Bad case update." };

  const { data: opsCase } = await ctx.admin
    .from("ops_cases")
    .select("id, kind, order_id, report_id")
    .eq("id", caseId)
    .maybeSingle();
  if (!opsCase) return { error: "Case not found." };

  try {
    await auditedAction(
      ctx.admin,
      {
        actorId: ctx.userId,
        action: "case.update",
        metadata: { priority, labels },
        subjectType: opsCase.kind === "dispute" ? "order" : "report",
        subjectId: (opsCase.order_id ?? opsCase.report_id)!,
        orderId: opsCase.order_id,
        reason: `priority=${priority}; labels=${labels.join(",") || "—"}`,
      },
      async () => {
        const { error } = await ctx.admin
          .from("ops_cases")
          .update({ priority: priority as "normal" | "high", labels, updated_at: new Date().toISOString() })
          .eq("id", caseId);
        if (error) throw new Error(error.message);
        return { priority, labels };
      },
    );
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't update the case." };
  }
  revalidatePath("/admin/cases");
  return { ok: "Case updated." };
}
