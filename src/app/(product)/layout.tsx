import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { LivesheetBar } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

export default async function ProductLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const night = (await cookies()).get("ls-theme")?.value === "night";

  return (
    <div className="min-h-screen">
      <LivesheetBar initialNight={night} />
      <main className="min-w-0">{children}</main>
    </div>
  );
}
