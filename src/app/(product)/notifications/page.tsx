import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot, NarrowColumn } from "@/components/ui";
import { prefEnabled, prefKeyForKind } from "@/lib/notification-prefs";
import { createClient } from "@/lib/supabase/server";

import { MarkAllRead } from "./mark-all-read";

export const metadata = { title: "Notifications - DRVN" };

type Row = {
  id: string;
  kind: string;
  section: string;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
};

function Section({
  label,
  rows,
  empty,
}: {
  label: string;
  rows: Row[];
  empty: string;
}) {
  const unread = rows.filter((r) => !r.read_at).length;

  return (
    <Rv className="tile">
      <div className="tile__head">
        <span className="microlabel microlabel--ink">{label}</span>
        {unread > 0 ? (
          <span className="chip chip--live">{unread} new</span>
        ) : (
          rows.length > 0 && <span className="chip">{rows.length}</span>
        )}
      </div>
      {rows.length > 0 ? (
        <ul className="feed">
          {rows.map((row) => {
            const content = (
              <span className="min-w-0 flex-1">
                <span className={row.read_at ? "block" : "block font-medium"}>
                  {row.title}
                  {!row.read_at && (
                    <span className="microlabel--live ml-2" aria-label="unread">
                      ●
                    </span>
                  )}
                </span>
                {row.body && <span className="order__meta block">{row.body}</span>}
              </span>
            );

            return (
              <li key={row.id}>
                <time dateTime={row.created_at}>
                  {new Date(row.created_at).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                  })}
                </time>
                {row.href ? (
                  <Link href={row.href} className="min-w-0 flex-1 transition-colors hover:text-live">
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="py-2 font-mono text-[12.5px] uppercase tracking-[0.1em] text-dim">{empty}</p>
      )}
    </Rv>
  );
}

/**
 * Reads the real `notifications` table (migration 0009). Previously this page
 * derived four event types at read time from `follows` and `saves`, so nothing
 * commerce-related could ever appear — a seller was never told a question had
 * been asked or an offer made — and there was no unread state.
 */
export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: rows, error }, { data: me }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, kind, section, title, body, href, read_at, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("profiles").select("notification_prefs").eq("id", user.id).maybeSingle(),
  ]);

  if (error) {
    console.error("[notifications] failed to load", error);
    throw new Error("Could not load your notifications");
  }

  const prefs = me?.notification_prefs;
  const visible = (rows ?? []).filter((row) => {
    const key = prefKeyForKind(row.kind);
    return key ? prefEnabled(prefs, key) : true;
  });

  const engagement = visible.filter((r) => r.section === "engagement");
  const marketplace = visible.filter((r) => r.section === "marketplace");
  const unreadTotal = visible.filter((r) => !r.read_at).length;

  return (
    <NarrowColumn>
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          Notifications
          {unreadTotal > 0 && (
            <>
              {" · "}
              <span className="microlabel--live">{unreadTotal} unread</span>
            </>
          )}
        </span>
        <h1>
          While you were <span className="live-word">away.</span>
        </h1>
        <p className="sub">
          Activity on your builds in one list, marketplace business in the other — so an offer
          never buries a comment on your car.
        </p>
        {unreadTotal > 0 && (
          <div className="mt-4">
            <MarkAllRead />
          </div>
        )}
      </Rv>

      <div className="deck">
        <Section
          label="Your builds — people and posts"
          rows={engagement}
          empty="Quiet — follows, saves, comments and reviews land here"
        />
        <Section
          label="Marketplace — offers, sales and questions"
          rows={marketplace}
          empty="Quiet — offers, sales, questions and dispatch updates land here"
        />
      </div>

      <Foot
        left="DRVN — notifications"
        right={<Link href="/settings#signals">Choose what notifies you →</Link>}
      />
    </NarrowColumn>
  );
}
