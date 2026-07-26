import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { AppShell } from "@/components/ui";
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

  return (
    <AppShell signedIn={Boolean(user)} initialNight={night} initialRailOpen={railOpen}>
      {children}
    </AppShell>
  );
}
