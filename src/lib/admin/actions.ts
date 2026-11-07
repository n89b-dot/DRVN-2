"use server";

import { verifyLateRefundRecovery } from "@/lib/payments/late-refund-recovery";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "@/lib/revalidate";

import { auditedAction } from "./audit";
import { sendAdminAlert } from "./alerts";
import { markWebhookEventProcessed } from "@/lib/payments/settlement";
import { recordWebhookFailure } from "@/lib/payments/webhook-failures";
import { dispatchRecordedWebhookEvent } from "./replay-webhook";
import { runMoneyWorkerPass } from "@/lib/money-worker";
import { ACCOUNT_DELETION_REASON } from "./presentation";
import { getAdminContext } from "./guard";
import { refundOrder } from "@/lib/payments/refunds";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { reportError } from "@/lib/monitoring";
import { scheduleMediaCleanup } from "@/lib/media-lifecycle";

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

/**
 * Tells a member who filed a report that it was looked at (admin-22). They
 * used to hear nothing, whatever the outcome. Best-effort: a failed
 * notification never undoes the resolution.
 */
async function notifyReporter(
  admin: ReturnType<typeof createAdminClient>,
  reportId: string,
  outcome: "actioned" | "dismissed"
) {
  const { data: report } = await admin
    .from("reports")
    .select("reporter_id, subject_type")
    .eq("id", reportId)
    .maybeSingle();
  if (!report?.reporter_id) return;
  const what =
    report.subject_type === "post" ? "post" : report.subject_type === "comment" ? "reply" : report.subject_type === "listing" ? "listing" : "member";
  const { error } = await admin.from("notifications").insert({
    user_id: report.reporter_id,
    kind: "report_reviewed",
    section: report.subject_type === "post" || report.subject_type === "comment" ? "engagement" : "marketplace",
    title: "Thanks — we reviewed your report",
    body:
      outcome === "actioned"
        ? `We took action on the ${what} you reported.`
        : `We looked at the ${what} you reported and didn't find a breach of DRVN's rules.`,
    href: null,
    actor_id: null,
  });
  if (error) reportError("[admin] reporter notification failed", { reportId, error });
}

/** The member's own notice that their account was suspended or restored
 *  (admin-10) — with the reason, so a listing vanishing isn't a mystery. */
async function notifyAccountState(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  state: "suspended" | "restored",
  reason: string
) {
  const { error } = await admin.from("notifications").insert({
    user_id: userId,
    kind: state === "suspended" ? "account_suspended" : "account_restored",
    section: "marketplace",
    title: state === "suspended" ? "Your account is suspended" : "Your account is restored",
    body:
      state === "suspended"
        ? `Reason: ${reason}. While it lasts you can't post, reply or make offers, and your listings are paused.`
        : "You can post, reply and make offers again. Listings paused by the suspension are live again.",
    href: null,
    actor_id: null,
  });
  if (error) reportError("[admin] account-state notification failed", { userId, state, error });
  return !error;
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
  // The dialog's id for this command, with the amount it was issued for. A
  // second press — after "pending provider confirmation", say — adopts the
  // refund already started rather than issuing the same partial refund
  // again; a changed amount is a different request.
  const requestId = field(formData, "request_id");
  const requestKey = /^[0-9a-f-]{36}$/i.test(requestId)
    ? `admin:${orderId}:${requestId}:${amountCents ?? "full"}`
    : undefined;

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
          requestKey,
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
    // user.suspend is a transactional command: auditedAction runs it as
    // execute_admin_command, which refuses an admin target, suspends, pauses
    // the listings and writes the audit row in one transaction (raising on a
    // zero-row suspend). The closure below runs only if the action ever
    // leaves that set, and checks every step the same way.
    const result = await auditedAction(
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
        const { data: isTargetAdmin, error: adminReadError } = await ctx.admin
          .from("admin_users")
          .select("user_id")
          .eq("user_id", userId)
          .maybeSingle();
        if (adminReadError) throw new Error("Couldn't check whether this user is an admin. Nothing changed.");
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
        const { data: paused, error: pauseError } = await ctx.admin
          .from("listings")
          .update({ status: "paused" })
          .eq("seller_id", userId)
          .eq("status", "active")
          .select("id");
        if (pauseError) {
          throw new Error("The user is suspended, but their listings couldn't be paused. Pause them before retrying.");
        }
        return { pausedListingIds: (paused ?? []).map((l) => l.id) };
      }
    );
    const paused = Array.isArray(result?.pausedListingIds) ? result.pausedListingIds.length : null;
    const told = await notifyAccountState(ctx.admin, userId, "suspended", reason);
    revalidatePath("/admin", "layout");
    const listings =
      paused == null ? "their active listings were paused" : `${paused} active listing${paused === 1 ? "" : "s"} paused`;
    return {
      ok: told
        ? `User suspended; ${listings}, and they were told why.`
        : `User suspended; ${listings}. Their notification failed — tell them directly.`,
    };
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
    // Transactional, like user.suspend: execute_admin_command lifts the
    // suspension, reactivates the recorded listings and audits it at once.
    // The closure is the checked fallback should the action leave that set.
    const result = await auditedAction(
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
          // A pending account deletion is not a suspension to lift.
          .or(`suspended_reason.is.null,suspended_reason.neq."${ACCOUNT_DELETION_REASON}"`)
          .select("id");
        if (error) throw new Error(error.message);
        if (!cleared?.length) throw new Error("This user isn't suspended, or their account is being deleted.");

        // Reactivate exactly the set the suspension paused.
        const { data: lastSuspend, error: auditError } = await ctx.admin
          .from("admin_audit_log")
          .select("metadata")
          .eq("subject_type", "user")
          .eq("subject_id", userId)
          .eq("action", "user.suspend")
          .not("metadata->result", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (auditError) {
          throw new Error("The suspension is lifted, but its paused listings couldn't be looked up. Reactivate them by hand.");
        }
        const meta = lastSuspend?.metadata as { result?: { pausedListingIds?: string[] } } | null;
        const pausedIds = meta?.result?.pausedListingIds ?? [];
        let reactivated: string[] = [];
        if (pausedIds.length) {
          const { data: restored, error: restoreError } = await ctx.admin
            .from("listings")
            .update({ status: "active" })
            .in("id", pausedIds)
            .eq("seller_id", userId)
            .eq("status", "paused")
            .select("id");
          if (restoreError) {
            throw new Error("The suspension is lifted, but its paused listings couldn't be reactivated. Reactivate them by hand.");
          }
          reactivated = (restored ?? []).map((l) => l.id);
        }
        return { reactivatedListingIds: reactivated };
      }
    );
    const reactivated = Array.isArray(result?.reactivatedListingIds) ? result.reactivatedListingIds.length : null;
    const told = await notifyAccountState(ctx.admin, userId, "restored", reason);
    revalidatePath("/admin", "layout");
    const listings =
      reactivated == null
        ? "previously paused listings reactivated"
        : reactivated === 0
          ? "no paused listings to reactivate"
          : `${reactivated} paused listing${reactivated === 1 ? "" : "s"} reactivated`;
    return {
      ok: told
        ? `Suspension lifted; ${listings}.`
        : `Suspension lifted; ${listings}. Their notification failed — tell them directly.`,
    };
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
    await notifyReporter(ctx.admin, reportId, outcome as "actioned" | "dismissed");
    revalidatePath("/admin", "layout");
    return { ok: outcome === "actioned" ? "Report actioned." : "Report dismissed." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not resolve the report." };
  }
}

/**
 * Decides a product identity review (B1, 20261020120000): merge the products
 * it names, keep them separate, or dismiss it. The database function checks
 * the admin and a fresh step-up itself, records the decision and writes the
 * audit row in one transaction — this only parses the form.
 */
export async function adminResolveIdentityReview(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not found." };
  if (!isCtx(ctx)) return ctx;

  const reviewId = field(formData, "review_id");
  const decision = field(formData, "decision");
  const note = field(formData, "note");
  if (!reviewId) return { error: "Missing review." };
  if (!["merge", "keep_separate", "dismiss"].includes(decision)) return { error: "Pick a decision." };
  if (!note) return { error: "A note is required — it goes in the audit log." };

  const session = await createClient();
  const { error } = await session.rpc("resolve_product_identity_review", {
    p_review: reviewId,
    p_decision: decision,
    p_reason: note,
  });
  if (error) {
    if (error.code === "42501") return { error: "Confirm your authenticator again, then retry." };
    return { error: error.message };
  }
  revalidatePath("/admin", "layout");
  return {
    ok: decision === "merge" ? "Merged into one product." : decision === "keep_separate" ? "Kept separate." : "Dismissed.",
  };
}

/**
 * Removes a reported post or reply (admin-11) — the post/comment equivalent
 * of a listing takedown, run from the report's row. The row is deleted (a
 * post has no "removed" state the feeds could honour); its text goes in the
 * audit metadata, the author is told why, the report is marked actioned and
 * the reporter is told it was reviewed.
 */
export async function adminRemoveReportedContent(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not found." };
  if (!isCtx(ctx)) return ctx;

  const reportId = field(formData, "report_id");
  const reason = field(formData, "reason");
  if (!reportId) return { error: "Missing report." };
  if (!reason) return { error: "A reason is required — it is shown to the author." };

  const { data: report } = await ctx.admin
    .from("reports")
    .select("id, subject_type, subject_id, status")
    .eq("id", reportId)
    .maybeSingle();
  if (!report) return { error: "Report not found." };
  if (report.subject_type !== "post" && report.subject_type !== "comment") {
    return { error: "Only a reported post or reply is removed from here." };
  }
  const isPost = report.subject_type === "post";

  try {
    const { removed } = await auditedAction(
      ctx.admin,
      {
        actorId: ctx.userId,
        action: isPost ? "report.remove_post" : "report.remove_comment",
        subjectType: "report",
        subjectId: reportId,
        reason,
        metadata: { subjectType: report.subject_type, subjectId: report.subject_id },
      },
      async () => {
        const snapshot = isPost
          ? await ctx.admin
              .from("activity_posts")
              .select("id, author_id, car_id, title, intro, body, published_at")
              .eq("id", report.subject_id)
              .maybeSingle()
          : await ctx.admin
              .from("activity_comments")
              .select("id, author_id, post_id, body, created_at")
              .eq("id", report.subject_id)
              .maybeSingle();
        if (snapshot.error) throw new Error(snapshot.error.message);
        const row = snapshot.data as { author_id: string; title?: string | null; body: unknown } | null;
        if (!row) throw new Error(isPost ? "That post is already gone." : "That reply is already gone.");

        const { error } = await ctx.admin
          .from(isPost ? "activity_posts" : "activity_comments")
          .delete()
          .eq("id", report.subject_id);
        if (error) throw new Error(error.message);

        await ctx.admin
          .from("reports")
          .update({
            status: "actioned",
            resolved_by: ctx.userId,
            resolved_at: new Date().toISOString(),
            resolution_note: `Removed: ${reason}`,
          })
          .eq("id", reportId)
          .eq("status", "open");

        const { error: noteError } = await ctx.admin.from("notifications").insert({
          user_id: row.author_id,
          kind: isPost ? "post_removed" : "comment_removed",
          section: "engagement",
          title: isPost ? "A post of yours was removed" : "A reply of yours was removed",
          body: reason,
          href: null,
          actor_id: null,
        });
        if (noteError) reportError("[admin] removal notification failed", { reportId, noteError });
        return { removed: row };
      }
    );
    // Deleting the post queued its photos (20261107203000, N51); taken-down
    // content shouldn't stay reachable by link until the daily job.
    if (isPost) scheduleMediaCleanup(removed.author_id);
    await notifyReporter(ctx.admin, reportId, "actioned");
    revalidatePath("/admin", "layout");
    revalidatePath("/home");
    revalidatePath("/explore");
    return { ok: isPost ? "Post removed; the author and the reporter were told." : "Reply removed; the author and the reporter were told." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not remove it." };
  }
}

// ---------- Transfer worker ----------

/**
 * Manual run of the money worker — the human retry for stuck work. Runs
 * exactly the scheduled pass (`runMoneyWorkerPass`, also behind
 * /api/jobs/transfers): expiries, captures, transfers, refunds, returns,
 * disputes, alerts, receipts and the rest, each recorded in worker_runs.
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
    const pass = await auditedAction(
      ctx.admin,
      {
        actorId: ctx.userId,
        action: "payments.run_transfer_worker",
        subjectType: "payment",
        subjectId: randomUUID(),
        reason,
      },
      () => runMoneyWorkerPass(ctx.admin)
    );
    revalidatePath("/admin", "layout");
    const count = (family: string, key: string) => {
      const value = (pass.results[family] as Record<string, unknown> | undefined)?.[key];
      return typeof value === "number" ? value : 0;
    };
    const failedFamilies = Object.entries(pass.results)
      .filter(([, result]) => (result as { failed?: unknown } | undefined)?.failed === true)
      .map(([family]) => family);
    const summary = `${count("transfers", "transferred")} paid out, ${count("expiries", "completed")} holds released, ${count("disputes", "autoRefunded")} disputes auto-refunded.`;
    return failedFamilies.length
      ? { error: `Worker ran. ${summary} These jobs failed and will retry: ${failedFamilies.join(", ")}.` }
      : { ok: `Worker ran. ${summary}` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Worker run failed." };
  }
}

// ---------- Payment recoveries ----------

/** Explicit money action: case closure never initiates a provider request. */
export async function adminReplaceFailedRefund(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not found." };
  if (!isCtx(ctx)) return ctx;
  const recoveryId = field(formData, "recovery_id");
  const note = field(formData, "note");
  if (!recoveryId || !note) return { error: "Recovery case and audit reason are required." };
  try {
    const result = await auditedAction(ctx.admin, {
      actorId: ctx.userId, action: "recovery.replace_refund", subjectType: "payment",
      subjectId: recoveryId, reason: note,
    }, async () => {
      await verifyLateRefundRecovery(ctx.admin, recoveryId, ctx.userId, field(formData, "recredit_transfer_reference"));
      const {data: operationId} = await ctx.admin.rpc("begin_refund_replacement", {
        p_recovery: recoveryId, p_actor: ctx.userId,
      }).throwOnError();
      if (!operationId) throw new Error("Replacement was not durably reserved.");
      const {runRefundOperation} = await import("@/lib/payments/refunds");
      const outcome = await runRefundOperation(ctx.admin, operationId);
      return {operationId, outcome};
    });
    revalidatePath("/admin", "layout");
    return {ok: result.outcome.ok
      ? "Replacement buyer refund submitted. Close the case once both obligations are settled."
      : `Replacement recorded. ${result.outcome.error}`};
  } catch (error) {
    return {error: error instanceof Error ? error.message : "Could not start the replacement."};
  }
}

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
    // Transactional commands execute in SQL, so their callback is not invoked.
    // Save provider evidence before asking that transaction to close the case.
    await verifyLateRefundRecovery(ctx.admin, recoveryId, ctx.userId, field(formData, "recredit_transfer_reference"));
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

// ---------- Seller credit payouts (20261008100100 / 20261026150000) ----------

type CarryPayoutControl = "retry" | "cancel";

/**
 * The console's controls for a seller credit payout the worker has given up
 * on (readiness 21). Both read the row first and refuse in plain words
 * before anything is journalled, so a simple "already paid" never leaves an
 * operation awaiting reconciliation; the database function re-checks under
 * its own lock and is the one that moves the row (and, on cancel, the
 * seller's credit).
 */
async function controlCarryPayout(
  control: CarryPayoutControl,
  formData: FormData
): Promise<AdminActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not found." };
  if (!isCtx(ctx)) return ctx;

  const payoutId = field(formData, "payout_id");
  const reason = field(formData, "reason");
  if (!/^[0-9a-f-]{36}$/i.test(payoutId)) return { error: "Missing payout." };
  if (!reason) return { error: "A reason is required — it goes in the audit log." };

  const { data: payout, error: readError } = await ctx.admin
    .from("seller_carry_payouts")
    .select("id, status, amount_cents, lease_expires_at, provider_call_may_have_occurred")
    .eq("id", payoutId)
    .maybeSingle();
  if (readError) return { error: "Couldn't read that payout. Try again." };
  if (!payout) return { error: "That payout no longer exists." };
  if (payout.status === "paid" || payout.status === "cancelled") return { error: `This payout is already ${payout.status}.` };
  if (payout.status === "processing" && payout.lease_expires_at && new Date(payout.lease_expires_at).getTime() > Date.now()) {
    return { error: "A worker holds this payout right now. Try again in a few minutes." };
  }
  if (control === "cancel" && payout.provider_call_may_have_occurred) {
    return {
      error: `Stripe may have been called for this payout, so it can't be cancelled. Find the transfer in Stripe (group carry-payout:${payout.id}), then Retry so the worker completes it.`,
    };
  }

  try {
    const result = await auditedAction(
      ctx.admin,
      {
        actorId: ctx.userId,
        action: `payments.carry_payout_${control}`,
        subjectType: "payment",
        subjectId: payout.id,
        reason,
        metadata: { amountCents: payout.amount_cents, previousStatus: payout.status },
      },
      async () => {
        const { data, error } = await ctx.admin.rpc(
          control === "retry" ? "admin_retry_seller_carry_payout" : "admin_cancel_seller_carry_payout",
          { p_id: payout.id }
        );
        if (error) throw new Error(error.message);
        return data as { status?: string; credit_restored_cents?: number } | null;
      }
    );
    revalidatePath("/admin", "layout");
    if (control === "retry") return { ok: `Payout queued again — the next worker pass picks it up (${formatPrice(payout.amount_cents)}).` };
    const restored = result?.credit_restored_cents ?? 0;
    return {
      ok: restored
        ? `Payout cancelled. ${formatPrice(restored)} is back on the seller's credit balance.`
        : "Payout cancelled. The seller's account is gone, so there was no balance to restore.",
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : `Could not ${control} the payout.` };
  }
}

export async function adminRetryCarryPayout(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  return controlCarryPayout("retry", formData);
}

export async function adminCancelCarryPayout(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  return controlCarryPayout("cancel", formData);
}

// ---------- Exhausted seller payouts (20261107210100, N8) ----------

/**
 * Puts a seller payout the worker gave up on (eight failed attempts, a
 * transfer_unresolved case open) back in the queue. Nothing about whether it
 * may go changes: admission, readiness, the chargeback freeze and dispatch
 * all still decide, and a payout Stripe may already hold is looked up before
 * anything is sent, with the same idempotency key. The recovery case stays
 * open until the operator closes it.
 */
export async function adminRetryTransfer(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not found." };
  if (!isCtx(ctx)) return ctx;

  const orderId = field(formData, "order_id");
  const reason = field(formData, "reason");
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return { error: "Missing payout." };
  if (!reason) return { error: "A reason is required — it goes in the audit log." };

  const { data: intent, error: readError } = await ctx.admin
    .from("transfer_intents")
    .select("order_id, status, attempts, amount_cents, provider_call_may_have_occurred")
    .eq("order_id", orderId)
    .maybeSingle();
  if (readError) return { error: "Couldn't read that payout. Try again." };
  if (!intent) return { error: "That payout no longer exists." };
  if (intent.status !== "failed" || intent.attempts < 8) {
    return { error: "This payout is still being retried automatically; there is nothing to queue again." };
  }

  try {
    await auditedAction(
      ctx.admin,
      {
        actorId: ctx.userId,
        action: "payments.transfer_retry",
        subjectType: "payment",
        subjectId: orderId,
        orderId,
        reason,
        metadata: {
          amountCents: intent.amount_cents,
          previousAttempts: intent.attempts,
          providerCallMayHaveOccurred: intent.provider_call_may_have_occurred,
        },
      },
      async () => {
        const { data, error } = await ctx.admin.rpc("admin_retry_transfer_intent", { p_order: orderId });
        if (error) throw new Error(error.message);
        return data;
      }
    );
    revalidateOrder(orderId);
    return {
      ok: intent.provider_call_may_have_occurred
        ? "Payout queued again. Stripe may already hold it, so the next worker pass looks it up first and records it rather than sending again."
        : "Payout queued again. The next worker pass tries it; it comes back here if the cause remains.",
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not queue the payout again." };
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
 * Record what actually happened to an external operation whose outcome was
 * lost (RR-15). The operator checks the provider (the Stripe dashboard, the
 * carrier) and says whether it went through; that closes the operation, so
 * the fence stops refusing the action and a "not applied" can be retried as
 * a new operation. Nothing here calls the provider or moves money.
 */
export async function adminReconcileOperation(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not found." };
  if (!isCtx(ctx)) return ctx;

  const operationId = field(formData, "operation_id");
  const seenThrough = Number(field(formData, "seen_through"));
  const outcome = field(formData, "outcome");
  const reason = field(formData, "reason");
  if (!/^[0-9a-f-]{36}$/i.test(operationId)) return { error: "Missing operation." };
  if (!Number.isSafeInteger(seenThrough) || seenThrough <= 0) {
    return { error: "This page is out of date. Reload it, then record the outcome." };
  }
  if (!["applied", "not_applied", "unknown"].includes(outcome)) {
    return { error: "Say whether it went through, or that you can't tell yet." };
  }
  if (!reason) return { error: "Say how you checked — it goes in the audit log." };

  // R2-02: one transaction as the signed-in admin (fresh MFA, checked in the
  // database). It takes the operation fence's lock, rechecks the operation
  // and the refund records it created, and admits one terminal answer.
  const session = await createClient();
  const { data, error } = await session.rpc("reconcile_admin_external_operation", {
    p_operation: operationId,
    p_seen_through: seenThrough,
    p_outcome: outcome,
    p_reason: reason,
  });
  if (error) {
    const code = error.code ?? "";
    if (code === "40001") {
      return { error: "Something new was recorded for this operation since you opened it. Reload, check again, then record." };
    }
    if (code === "55000" || code === "22023") return { error: error.message };
    if (code === "P0002") return { error: "No such pending operation." };
    if (code === "42501") return { error: "Recording an outcome needs a fresh authenticator check. Reload to verify again." };
    reportError("[admin] reconcile outcome unknown", { operationId, error });
    return { error: "Couldn't confirm the outcome was recorded. Reload to see the operation's current state." };
  }
  revalidatePath("/admin", "layout");
  const result = data as unknown as { status?: string; outcome?: string; phase?: string } | null;
  if (result?.status === "escalated") {
    return { ok: "Recorded as unknown. The operation stays blocked until its outcome is confirmed." };
  }
  if (result?.status === "already_resolved") {
    return {
      error:
        result.phase === "completed"
          ? "This operation completed in the meantime — nothing to record."
          : `Someone already recorded this as ${result.outcome === "applied" ? "done" : "not done"}. Nothing changed.`,
    };
  }
  return {
    ok:
      result?.outcome === "applied"
        ? "Recorded as done. The operation is closed."
        : "Recorded as not done. The operation is closed and can be run again.",
  };
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
        // Notifications can't be replied to, so say where a reply goes.
        await notifyBothParties(
          ctx.admin,
          order,
          "A message from DRVN support",
          `${message}\n\nTo reply, open the order: message the other party there, or report a problem with photos.`
        );
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
      await notifyReporter(ctx.admin, reportId, outcome as "actioned" | "dismissed");
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
 * Re-run a recorded Stripe or EasyPost event through the same handlers the
 * live webhook uses. For investigations where an event
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
        const { data: row, error: rowError } = await ctx.admin
          .from("webhook_events")
          .select("id, payload")
          .eq("id", eventId)
          .maybeSingle();
        if (rowError) throw new Error("Event lookup failed — try again.");
        if (!row) throw new Error("Event not found.");
        if (!row.payload) {
          throw new Error("Recorded before payload retention (0023) — nothing stored to replay.");
        }
        // Every failed replay of the loaded, unprocessed event is counted on it
        // (N109): an explicit retry once as "retry", a throw from dispatch or
        // from the completion marker once as "error".
        const failure = { provider: row.id.startsWith("easypost:") ? "easypost" : "stripe", type: "console_replay" } as const;
        let result: Awaited<ReturnType<typeof dispatchRecordedWebhookEvent>>;
        try {
          result = await dispatchRecordedWebhookEvent(ctx.admin, row.id, row.payload);
        } catch (error) {
          await recordWebhookFailure(ctx.admin, row.id, "error", { ...failure, error });
          throw error;
        }
        if (result === "retry") {
          await recordWebhookFailure(ctx.admin, row.id, "retry", failure);
          throw new Error("Replay needs another attempt; the event remains unprocessed.");
        }
        try {
          await markWebhookEventProcessed(ctx.admin, eventId);
        } catch (error) {
          await recordWebhookFailure(ctx.admin, row.id, "error", { ...failure, error });
          throw error;
        }
        return { result };
      }
    );
    revalidatePath("/admin", "layout");
    return {
      ok:
        outcome.result === "committed"
          ? "Event replayed and applied."
          : outcome.result === "recovery_recorded"
            ? "Event replayed; a durable recovery case owns the remaining work."
            : "Replayed — event type is intentionally irrelevant.",
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
