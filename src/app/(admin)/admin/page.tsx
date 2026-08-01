import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { getOverview, DISPUTE_SLA_DAYS } from "@/lib/admin/queries";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { cx } from "@/lib/format";

export const dynamic = "force-dynamic";

function Kpi({
  label,
  value,
  live,
  href,
  detail,
}: {
  label: string;
  value: string | number;
  live?: boolean;
  href: string;
  detail?: string;
}) {
  return (
    <Link href={href} className="tile tile--hover block">
      <span className="microlabel">{label}</span>
      <span className={cx("num-giant block", live && "text-live")}>{value}</span>
      {detail && <span className="order__meta mt-1 block">{detail}</span>}
    </Link>
  );
}

/**
 * The console's front door: what needs a human, ranked. Every tile is a jump
 * into the queue it counts — nothing here is decorative.
 */
export default async function AdminOverviewPage() {
  const o = await getOverview();

  return (
    <>
      <Rv as="header" className="pagehead">
        <h1>Operations</h1>
        <p className="pagehead__sub">
          What needs intervention, oldest first. Every action taken here lands in the audit log.
        </p>
      </Rv>

      <section aria-label="Needs attention" className="deck deck--kpi mb-8">
        <Kpi
          label="Open disputes"
          value={o.openDisputes}
          live={o.openDisputes > 0}
          href="/admin/disputes"
          detail={
            o.oldestDisputeDays != null ? `oldest ${o.oldestDisputeDays}d` : "queue is clear"
          }
        />
        <Kpi
          label={`Over SLA (${DISPUTE_SLA_DAYS}d)`}
          value={o.disputesOverSla}
          live={o.disputesOverSla > 0}
          href="/admin/disputes"
          detail="silence past the escalation window"
        />
        <Kpi
          label="Open reports"
          value={o.openReports}
          live={o.openReports > 0}
          href="/admin/reports"
          detail="user-flagged listings & sellers"
        />
        <Kpi
          label="Money needing a human"
          value={o.openRecoveries + o.stuckTransfers}
          live={o.openRecoveries + o.stuckTransfers > 0}
          href="/admin/payments"
          detail={`${o.openRecoveries} recoveries · ${o.stuckTransfers} stuck transfers`}
        />
      </section>

      <section aria-label="Last seven days" className="deck deck--kpi mb-8">
        <div className="tile">
          <span className="microlabel">Orders · 7d</span>
          <span className="num-giant block">{o.orders7d}</span>
        </div>
        <div className="tile">
          <span className="microlabel">GMV · 7d</span>
          <span className="num-giant block">{formatPrice(o.gmv7dCents)}</span>
        </div>
        <div className="tile">
          <span className="microlabel">Refunded · 7d</span>
          <span className={cx("num-giant block", o.refunds7dCents > 0 && "text-live")}>
            {formatPrice(o.refunds7dCents)}
          </span>
        </div>
        <div className="tile">
          <span className="microlabel">Moderation state</span>
          <span className="num-giant block">{o.suspendedSellers + o.removedListings}</span>
          <span className="order__meta mt-1 block">
            {o.suspendedSellers} suspended · {o.removedListings} removed listings
          </span>
        </div>
      </section>
    </>
  );
}
