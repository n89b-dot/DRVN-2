import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/ui";
import { AgentPanel } from "@/features/agent/agent-panel";
import { agentStepOpen, agentTabOpen } from "@/lib/agent/beta";
import { LiveInbox } from "@/features/commerce/live-messages";
import { cartCount as getCartCount } from "@/lib/cart";
import { loadShellCounts } from "@/lib/shell-counts";
import { getPageClient as createClient, getViewer } from "@/lib/supabase/page-context";

export default async function ProductLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const user = await getViewer();

  if (!user) {
    redirect("/login");
  }

  // Every member has a handle. An account that skipped onboarding had a
  // /u/null profile yet could post, buy and sell; send it back to finish.
  // N40: so does an account with no profile row at all (a Google sign-in the
  // profile trigger skipped while invitations were enforced): it used to pass
  // straight through to pages that assume a profile. A failed read is not
  // "no profile", so it never sends anyone to onboarding.
  const { data: me, error: meError } = await supabase.from("profiles").select("username").eq("id", user.id).maybeSingle();
  if (!meError && !me?.username) redirect("/onboarding");

  // Both preferences are cookies so the shell renders correctly server-side —
  // no flash of the wrong palette or a rail snapping open on hydration.
  const jar = await cookies();
  const night = jar.get("ls-theme")?.value === "night";
  const railOpen = jar.get("ls-rail")?.value !== "closed";
  const mktOpen = jar.get("ls-mkt")?.value !== "closed";

  const counts = loadShellCounts(supabase, user?.id ?? null);
  const cartCount = await getCartCount();
  const agentTab = await agentTabOpen();
  // The agent beside the page on desktop (A3c), once the chat step is open.
  const agentPanel = agentTab && (await agentStepOpen("chat"));

  return (
    <AppShell
      signedIn
      initialNight={night}
      initialRailOpen={railOpen}
      initialMktOpen={mktOpen}
      cartCount={cartCount}
      counts={counts}
      agentTab={agentTab}
      aside={agentPanel ? <AgentPanel /> : null}
      initialPanel={jar.get("ls-panel")?.value ?? null}
    >
      {children}
      {/* Keeps the Messages badge live when someone writes (realtime). */}
      <LiveInbox userId={user.id} />
    </AppShell>
  );
}
