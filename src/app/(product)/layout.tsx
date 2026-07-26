import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

export default async function ProductLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Both preferences are cookies so the shell renders correctly server-side —
  // no flash of the wrong palette or a rail snapping open on hydration.
  const jar = await cookies();
  const night = jar.get("ls-theme")?.value === "night";
  const railOpen = jar.get("ls-rail")?.value !== "closed";

  return (
    <AppShell signedIn initialNight={night} initialRailOpen={railOpen}>
      {children}
    </AppShell>
  );
}
