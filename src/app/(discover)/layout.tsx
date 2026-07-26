import type { ReactNode } from "react";

import { AppSidebar } from "@/components/ui";

// Public discovery surfaces (Explore, Marketplace) share the product shell
// but are not auth-gated.
export default function DiscoverLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-app">
      <AppSidebar />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
