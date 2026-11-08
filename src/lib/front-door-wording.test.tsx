import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/marketplace", useRouter: () => ({ push: vi.fn() }) }));

import { LivesheetBar } from "@/components/ui";
import { categoryMetadata } from "@/lib/marketplace/metadata";

import { metadata as marketplaceMetadata } from "@/app/(discover)/marketplace/page";
import { metadata as landingMetadata } from "@/app/page";

const PHRASE = /parts marketplace for modified cars/i;

// F-2 (PRD 2026-09, revised 2026-10-17 with F-1): the lockup keeps its two
// words, the front door says what DRVN is, and the marketplace's own routes
// keep speaking as a marketplace.
describe("front-door wording (F-2)", () => {
  it("keeps the lockup as “Builds and parts”, signed in and signed out", () => {
    for (const signedIn of [true, false]) {
      const html = renderToStaticMarkup(<LivesheetBar signedIn={signedIn} />);
      const logo = html.match(/<a[^>]*class="bar__logo"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "";
      expect(logo).toContain("Builds and parts");
    }
  });

  it("says “parts marketplace for modified cars” in the landing title and description", () => {
    expect(String(landingMetadata.title)).toMatch(PHRASE);
    expect(landingMetadata.description).toMatch(PHRASE);
    expect(landingMetadata.openGraph?.title).toMatch(PHRASE);
  });

  it("keeps marketplace wording on the marketplace and its category routes", () => {
    expect(String(marketplaceMetadata.title)).toMatch(/^Marketplace/);
    expect(marketplaceMetadata.description).toMatch(/parts for modified cars/i);
    expect(marketplaceMetadata.openGraph?.title).toMatch(/Marketplace/);

    const category = categoryMetadata("suspension");
    expect(String(category.title)).toMatch(/DRVN Marketplace$/);
    expect(category.description).toMatch(/from modified cars/);
    // An unknown slug still reads as the marketplace, not the site tagline.
    expect(String(categoryMetadata("no-such-category").title)).toBe("Marketplace - DRVN");
  });
});
