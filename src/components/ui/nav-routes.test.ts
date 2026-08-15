import { describe, expect, it } from "vitest";

import {
  BAR_ROUTES,
  FAMILY_KEYS,
  isMarketplaceFamily,
  MARKETPLACE_FAMILY,
  matchesFamily,
  PRIMARY_NAV,
  PUBLIC_ROUTES,
} from "./nav-routes";

describe("Marketplace family membership", () => {
  it("puts every family route in the family", () => {
    for (const route of MARKETPLACE_FAMILY) {
      expect(isMarketplaceFamily(route.href)).toBe(true);
    }
  });

  it("keeps non-family routes out", () => {
    for (const path of ["/home", "/explore", "/garage", "/messages", "/settings", "/sell", "/cart"]) {
      expect(isMarketplaceFamily(path)).toBe(false);
    }
  });

  it("reads a public part sheet as Marketplace, not the seller's Listings", () => {
    const sheet = "/listings/3f7a1c9e-0000-4000-8000-000000000000";
    expect(matchesFamily(sheet, "marketplace")).toBe(true);
    expect(matchesFamily(sheet, "listings")).toBe(false);
  });

  it("reads the seller's own register and edit view as Listings", () => {
    expect(matchesFamily("/listings", "listings")).toBe(true);
    expect(matchesFamily("/listings/abc/edit", "listings")).toBe(true);
    expect(matchesFamily("/listings", "marketplace")).toBe(false);
  });

  it("reads detail routes as their own family member", () => {
    expect(matchesFamily("/offers/abc", "offers")).toBe(true);
    expect(matchesFamily("/orders/abc", "orders")).toBe(true);
    expect(matchesFamily("/orders/abc/checkout", "orders")).toBe(true);
  });

  it("reads category routes as Marketplace", () => {
    expect(matchesFamily("/marketplace/suspension", "marketplace")).toBe(true);
    expect(matchesFamily("/marketplace/suspension/coilovers", "marketplace")).toBe(true);
  });

  it("never matches two family members at once", () => {
    const paths = [
      "/marketplace",
      "/marketplace/suspension",
      "/listings",
      "/listings/abc",
      "/listings/abc/edit",
      "/offers",
      "/offers/abc",
      "/orders",
      "/orders/abc",
    ];
    for (const path of paths) {
      const hits = FAMILY_KEYS.filter((key) => matchesFamily(path, key));
      expect(hits, `${path} matched ${hits.join(", ")}`).toHaveLength(1);
    }
  });
});

describe("the register", () => {
  it("exposes the family's children directly, not behind Marketplace", () => {
    const hrefs = BAR_ROUTES.map((r) => r.href);
    for (const route of MARKETPLACE_FAMILY) {
      expect(hrefs).toContain(route.href);
    }
  });

  it("heads the family with a non-link group so no child costs a second click", () => {
    const groupIndex = PRIMARY_NAV.findIndex((e) => e.kind === "group");
    expect(groupIndex).toBeGreaterThan(-1);
    const children = PRIMARY_NAV.slice(groupIndex + 1, groupIndex + 1 + MARKETPLACE_FAMILY.length);
    expect(children.map((c) => (c.kind === "route" ? c.href : null))).toEqual(
      MARKETPLACE_FAMILY.map((r) => r.href)
    );
    expect(children.every((c) => c.kind === "route" && c.child)).toBe(true);
  });

  it("never advertises private management surfaces to signed-out visitors", () => {
    const hrefs = PUBLIC_ROUTES.map((r) => r.href);
    expect(hrefs).not.toContain("/listings");
    expect(hrefs).not.toContain("/offers");
    expect(hrefs).not.toContain("/orders");
    expect(hrefs).toContain("/marketplace");
  });
});
