import { cookies } from "next/headers";
import Link from "next/link";
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

  const { cartCount, unreadCount } = await loadShellCounts(supabase, user?.id ?? null);

  return (
    <AppShell
      signedIn={Boolean(user)}
      initialNight={night}
      initialRailOpen={railOpen}
      cartCount={cartCount}
      unreadCount={unreadCount}
    >
      {children}
      <footer className="wrap flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-[color:var(--rule-soft)] py-6">
        <span className="microlabel">© {new Date().getFullYear()} DRVN</span>
        <Link href="/terms" className="microlabel transition-colors hover:text-ink">
          Terms
        </Link>
        <Link href="/privacy" className="microlabel transition-colors hover:text-ink">
          Privacy
        </Link>
        <Link href="/fees" className="microlabel transition-colors hover:text-ink">
          Fees
        </Link>
      </footer>
    </AppShell>
  );
}
