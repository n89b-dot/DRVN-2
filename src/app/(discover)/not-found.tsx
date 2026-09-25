import { ButtonLink, PageHead, SuggestingSearchField } from "@/components/ui";

export const metadata = { title: "Not found - DRVN" };

/** Discovery-scoped 404: keeps the shell, leads with search, then the two
 *  doors — the same designed page as the root 404, not the dashed empty
 *  plate (that recipe is for empty collections inside a page). */
export default function DiscoverNotFound() {
  return (
    <div className="wrap pb-16">
      <PageHead
        eyebrow="404"
        title="Nothing at this address."
        sub="This car, part or profile isn't around — it may have sold, been taken down, or never existed. Search for what you were after."
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
    </div>
  );
}
