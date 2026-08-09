import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { getAdminContext } from "@/lib/admin/guard";

import { DocsBar } from "./_components/docs-bar";

/**
 * The design & documentation microsite. Gated exactly like the console: while
 * the product is in testing, non-admins — signed out or in — get the same 404
 * any unknown route renders, so the surface's existence isn't confirmed.
 * Structured (own chrome, content in docs/site/*.md, registry in
 * src/lib/docs/site.ts) so the whole group can lift onto a separate origin
 * later without touching the product app.
 *
 * Metadata is resolved conditionally for the same reason as (admin): a static
 * title would stamp itself on the 404 a non-admin sees.
 */
export async function generateMetadata() {
  const ctx = await getAdminContext();
  if (!ctx) return {};
  return {
    title: { default: "Docs - DRVN", template: "%s - DRVN Docs" },
    robots: { index: false, follow: false },
  };
}

export default async function DocsLayout({ children }: { children: ReactNode }) {
  const ctx = await getAdminContext();
  if (!ctx) notFound();

  const night = (await cookies()).get("ls-theme")?.value === "night";

  return (
    <div className="min-h-screen">
      <DocsBar initialNight={night} />
      <main className="wrap pb-10">
        {children}
        <footer className="foot">
          <span className="microlabel">DRVN — Design &amp; docs</span>
          <span className="microlabel">
            <span className="flex flex-wrap gap-4">
              <Link href="/docs/llms.txt">llms.txt</Link>
              <Link href="/docs/md/index">Markdown index</Link>
              <Link href="/admin">Console</Link>
            </span>
          </span>
        </footer>
      </main>
    </div>
  );
}
