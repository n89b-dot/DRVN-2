import Link from "next/link";
import type { ReactNode } from "react";

import { Foot, LivesheetBar } from "@/components/ui";
import { loadShellCounts } from "@/lib/shell-counts";
import { createClient } from "@/lib/supabase/server";

/**
 * Policy pages. Reachable signed in or out — mirrors how (discover)/layout.tsx
 * resolves the session, so a signed-in visitor gets the signed-in bar (their
 * cart/notification badges, "List a part" instead of "Join DRVN") here too,
 * instead of being shown "Sign in / Join DRVN" while already signed in. This
 * opts terms/privacy/fees out of static prerendering (a cookies() + auth read
 * now runs on every request), which is the deliberate trade for a header that
 * doesn't lie about whether you're signed in.
 */
export default async function LegalLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { cartCount, unreadCount } = await loadShellCounts(supabase, user?.id ?? null);

  return (
    <div className="min-h-screen">
      <LivesheetBar signedIn={Boolean(user)} cartCount={cartCount} unreadCount={unreadCount} />
      <main className="wrap wrap--narrow pb-10">
        {children}
        <Foot
          left="DRVN"
          right={
            <span className="flex flex-wrap gap-4">
              <Link href="/terms">Terms</Link>
              <Link href="/privacy">Privacy</Link>
              <Link href="/fees">Fees</Link>
              <Link href="/protection">Protection</Link>
            </span>
          }
        />
      </main>
    </div>
  );
}
