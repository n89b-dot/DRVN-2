import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { Foot, LivesheetBar } from "@/components/ui";
import { loadShellCounts } from "@/lib/shell-counts";
import { cartCount as getCartCount } from "@/lib/cart";
import { getPageClient, getViewer } from "@/lib/supabase/page-context";

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
  const [supabase, user, cartCount] = await Promise.all([getPageClient(), getViewer(), getCartCount()]);
  const counts = loadShellCounts(supabase, user?.id ?? null);

  return (
    <div className="min-h-screen">
      <Suspense fallback={<LivesheetBar signedIn={Boolean(user)} cartCount={cartCount} />}>
        {counts.then(values => <LivesheetBar signedIn={Boolean(user)} {...values} />)}
      </Suspense>
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
