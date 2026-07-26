import { cookies } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";

import { Foot, LivesheetBar } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

/**
 * Policy pages. Reachable signed in or out, so the bar reflects whichever the
 * visitor is — a signed-out reader must not be shown authed navigation.
 */
export default async function LegalLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const jar = await cookies();
  const night = jar.get("ls-theme")?.value === "night";

  return (
    <div className="min-h-screen">
      <LivesheetBar signedIn={Boolean(user)} initialNight={night} />
      <main className="mx-auto w-full max-w-[720px] px-5 pb-10">
        {children}
        <Foot
          left="DRVN / Livesheet"
          right={
            <span className="flex flex-wrap gap-4">
              <Link href="/terms">Terms</Link>
              <Link href="/privacy">Privacy</Link>
              <Link href="/fees">Fees</Link>
            </span>
          }
        />
      </main>
    </div>
  );
}
