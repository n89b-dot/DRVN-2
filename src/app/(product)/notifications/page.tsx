import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot, NarrowColumn } from "@/components/ui";
import { prefEnabled, prefKeyForKind } from "@/lib/notification-prefs";
import { createClient } from "@/lib/supabase/server";

import { MarkAllRead } from "./mark-all-read";
import { reportError } from "@/lib/monitoring";

export const metadata = { title: "Notifications - DRVN" };

const PAGE_SIZE = 25;

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

type SectionFilter = "engagement" | "marketplace";

function withParams(
  params: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `/notifications?${query}` : "/notifications";
}

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
                  // Routed through /notifications/open/[id] so opening a row
                  // is also the read receipt, without turning every row into
                  // a form (a plain link keeps middle-click / new-tab working).
                  <Link
                    href={`/notifications/open/${row.id}`}
                    className="min-w-0 flex-1 transition-colors hover:text-live"
                  >
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
 * Reads the real `notifications` table (migration 0009).
 *
 * Filters (`?filter=unread`, `?section=`) and pagination (`?page=`, 25/page)
 * are applied at the query level. Preference filtering (a user can mute a
 * kind entirely) still happens in memory afterwards, since it depends on a
 * JSON column rather than a plain filterable one — the one place a page can
 * come back with fewer than 25 rows even though more exist.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; section?: string; page?: string }>;
}) {
  const { filter, section: sectionParam, page: pageParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const unreadOnly = filter === "unread";
  const section: SectionFilter | undefined =
    sectionParam === "engagement" || sectionParam === "marketplace" ? sectionParam : undefined;
  const page = Math.max(1, Number(pageParam) || 1);
  const from = (page - 1) * PAGE_SIZE;

  let query = supabase
    .from("notifications")
    .select("id, kind, section, title, body, href, read_at, created_at", { count: "exact" })
    .eq("user_id", user.id);
  if (unreadOnly) query = query.is("read_at", null);
  if (section) query = query.eq("section", section);
  query = query.order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);

  const [{ data: rows, count, error }, { data: me }, { count: totalUnreadCount }] =
    await Promise.all([
      query,
      supabase.from("profiles").select("notification_prefs").eq("id", user.id).maybeSingle(),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .is("read_at", null),
    ]);

  if (error) {
    reportError("[notifications] failed to load", error);
    throw new Error("Could not load your notifications");
  }

  const prefs = me?.notification_prefs;
  const visible = (rows ?? []).filter((row) => {
    const key = prefKeyForKind(row.kind);
    return key ? prefEnabled(prefs, key) : true;
  });

  const engagement = visible.filter((r) => r.section === "engagement");
  const marketplace = visible.filter((r) => r.section === "marketplace");
  const unreadTotal = totalUnreadCount ?? 0;
  const total = count ?? 0;
  const hasMore = from + PAGE_SIZE < total;

  const params = {
    filter: unreadOnly ? "unread" : undefined,
    section,
  };

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

      <div className="filters" role="group" aria-label="Filter notifications">
        <span className="microlabel filters__label">Show</span>
        <Link
          href={withParams(params, { filter: undefined, page: undefined })}
          className={`fbtn ${!unreadOnly ? "is-on" : ""}`}
          aria-current={!unreadOnly ? "true" : undefined}
        >
          All
        </Link>
        <Link
          href={withParams(params, { filter: "unread", page: undefined })}
          className={`fbtn ${unreadOnly ? "is-on" : ""}`}
          aria-current={unreadOnly ? "true" : undefined}
        >
          Unread
        </Link>
        <span className="mx-1 text-dim" aria-hidden="true">
          ·
        </span>
        <Link
          href={withParams(params, { section: undefined, page: undefined })}
          className={`fbtn ${!section ? "is-on" : ""}`}
          aria-current={!section ? "true" : undefined}
        >
          Both
        </Link>
        <Link
          href={withParams(params, { section: "engagement", page: undefined })}
          className={`fbtn ${section === "engagement" ? "is-on" : ""}`}
          aria-current={section === "engagement" ? "true" : undefined}
        >
          Your builds
        </Link>
        <Link
          href={withParams(params, { section: "marketplace", page: undefined })}
          className={`fbtn ${section === "marketplace" ? "is-on" : ""}`}
          aria-current={section === "marketplace" ? "true" : undefined}
        >
          Marketplace
        </Link>
      </div>

      <div className="deck">
        {(!section || section === "engagement") && (
          <Section
            label="Your builds — people and posts"
            rows={engagement}
            empty={
              unreadOnly
                ? "No unread activity here"
                : "Quiet — follows, saves, comments and reviews land here"
            }
          />
        )}
        {(!section || section === "marketplace") && (
          <Section
            label="Marketplace — offers, sales and questions"
            rows={marketplace}
            empty={
              unreadOnly
                ? "No unread marketplace activity"
                : "Quiet — offers, sales, questions and dispatch updates land here"
            }
          />
        )}
      </div>

      {(page > 1 || hasMore) && (
        <nav className="mt-6 flex items-center justify-between gap-3" aria-label="Pagination">
          {page > 1 ? (
            <Link
              href={withParams(params, { page: page - 1 === 1 ? undefined : String(page - 1) })}
              className="btn btn--ghost"
              rel="prev"
            >
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="microlabel">Page {page}</span>
          {hasMore ? (
            <Link
              href={withParams(params, { page: String(page + 1) })}
              className="btn btn--ghost"
              rel="next"
            >
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      <Foot
        left="DRVN — notifications"
        right={<Link href="/settings#signals">Choose what notifies you →</Link>}
      />
    </NarrowColumn>
  );
}
