import Link from "next/link";

import { PageHead } from "@/components/ui";
import { requireAdminRead } from "@/lib/admin/guard";
import { listOpsCases, type OpsCaseRow } from "@/lib/admin/queries";
import { cx } from "@/lib/format";

import { ConsoleEmpty } from "../_components/console-empty";
import { CaseControls } from "./case-controls";

export const dynamic = "force-dynamic";

function days(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d === 0 ? "today" : `${d}d`;
}

/**
 * The case queue (brief §K1): disputes and reports as claimable work. Rows
 * come from ops_cases (0046), created and resolved by domain triggers; this
 * page adds the operational grip — claim, priority, labels — and links
 * straight to where the work happens (the order sheet's dossier, the reports
 * queue). Deliberately not a CRM.
 */
export default async function AdminCasesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; kind?: string }>;
}) {
  const { view, kind } = await searchParams;
  const ctx = await requireAdminRead();

  const rows = await listOpsCases({
    status: view === "resolved" ? "resolved" : undefined,
    kind: kind === "dispute" || kind === "report" ? kind : undefined,
    assignee: view === "mine" ? ctx.userId : undefined,
  });

  const filters: { key: string; label: string; href: string; active: boolean }[] = [
    { key: "open", label: "Open", href: "/admin/cases", active: !view },
    { key: "mine", label: "Mine", href: "/admin/cases?view=mine", active: view === "mine" },
    {
      key: "resolved",
      label: "Resolved",
      href: "/admin/cases?view=resolved",
      active: view === "resolved",
    },
    {
      key: "disputes",
      label: "Disputes",
      href: `/admin/cases?kind=dispute${view ? `&view=${view}` : ""}`,
      active: kind === "dispute",
    },
    {
      key: "reports",
      label: "Reports",
      href: `/admin/cases?kind=report${view ? `&view=${view}` : ""}`,
      active: kind === "report",
    },
  ];

  return (
    <>
      <PageHead
        eyebrow="Operations — cases"
        title={
          <>
            Work the <span className="live-word">queue.</span>
          </>
        }
        sub="Every open dispute and report as a claimable case — claim it so nobody duplicates the investigation, label it so patterns surface, and open the dossier to act."
      />

      <nav className="jumprow" aria-label="Case filters">
        <span className="microlabel">Show</span>
        {filters.map((filter) => (
          <Link
            key={filter.key}
            href={filter.href}
            className={cx("jumplink", filter.active && "text-live")}
            aria-current={filter.active ? "true" : undefined}
          >
            {filter.label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <ConsoleEmpty
          className="mt-4"
          mark="—"
          title="No cases here"
          body="Disputes and reports become cases the moment they open."
        />
      ) : (
        <div className="rowlist mt-4">
          {rows.map((row: OpsCaseRow) => (
            <div key={row.id} className="jobrow flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className={row.kind === "dispute" ? "chip chip--live" : "chip chip--warn"}>
                    {row.kind}
                  </span>
                  {row.priority === "high" && <span className="chip chip--danger">high</span>}
                  <Link href={row.href} className="order__name truncate hover:text-live">
                    {row.subject}
                  </Link>
                </span>
                <span className="order__meta">
                  {row.summary.replaceAll("_", " ")} · opened {days(row.openedAt)}
                  {row.assignedName ? ` · claimed by ${row.assignedName}` : " · unclaimed"}
                  {row.labels.length > 0 && ` · ${row.labels.join(", ")}`}
                </span>
              </span>
              <CaseControls
                caseId={row.id}
                claimedByMe={row.assignedTo === ctx.userId}
                claimed={Boolean(row.assignedTo)}
                priority={row.priority}
                labels={row.labels}
                resolved={row.status === "resolved"}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
