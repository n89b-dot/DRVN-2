import { unstable_rethrow } from "next/navigation";

import { getAdminContext } from "@/lib/admin/guard";
import {
  ExportTooLargeError,
  exportAuditRows,
  exportOrderRows,
  DISPUTE_SLA_DAYS,
  type OrderExportRow,
} from "@/lib/admin/queries";
import { personLabel } from "@/lib/format";
import { reportError } from "@/lib/monitoring";
import type { AdminAuditSubjectType, DisputeCategory, OrderStatus } from "@/lib/database.types";

/**
 * CSV export for the three views finance and accountants actually ask for:
 * orders, disputes, audit. Honors the same filters as the on-screen table
 * (the "Export CSV" link carries the current query string). Route handlers
 * do NOT inherit the layout gate, so this checks admin membership itself —
 * non-admins get the same 404 as any unknown route — and the read layer
 * checks again (N11).
 *
 * Complete or nothing (N133): the rows are read in keyset pages until the
 * last short page, the whole file is built before anything is sent, and a
 * failed page or an export past EXPORT_ROW_LIMIT is an error response, never
 * a file that silently stops at 1,000 rows. `x-drvn-export-rows` carries the
 * row count so a reader can check the file against it.
 *
 * Audited (N531): `export.started` (who, view, filters) is recorded before
 * any row is read, then `export.completed` (rows) or `export.failed` before
 * the response goes out, on the admin's own session (record_admin_export,
 * 20261108120000). If a record can't be written, no file is sent. Who may
 * export is unchanged: any console member, as before (N135 is the policy
 * question).
 */

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

function csvResponse(filename: string, body: string, rows: number): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      "x-drvn-export-rows": String(rows),
    },
  });
}

const person = (id: string | null, username: string | null, displayName: string | null) =>
  id ? personLabel({ id, username, displayName }) : personLabel(null);

function failure(error: unknown): Response {
  if (error instanceof ExportTooLargeError) {
    return new Response(error.message, { status: 413, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  // Next's control flow (a lapsed step-up's redirect, a 404) passes through.
  unstable_rethrow(error);
  reportError("[admin] export failed", { error });
  return new Response("The export couldn't be completed, so no file was made. Try again.", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

type ExportView = "orders" | "disputes_open" | "disputes_resolved" | "audit";

type BuiltExport = { filename: string; body: string; rows: number };

/** The query-string filters each view honours: exactly what is recorded. */
const FILTER_KEYS: Record<ExportView, string[]> = {
  orders: ["q", "status", "from", "to", "min", "max"],
  disputes_open: ["q", "category"],
  disputes_resolved: ["q", "category"],
  audit: ["action", "actor", "subject", "from", "to"],
};

function exportView(params: URLSearchParams): ExportView | null {
  const view = params.get("view");
  if (view === "orders" || view === "audit") return view;
  if (view === "disputes") return params.get("scope") === "resolved" ? "disputes_resolved" : "disputes_open";
  return null;
}

function recordedFilters(view: ExportView, params: URLSearchParams): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const key of FILTER_KEYS[view]) {
    const value = params.get(key)?.trim();
    if (value) filters[key] = value.slice(0, 500);
  }
  return filters;
}

async function buildExport(view: ExportView, params: URLSearchParams, stamp: string): Promise<BuiltExport> {
  if (view === "orders") {
    const cents = (v: string | null) => {
      const n = Number(v);
      return v && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
    };
    const rows = await exportOrderRows("orders", {
      query: params.get("q") ?? undefined,
      status: (params.get("status") as OrderStatus) || undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      minCents: cents(params.get("min")),
      maxCents: cents(params.get("max")),
    });
    return {
      filename: `drvn-orders-${stamp}.csv`,
      body: csv([
        ["order_id", "created_at", "status", "title", "buyer", "seller", "total_cents", "refunded_cents", "currency", "transferred"],
        ...rows.map((r: OrderExportRow) => [
          r.id,
          r.created_at,
          r.status,
          r.title ?? `Order ${r.id.slice(0, 8)}`,
          person(r.buyer_id, r.buyer_username, r.buyer_display_name),
          person(r.seller_id, r.seller_username, r.seller_display_name),
          r.total_cents,
          r.refunded_cents,
          r.currency,
          r.transferred ? "yes" : "no",
        ]),
      ]),
      rows: rows.length,
    };
  }

  if (view === "disputes_open" || view === "disputes_resolved") {
    const rows = await exportOrderRows(view, {
      query: params.get("q") ?? undefined,
      category: (params.get("category") as DisputeCategory) || undefined,
    });
    const now = Date.now();
    return {
      filename: `drvn-disputes-${view === "disputes_open" ? "open" : "resolved"}-${stamp}.csv`,
      body: csv([
        ["order_id", "disputed_at", "age_days", "over_sla", "category", "reason", "buyer", "seller", "total_cents", "money_state"],
        ...rows.map((r) => {
          const ageDays = r.disputed_at ? Math.floor((now - new Date(r.disputed_at).getTime()) / 86_400_000) : 0;
          return [
            r.id,
            r.disputed_at,
            ageDays,
            ageDays >= DISPUTE_SLA_DAYS && r.status === "disputed" ? "yes" : "no",
            r.dispute_category ?? "other",
            r.dispute_reason,
            person(r.buyer_id, r.buyer_username, r.buyer_display_name),
            person(r.seller_id, r.seller_username, r.seller_display_name),
            r.total_cents,
            r.refund_offer_cents ? "offer_out" : r.transferred ? "paid_out" : "funds_held",
          ];
        }),
      ]),
      rows: rows.length,
    };
  }

  const rows = await exportAuditRows({
    action: params.get("action") ?? undefined,
    actorQuery: params.get("actor") ?? undefined,
    subjectType: (params.get("subject") as AdminAuditSubjectType) || undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
  });
  return {
    filename: `drvn-audit-${stamp}.csv`,
    body: csv([
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
    ]),
    rows: rows.length,
  };
}

const unrecorded = () =>
  new Response("The export couldn't be recorded on the audit log, so no file was made. Try again.", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

export async function GET(request: Request) {
  const ctx = await getAdminContext();
  if (!ctx) return new Response(null, { status: 404 });

  const params = new URL(request.url).searchParams;
  const view = exportView(params);
  if (!view) return new Response(null, { status: 404 });
  const stamp = new Date().toISOString().slice(0, 10);

  // N531: who, which view, which filters, as the admin's own session, before
  // a single row is read. No record, no export.
  const started = await ctx.supabase.rpc("record_admin_export", {
    p_phase: "started",
    p_view: view,
    p_filters: recordedFilters(view, params),
  });
  const exportId = started.data;
  if (started.error || !exportId) {
    reportError("[admin] export audit record failed", { view, error: started.error });
    return unrecorded();
  }

  let built: BuiltExport;
  try {
    built = await buildExport(view, params, stamp);
  } catch (error) {
    const detail = error instanceof ExportTooLargeError ? `too_large: ${error.message}` : "read_failed";
    const failed = await ctx.supabase.rpc("record_admin_export", { p_phase: "failed", p_export: exportId, p_detail: detail });
    if (failed.error) reportError("[admin] export failure record failed", { exportId, error: failed.error });
    return failure(error);
  }

  // How many rows left, recorded before the file is sent (the whole file is
  // built first, N133, so this is what the admin receives).
  const completed = await ctx.supabase.rpc("record_admin_export", { p_phase: "completed", p_export: exportId, p_rows: built.rows });
  if (completed.error) {
    reportError("[admin] export completion record failed", { exportId, error: completed.error });
    return unrecorded();
  }
  return csvResponse(built.filename, built.body, built.rows);
}
