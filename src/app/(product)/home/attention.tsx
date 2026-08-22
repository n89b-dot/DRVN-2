import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";

import { Rv } from "@/components/livesheet";
import type { Database } from "@/lib/database.types";
import { loadOffersNeedingAttention } from "@/lib/shell-counts";

/**
 * The attention stack — Home's first block after the head, and only when
 * something actually needs the viewer (SYS-10): an offer awaiting their
 * reply, a sale to dispatch, a delivery to confirm, an unread message.
 * All four are head-only counts; when every one is zero the section renders
 * nothing at all — no empty dashboard scaffolding.
 */
export async function Attention({
  supabase,
  userId,
}: {
  supabase: SupabaseClient<Database>;
  userId: string;
}) {
  const [offers, { count: toDispatch }, { count: toConfirm }, { count: unreadMessages }] =
    await Promise.all([
      loadOffersNeedingAttention(supabase, userId),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("seller_id", userId)
        .eq("status", "paid"),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("buyer_id", userId)
        .eq("status", "shipped"),
      supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", userId)
        .is("read_at", null),
    ]);

  const rows: { href: string; label: string; count: number; hint: string }[] = [];
  if (offers > 0)
    rows.push({
      href: "/offers",
      label: `${offers} offer${offers === 1 ? "" : "s"} need${offers === 1 ? "s" : ""} your reply`,
      count: offers,
      hint: "Accept, counter or pass — offers lapse after 72 hours",
    });
  if ((toDispatch ?? 0) > 0)
    rows.push({
      href: "/orders?view=sales&status=paid",
      label: `${toDispatch} sold part${toDispatch === 1 ? "" : "s"} to dispatch`,
      count: toDispatch ?? 0,
      hint: "Buyers are waiting — add tracking when it ships",
    });
  if ((toConfirm ?? 0) > 0)
    rows.push({
      href: "/orders?view=purchases&status=shipped",
      label: `${toConfirm} order${toConfirm === 1 ? "" : "s"} on the way to you`,
      count: toConfirm ?? 0,
      hint: "Confirm receipt when it lands so the seller gets paid",
    });
  if ((unreadMessages ?? 0) > 0)
    rows.push({
      href: "/messages",
      label: `${unreadMessages} unread message${unreadMessages === 1 ? "" : "s"}`,
      count: unreadMessages ?? 0,
      hint: "Order and offer conversations",
    });

  if (rows.length === 0) return null;

  return (
    <section className="deck !pb-0">
      <Rv className="tile">
        <div className="tile__head">
          <span className="microlabel microlabel--ink">Needs you</span>
          <span className="chip chip--live">{rows.reduce((sum, r) => sum + r.count, 0)}</span>
        </div>
        <div className="rowlist mt-2">
          {rows.map((row) => (
            <Link key={row.href} href={row.href} className="order">
              <span className="min-w-0 flex-1">
                <span className="order__name block">{row.label}</span>
                <span className="order__meta block">{row.hint}</span>
              </span>
              <span className="order__actions" aria-hidden="true">
                <span className="mono text-dim">→</span>
              </span>
            </Link>
          ))}
        </div>
      </Rv>
    </section>
  );
}
