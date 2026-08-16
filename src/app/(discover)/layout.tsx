import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { AppShell } from "@/components/ui";
import { loadShellCounts } from "@/lib/shell-counts";
import { createClient } from "@/lib/supabase/server";

// Public discovery surfaces (Explore, Marketplace, car and listing sheets) are
// not auth-gated, but a signed-in visitor gets the same dashboard shell here as
// anywhere else — the rail follows you across the whole app.
export default async function DiscoverLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const jar = await cookies();
  const night = jar.get("ls-theme")?.value === "night";
  const railOpen = jar.get("ls-rail")?.value !== "closed";
  const mktOpen = jar.get("ls-mkt")?.value !== "closed";

  // `offersCount` used to be discarded here, so a signed-in visitor browsing
  // the public marketplace saw an unbadged Offers row while the same rail on
  // /orders showed the count. The loader already computes it for a signed-in
  // user (and short-circuits to 0 for a visitor) — the shell just has to pass
  // it on.
  const { cartCount, unreadCount, offersCount } = await loadShellCounts(
    supabase,
    user?.id ?? null
  );

  return (
    <AppShell
      signedIn={Boolean(user)}
      initialNight={night}
      initialRailOpen={railOpen}
      initialMktOpen={mktOpen}
      cartCount={cartCount}
      unreadCount={unreadCount}
      offersCount={offersCount}
    >
      {/* No blanket footer here — every (discover) page renders its own
          contextual page-level <Foot> (see src/components/ui/livesheet-bar.tsx)
          with page-specific left/right content, and stacking a second generic
          one under it read as two footers on one sheet. Two routes currently
          render no <Foot> at all — cars/[slug]/activity/[postId]/page.tsx and
          u/[username]/page.tsx — and so have no footer for now; their owners
          should add a page-level <Foot left="…" right={…} /> to match the
          rest of this route group. */}
      {children}
    </AppShell>
  );
}
