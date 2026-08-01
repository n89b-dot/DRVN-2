import Link from "next/link";
import type { ReactNode } from "react";

import { Foot, LivesheetBar } from "@/components/ui";

/**
 * Policy pages. Reachable signed in or out, and — unlike the product and
 * discover shells — they don't need to know which: they await nothing, so
 * this layout reads no cookies and does no auth check, which keeps
 * terms/privacy/fees statically prerenderable. The bar renders its
 * signed-out (public) variant here; a signed-in visitor still reaches every
 * destination through the rail on any other page. Theme (day/night) is
 * applied client-side before paint by the inline script in the root layout
 * (src/app/layout.tsx), so no cookie read is needed for that either.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <LivesheetBar signedIn={false} />
      <main className="mx-auto w-full max-w-[720px] px-5 pb-10">
        {children}
        <Foot
          left="DRVN"
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
