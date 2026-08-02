import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { getAdminContext } from "@/lib/admin/guard";
import { getNavCounts } from "@/lib/admin/queries";

import { AdminNav } from "./admin/_components/admin-nav";

/**
 * Metadata must not leak the console's existence: a static `title` here would
 * stamp "Console - DRVN" on the 404 a non-admin sees, confirming the route.
 * Resolve it conditionally — non-admins get nothing, so the not-found page
 * keeps its own metadata. getAdminContext is request-cached, so this and the
 * layout gate share one lookup.
 */
export async function generateMetadata() {
  const ctx = await getAdminContext();
  if (!ctx) return {};
  return { title: "Console - DRVN", robots: { index: false, follow: false } };
}

/**
 * The admin gate. Non-admins — signed out, signed in, whoever — get a real
 * 404: the same not-found page any unknown route renders, so the console's
 * existence is not confirmed by a 403. The layout check is convenience; every
 * server action re-verifies membership itself (src/lib/admin/actions.ts), and
 * the database enforces reads via is_admin() policies regardless.
 *
 * Deliberately NOT the product AppShell: the console is its own surface with
 * its own nav, structured so the whole (admin) group could lift onto a
 * separate origin behind Cloudflare Access without touching the product app.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const ctx = await getAdminContext();
  if (!ctx) notFound();

  const counts = await getNavCounts();

  return (
    <div className="min-h-screen bg-paper">
      {/* Sticky: the nav carries the live queue badges — the console's only
          ambient alerting — so it must survive scrolling a long queue. */}
      <header className="sticky top-0 z-40 border-b border-rule-soft bg-paper">
        <div className="wrap flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-[19px] font-semibold tracking-tight">DRVN</span>
            <span className="microlabel !mb-0">Console</span>
            {ctx.role === "viewer" && (
              <span className="chip chip--warn" title="This login can look, not act — every mutation is refused server-side.">
                read-only
              </span>
            )}
          </div>
          <AdminNav counts={counts} />
        </div>
      </header>
      <main className="wrap console-main py-8">{children}</main>
    </div>
  );
}
