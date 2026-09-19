import { describe, expect, it } from "vitest";

import {
  BAR_ROUTES,
  FAMILY_KEYS,
  SELLING_FAMILY,
  isMarketplaceFamily,
  isSellingFamily,
  matchesFamily,
  PRIMARY_NAV,
  PUBLIC_ROUTES,
} from "./nav-routes";

describe("family membership", () => {
  it("puts every Selling route in the Selling family", () => {
    for (const route of SELLING_FAMILY) {
      expect(isSellingFamily(route.href), route.href).toBe(true);
    }
  });

  it("keeps Marketplace out of Selling, and vice versa", () => {
    expect(isSellingFamily("/marketplace")).toBe(false);
    expect(isMarketplaceFamily("/selling")).toBe(false);
    expect(isMarketplaceFamily("/marketplace")).toBe(true);
  });

  it("keeps non-family routes out", () => {
    for (const path of ["/home", "/explore", "/garage", "/messages", "/settings", "/sell", "/cart"]) {
      expect(isSellingFamily(path), path).toBe(false);
      expect(isMarketplaceFamily(path), path).toBe(false);
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
      "/selling",
      "/marketplace",
      "/marketplace/suspension",
      "/listings",
      "/listings/abc",
      "/listings/abc/edit",
      "/offers",
      "/offers/abc",
      "/orders",
      "/orders/abc",
      "/payouts",
    ];
    for (const path of paths) {
      const hits = FAMILY_KEYS.filter((key) => matchesFamily(path, key));
      expect(hits, `${path} matched ${hits.join(", ")}`).toHaveLength(1);
    }
  });
});

describe("the register", () => {
  it("calls the seller's register 'My Listings' so it can't be read as the public Marketplace", () => {
    const listings = SELLING_FAMILY.find((r) => r.href === "/listings");
    expect(listings?.label).toBe("My Listings");
  });

  /**
   * N-1. The rail's top level is a fixed order, and Garage sits above the
   * Selling family — the car is the middle of the product, Selling is a
   * workspace. Settings is account plumbing and stays last.
   */
  it("orders the top level Home · Explore · Marketplace · Garage · Selling · Messages · Profile", () => {
    const sellingChildren = new Set(SELLING_FAMILY.map((r) => r.href));
    const topLevel = PRIMARY_NAV.filter(
      (e) => e.kind === "group" || !sellingChildren.has(e.href)
    ).map((e) => (e.kind === "group" ? e.label : e.label));
    expect(topLevel).toEqual([
      "Home",
      "Explore",
      "Marketplace",
      "Garage",
      "Selling",
      "Messages",
      "Profile",
      "Settings",
    ]);
  });

  it("keeps Marketplace a plain top-level route — discovery, not operations", () => {
    const market = PRIMARY_NAV.find((e) => e.kind === "route" && e.href === "/marketplace");
    expect(market && "child" in market ? market.child : undefined).toBeFalsy();
  });

  it("exposes the Selling family's children directly, not behind the group", () => {
    const hrefs = BAR_ROUTES.map((r) => r.href);
    for (const route of SELLING_FAMILY) {
      expect(hrefs).toContain(route.href);
    }
  });

  it("heads the family with a non-link group so no child costs a second click", () => {
    const groupIndex = PRIMARY_NAV.findIndex((e) => e.kind === "group");
    expect(groupIndex).toBeGreaterThan(-1);
    const children = PRIMARY_NAV.slice(groupIndex + 1, groupIndex + 1 + SELLING_FAMILY.length);
    expect(children.map((c) => (c.kind === "route" ? c.href : null))).toEqual(
      SELLING_FAMILY.map((r) => r.href)
    );
    expect(children.every((c) => c.kind === "route" && c.child)).toBe(true);
  });

  it("never advertises private management surfaces to signed-out visitors", () => {
    const hrefs = PUBLIC_ROUTES.map((r) => r.href);
    for (const surface of ["/selling", "/listings", "/offers", "/orders", "/payouts"]) {
      expect(hrefs).not.toContain(surface);
    }
    expect(hrefs).toContain("/marketplace");
  });
});
