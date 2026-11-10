import { DataRow, PageHead, SheetTabs } from "@/components/ui";
import { adminCopyrightTakedown, adminRecordCounterNotice, adminReinstateAfterCounterNotice, adminRejectCopyrightNotice } from "@/lib/admin/actions";
import { getCopyrightNotices, type CopyrightNoticeRow } from "@/lib/admin/copyright";
import { copyrightHosts } from "@/lib/copyright/hosts";
import { takedownTargets } from "@/lib/copyright/notice";

import { ActionDialog } from "../_components/action-dialog";
import { ConsoleEmpty } from "../_components/console-empty";
import { Pager } from "../_components/pager";

export const dynamic = "force-dynamic";

type Takedown = {
  removedListings?: string[];
  keptListingStatus?: string[];
  objects?: string[];
  stillReferenced?: string[];
  purged?: Record<string, number>;
};

function OpenNotice({ notice }: { notice: CopyrightNoticeRow }) {
  const targets = takedownTargets(notice.content_urls, copyrightHosts());
  return (
    <div className="jobrow">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="order__name">{notice.claimant_name}</span>
        <span className="order__meta">
          {notice.claimant_email} · {new Date(notice.created_at).toLocaleDateString()}
        </span>
      </div>
      {notice.rights_holder && <p className="order__meta mt-1">For {notice.rights_holder}</p>}
      <p className="mt-2 text-body">“{notice.work_description}”</p>
      <ul className="mt-2 grid gap-1">
        {notice.content_urls.map((url) => (
          <li key={url} className="order__meta !mb-0 break-all">
            <a href={url} target="_blank" rel="noreferrer noopener" className="jumplink">
              {url}
            </a>
          </li>
        ))}
      </ul>
      <div className="mt-2">
        <DataRow label="Listings found" value={targets.listingIds.length || "None"} />
        <DataRow label="Photos found" value={targets.mediaUrls.length || "None"} />
        {targets.other.length > 0 && (
          <DataRow
            label="Needs a look"
            value={targets.other.length}
            note="Links that aren't a listing or a photo: open them and paste their photo links below."
          />
        )}
        <DataRow label="Signed" value={notice.signature} note={notice.claimant_address} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <ActionDialog
          action={adminCopyrightTakedown}
          title="Take this content down"
          trigger="Take down"
          triggerClassName="relbtn !static"
          danger
          hidden={{
            notice_id: notice.id,
            listing_ids: targets.listingIds.join(" "),
            media_urls: targets.mediaUrls.join(" "),
          }}
          confirmNote={`Removes ${targets.listingIds.length} listing(s) from the marketplace and every photo of them, plus ${targets.mediaUrls.length} photo link(s) named, wherever DRVN holds them — galleries, avatars and the copy frozen on buyers' orders. The photos are deleted from storage and blocked from the image cache. The members are told why. Needs a fresh authenticator check.`}
          fields={[
            {
              kind: "text",
              name: "more",
              label: "More listings or photo links (optional)",
              hint: "Listing ids, listing pages or photo links, separated by spaces.",
            },
            { kind: "reason", label: "Note to the member and the audit log", placeholder: "Copyright notice from the photographer" },
          ]}
          submitLabel="Take down"
        />
        <ActionDialog
          action={adminRejectCopyrightNotice}
          title="Close this notice with no action"
          trigger="Reject"
          triggerClassName="relbtn !static"
          hidden={{ notice_id: notice.id }}
          confirmNote="For a notice that is incomplete or doesn't concern DRVN. Nothing is removed. Reply to the claimant yourself with the reason."
          fields={[{ kind: "reason", label: "Why (audit log)", placeholder: "No DRVN link, or the statements are missing" }]}
          submitLabel="Close notice"
        />
      </div>
    </div>
  );
}

function ClosedNotice({ notice }: { notice: CopyrightNoticeRow }) {
  const takedown = (notice.takedown ?? {}) as Takedown;
  return (
    <div className="jobrow">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex items-baseline gap-2">
          <span className={notice.status === "actioned" ? "chip chip--live" : "chip"}>{notice.status}</span>
          <span className="order__name">{notice.claimant_name}</span>
        </span>
        <span className="order__meta">
          {notice.resolved_at ? new Date(notice.resolved_at).toLocaleDateString() : ""}
        </span>
      </div>
      <p className="order__meta mt-1">“{notice.resolution_note}”</p>
      {notice.status === "actioned" && (
        <div className="mt-2">
          <DataRow label="Listings removed" value={takedown.removedListings?.length ?? 0} />
          <DataRow label="Photos removed" value={takedown.objects?.length ?? 0} />
          <DataRow label="From order snapshots" value={takedown.purged?.order_snapshot_photos ?? 0} />
          {(takedown.stillReferenced?.length ?? 0) > 0 && (
            <DataRow
              label="Still named elsewhere"
              value={takedown.stillReferenced?.length}
              note={takedown.stillReferenced?.join(", ")}
            />
          )}
        </div>
      )}
      {notice.status === "actioned" && (
        // #109: a valid counter-notice is recorded, then the content can be
        // reinstated 14 days after it arrived (20261110190000).
        <div className="mt-3 flex flex-wrap gap-2">
          <ActionDialog
            action={adminRecordCounterNotice}
            title="Record the member's counter-notice"
            trigger="Counter-notice"
            triggerClassName="relbtn !static"
            hidden={{ notice_id: notice.id }}
            confirmNote="As the member sent it: their name and address, their statement that the content was removed by mistake or misidentification, their consent to jurisdiction, and their signature. Send a copy to the claimant."
            fields={[
              { kind: "text", name: "member_name", label: "Member's name" },
              { kind: "text", name: "member_address", label: "Member's address" },
              { kind: "text", name: "statement", label: "Their statement", hint: "Why they say it was removed by mistake or misidentification." },
              { kind: "text", name: "signature", label: "Their signature" },
              { kind: "text", name: "received_on", label: "Arrived on", hint: "YYYY-MM-DD" },
              { kind: "select", name: "consents", label: "Consents to jurisdiction", placeholder: "Choose", options: [{ value: "yes", label: "Yes, it says so" }, { value: "no", label: "No" }] },
            ]}
            submitLabel="Record counter-notice"
          />
          <ActionDialog
            action={adminReinstateAfterCounterNotice}
            title="Reinstate after the counter-notice"
            trigger="Reinstate"
            triggerClassName="relbtn !static"
            hidden={{ notice_id: notice.id }}
            confirmNote="Only 14 days or more after the counter-notice arrived, and only if the claimant hasn't told us they've gone to court. The listings this notice removed go back to their sellers, paused; its photos come off the blocklist (any already deleted, the seller uploads again). Needs a fresh authenticator check."
            fields={[{ kind: "reason", label: "Note (audit log)", placeholder: "Counter-notice received 2 Nov; no court action notified" }]}
            submitLabel="Reinstate"
          />
        </div>
      )}
    </div>
  );
}

/**
 * Admin → Copyright (R69-dmca): notices filed from /copyright. A takedown
 * runs copyright_takedown (20261107231002): listings off the marketplace,
 * photos purged wherever they're held — order snapshots included — deleted
 * from storage and refused by the image proxy.
 */
export default async function AdminCopyrightPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; page?: string }>;
}) {
  const { view, page: pageParam } = await searchParams;
  const page = Math.max(0, Number.parseInt(pageParam ?? "0", 10) || 0);
  const [open, closed] = await Promise.all([getCopyrightNotices("open", page), getCopyrightNotices("closed", page)]);
  const href = (tab: "open" | "closed") => (target: number) =>
    `/admin/copyright?${new URLSearchParams({
      ...(tab === "closed" ? { view: "closed" } : {}),
      ...(target > 0 ? { page: String(target) } : {}),
    })}`;

  return (
    <>
      <PageHead
        reveal
        title="Copyright"
        sub="Notices from rights holders, oldest first. A complete notice gets a takedown; anything else is closed with a reply."
      />
      <SheetTabs
        label="Copyright notices"
        initialTab={view === "closed" ? "closed" : "open"}
        tabs={[
          {
            key: "open",
            label: "Open",
            count: open.total,
            live: open.total > 0,
            panel: open.rows.length ? (
              <>
                <div className="rowlist mt-4">
                  {open.rows.map((notice) => (
                    <OpenNotice key={notice.id} notice={notice} />
                  ))}
                </div>
                <Pager page={page} hasMore={open.hasMore} href={href("open")} prevLabel="← Back" nextLabel="More →" />
              </>
            ) : (
              <ConsoleEmpty className="mt-4" mark="—" title="No open notices" body="Notices sent from /copyright land here." />
            ),
          },
          {
            key: "closed",
            label: "Closed",
            panel: closed.rows.length ? (
              <>
                <div className="rowlist mt-4">
                  {closed.rows.map((notice) => (
                    <ClosedNotice key={notice.id} notice={notice} />
                  ))}
                </div>
                <Pager page={page} hasMore={closed.hasMore} href={href("closed")} prevLabel="← Newer" nextLabel="Older →" />
              </>
            ) : (
              <ConsoleEmpty className="mt-4" mark="—" title="No closed notices yet" body="Notices move here once taken down or rejected." />
            ),
          },
        ]}
      />
    </>
  );
}
