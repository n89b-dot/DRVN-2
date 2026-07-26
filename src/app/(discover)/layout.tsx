import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { LivesheetBar } from "@/components/ui";

// Public discovery surfaces (Explore, Marketplace) share the product shell
// but are not auth-gated.
export default async function DiscoverLayout({ children }: { children: ReactNode }) {
  const night = (await cookies()).get("ls-theme")?.value === "night";

  return (
    <div className="min-h-screen">
      <LivesheetBar initialNight={night} />
      <main className="min-w-0">{children}</main>
    </div>
  );
}
