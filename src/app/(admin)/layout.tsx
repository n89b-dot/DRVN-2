import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { logout } from "@/app/(auth)/actions";
import { getAdminContext } from "@/lib/admin/guard";
import { getAdminIdentity, getNavCounts } from "@/lib/admin/queries";
import { cx } from "@/lib/format";

import { SlashFocus } from "@/components/ui/slash-focus";
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

  const [counts, identity, jar, userRes] = await Promise.all([
    getNavCounts(),
    getAdminIdentity(ctx.userId),
    cookies(),
    ctx.supabase.auth.getUser(),
  ]);
  // Same cookie the product shell reads, so the toggle renders the right icon
  // server-side — no flash of the wrong palette on hydration.
  const night = jar.get("ls-theme")?.value === "night";
  const identityLabel =
    identity.displayName ?? (identity.username ? `@${identity.username}` : (userRes.data.user?.email ?? "Signed in"));

  return (
    <div className="min-h-screen bg-paper">
      {/* Sticky: the nav carries the live queue badges — the console's only
          ambient alerting — so it must survive scrolling a long queue. */}
      {/* z-[60]: the nav's index sheet is fixed at z-55 — the bar (and its
          Close button) must ride above it, same as the product bar. */}
      <header className="sticky top-0 z-[60] border-b border-rule-soft bg-paper">
        <div className="wrap flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-section font-semibold tracking-tight">DRVN</span>
            <span className="microlabel !mb-0">Console</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-baseline gap-2" title={userRes.data.user?.email ?? undefined}>
              <span className="order__meta !mb-0">{identityLabel}</span>
              <span
                className={cx("chip", ctx.role === "viewer" ? "chip--warn" : "chip--ok")}
                title={
                  ctx.role === "viewer"
                    ? "This login can look, not act — every mutation is refused server-side."
                    : "This login can act — every mutation is audited."
                }
              >
                {ctx.role === "viewer" ? "read-only viewer" : "admin"}
              </span>
            </div>
            <Link href="/home" className="jumplink">
              ← Back to DRVN
            </Link>
            <form action={logout}>
              <button type="submit" className="btn">
                Sign out
              </button>
            </form>
            <AdminNav counts={counts} initialNight={night} />
          </div>
        </div>
      </header>
      <main className="wrap console-main py-8">
        {/* `/` jumps to the page's search — the console is a power-user surface. */}
        <SlashFocus />
        {children}
      </main>
    </div>
  );
}
