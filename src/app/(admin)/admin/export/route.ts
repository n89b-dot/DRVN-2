import { getAdminContext } from "@/lib/admin/guard";
import {
  getAuditLog,
  getDisputeQueue,
  searchOrders,
  type OrdersSearchOpts,
} from "@/lib/admin/queries";
import { personLabel } from "@/lib/format";
import type { AdminAuditSubjectType, DisputeCategory, OrderStatus } from "@/lib/database.types";

/**
 * CSV export for the three views finance and accountants actually ask for:
 * orders, disputes, audit. Honors the same filters as the on-screen table
 * (the "Export CSV" link carries the current query string), capped at 5000
 * rows per file. Route handlers do NOT inherit the layout gate, so this
 * checks admin membership itself — non-admins get the same 404 as any
 * unknown route.
 */

const EXPORT_LIMIT = 5000;

function csv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const raw = cell == null ? "" : String(cell);
          // A cell starting with = + - @ (or tab/CR) runs as a formula in
          // Excel/Sheets; seller-written titles must stay plain text.
          const s = typeof cell === "string" && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
          return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
        })
        .join(",")
    )
    .join("\n");
}

function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

export async function GET(request: Request) {
  const ctx = await getAdminContext();
  if (!ctx) return new Response(null, { status: 404 });

  const params = new URL(request.url).searchParams;
  const view = params.get("view");
  const stamp = new Date().toISOString().slice(0, 10);

  if (view === "orders") {
    const cents = (v: string | null) => {
      const n = Number(v);
      return v && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
    };
    const opts: OrdersSearchOpts = {
      query: params.get("q") ?? undefined,
      status: (params.get("status") as OrderStatus) || undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      minCents: cents(params.get("min")),
      maxCents: cents(params.get("max")),
      pageSize: EXPORT_LIMIT,
    };
    const { rows } = await searchOrders(opts);
    return csvResponse(
      `drvn-orders-${stamp}.csv`,
      csv([
        ["order_id", "created_at", "status", "title", "buyer", "seller", "total_cents", "refunded_cents", "currency", "transferred"],
        ...rows.map((r) => [
          r.id,
          r.createdAt,
          r.status,
          r.title,
          personLabel(r.buyer),
          personLabel(r.seller),
          r.totalCents,
          r.refundedCents,
          r.currency,
          r.transferred ? "yes" : "no",
        ]),
      ])
    );
  }

  if (view === "disputes") {
    const scope = params.get("scope") === "resolved" ? "resolved" : "open";
    const { rows } = await getDisputeQueue(scope, {
      query: params.get("q") ?? undefined,
      category: (params.get("category") as DisputeCategory) || undefined,
      pageSize: EXPORT_LIMIT,
    });
    return csvResponse(
      `drvn-disputes-${scope}-${stamp}.csv`,
      csv([
        ["order_id", "disputed_at", "age_days", "over_sla", "category", "reason", "buyer", "seller", "total_cents", "money_state"],
        ...rows.map((r) => [
          r.orderId,
          r.disputedAt,
          r.ageDays,
          r.overSla ? "yes" : "no",
          r.category ?? "other",
          r.reason,
          personLabel(r.buyer),
          personLabel(r.seller),
          r.totalCents,
          r.refundOfferCents ? "offer_out" : r.transferred ? "paid_out" : "funds_held",
        ]),
      ])
    );
  }

  if (view === "audit") {
    const { rows } = await getAuditLog({
      action: params.get("action") ?? undefined,
      actorQuery: params.get("actor") ?? undefined,
      subjectType: (params.get("subject") as AdminAuditSubjectType) || undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      pageSize: EXPORT_LIMIT,
    });
    return csvResponse(
      `drvn-audit-${stamp}.csv`,
      csv([
        ["created_at", "action", "actor", "subject_type", "subject_id", "order_id", "reason"],
        ...rows.map((r) => [
          r.created_at,
          r.action,
          personLabel(r.actor ?? { id: r.actor_id }),
          r.subject_type,
          r.subject_id,
          r.order_id,
          r.reason,
        ]),
      ])
    );
  }

  return new Response(null, { status: 404 });
}
