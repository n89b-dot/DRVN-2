import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { AppShell, Foot, LivesheetBar } from "@/components/ui";
import { AgentPanel } from "@/features/agent/agent-panel";
import { agentStepOpen, agentTabOpen } from "@/lib/agent/beta";
import { loadShellCounts } from "@/lib/shell-counts";
import { cartCount as getCartCount } from "@/lib/cart";
import { getPageClient, getViewer } from "@/lib/supabase/page-context";

/**
 * Policy pages. Reachable signed in or out. A signed-in member gets the same
 * app shell as everywhere else (the rail, the bottom bar, the agent panel) —
 * terms and privacy used to drop them into the visitor's bar, so Settings →
 * Privacy policy lost the rail and the way back. A visitor gets the public
 * bar. Resolving the session opts these pages out of static prerendering (a
 * cookies() + auth read runs on every request), the deliberate trade for a
 * header that doesn't lie about whether you're signed in.
 */
export default async function LegalLayout({ children }: { children: ReactNode }) {
  const [supabase, user, cartCount, jar] = await Promise.all([getPageClient(), getViewer(), getCartCount(), cookies()]);
  const counts = loadShellCounts(supabase, user?.id ?? null);

  const page = (
    <div className="wrap wrap--narrow pb-10">
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
    </div>
  );

  if (user) {
    const agentTab = await agentTabOpen();
    const agentPanel = agentTab && (await agentStepOpen("chat"));
    return (
      <AppShell
        signedIn
        initialNight={jar.get("ls-theme")?.value === "night"}
        initialRailOpen={jar.get("ls-rail")?.value !== "closed"}
        initialMktOpen={jar.get("ls-mkt")?.value !== "closed"}
        cartCount={cartCount}
        counts={counts}
        agentTab={agentTab}
        aside={agentPanel ? <AgentPanel /> : null}
        initialPanel={jar.get("ls-panel")?.value ?? null}
      >
        {page}
      </AppShell>
    );
  }

  return (
    <div className="min-h-screen">
      <Suspense fallback={<LivesheetBar signedIn={false} cartCount={cartCount} />}>
        {counts.then((values) => <LivesheetBar signedIn={false} {...values} />)}
      </Suspense>
      <main>{page}</main>
    </div>
  );
}
