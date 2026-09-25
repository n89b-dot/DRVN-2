import { Suspense } from "react";

import { ButtonLink, LivesheetBar, PageHead, SuggestingSearchField } from "@/components/ui";
import { cartCount as getCartCount } from "@/lib/cart";
import { loadShellCounts } from "@/lib/shell-counts";
import { getPageClient, getViewer } from "@/lib/supabase/page-context";

export const metadata = { title: "Not found - DRVN" };

/**
 * Branded 404 for any URL outside a route group. It used to render the empty
 * state alone — no bar, no logo, the box flush against the top edge — so a
 * mistyped link looked like a crashed page. It carries the same session-aware
 * bar as the legal pages, so there is always a way back in.
 */
export default async function NotFound() {
  const [supabase, user, cartCount] = await Promise.all([getPageClient(), getViewer(), getCartCount()]);
  const counts = loadShellCounts(supabase, user?.id ?? null);

  return (
    <div className="min-h-screen">
      <Suspense fallback={<LivesheetBar signedIn={Boolean(user)} cartCount={cartCount} />}>
        {counts.then((values) => <LivesheetBar signedIn={Boolean(user)} {...values} />)}
      </Suspense>
      <main className="wrap pb-16">
        {/* A designed moment, not the dashed "not drawn yet" plate — that
            recipe is for empty collections inside a page. Recovery leads:
            search for what you were after, or take one of the two doors. */}
        <PageHead
          eyebrow="404"
          title="Nothing at this address."
          sub="That page doesn't exist, or whoever posted it has taken it down. Search for what you were after, or start from one of the two ways in."
        >
          <div className="notfound__actions">
            <form action="/explore" role="search" className="notfound__search">
              <SuggestingSearchField
                label="Search DRVN"
                placeholder="Search builds, parts, people"
                endpoint="/api/explore/suggest"
              />
            </form>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/explore">Explore builds</ButtonLink>
              <ButtonLink href="/marketplace">Shop parts</ButtonLink>
            </div>
          </div>
        </PageHead>
      </main>
    </div>
  );
}
