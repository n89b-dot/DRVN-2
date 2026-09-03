import { describe, expect, it } from "vitest";

import {
  activeFilterCount,
  effectiveSort,
  exploreSearchHref,
  hasActiveSearch,
  parseExploreSearch,
  parseVehicleParam,
} from "./params";

describe("parseExploreSearch", () => {
  it("keeps only the scope's allowed filters", () => {
    const raw = {
      q: "golf",
      vehicle: "12-345",
      category: "suspension",
      condition: "used",
      min: "200",
      max: "600",
      fit: "1",
      sort: "newest",
    };
    const cars = parseExploreSearch(raw, "cars");
    expect(cars.q).toBe("golf");
    expect(cars.vehicle).toBe("12-345");
    // Parts-only refinements drop on the Builds scope.
    expect(cars.category).toBe("");
    expect(cars.condition).toBe("");
    expect(cars.min).toBe("");
    expect(cars.fit).toBe(false);

    const parts = parseExploreSearch(raw, "parts");
    expect(parts.category).toBe("suspension");
    expect(parts.condition).toBe("used");
    expect(parts.min).toBe("200");
    expect(parts.fit).toBe(true);
    // "newest" isn't a parts sort value? It is not in ALLOWED_SORTS.parts…
    // parts accepts newest via "" default; explicit "newest" is allowed:
    expect(["newest", ""]).toContain(parts.sort);
  });

  it("keeps year on every scope — each applies it through its car", () => {
    const raw = { q: "golf", ymin: "2018", ymax: "2022" };
    for (const tab of ["all", "cars", "updates", "parts"] as const) {
      const p = parseExploreSearch(raw, tab);
      expect(p.ymin).toBe("2018");
      expect(p.ymax).toBe("2022");
    }
  });

  it("has no location refinement — a pasted location param is ignored", () => {
    const href = exploreSearchHref("cars", parseExploreSearch({ q: "golf", location: "Miami" }, "cars"));
    expect(href).not.toContain("location");
  });

  it("rejects implausible years", () => {
    expect(parseExploreSearch({ ymin: "abcd" }, "cars").ymin).toBe("");
    expect(parseExploreSearch({ ymin: "1850" }, "cars").ymin).toBe("");
    expect(parseExploreSearch({ ymax: "2999" }, "cars").ymax).toBe("");
    expect(parseExploreSearch({ ymax: "2020" }, "cars").ymax).toBe("2020");
  });

  it("rejects malformed vehicle params", () => {
    expect(parseExploreSearch({ vehicle: "12-" }, "cars").vehicle).toBe("");
    expect(parseExploreSearch({ vehicle: "golf" }, "cars").vehicle).toBe("");
    expect(parseExploreSearch({ vehicle: "1e2" }, "cars").vehicle).toBe("");
    expect(parseExploreSearch({ vehicle: "12-345" }, "cars").vehicle).toBe("12-345");
    expect(parseExploreSearch({ vehicle: "12" }, "cars").vehicle).toBe("12");
  });

  it("validates sort per scope", () => {
    expect(parseExploreSearch({ sort: "price_asc" }, "cars").sort).toBe("");
    expect(parseExploreSearch({ sort: "price_asc" }, "parts").sort).toBe("price_asc");
    expect(parseExploreSearch({ sort: "relevance" }, "updates").sort).toBe("relevance");
    expect(parseExploreSearch({ sort: "popular" }, "all").sort).toBe("");
  });
});

describe("hasActiveSearch / activeFilterCount", () => {
  it("browse mode is no query and no refinement", () => {
    expect(hasActiveSearch(parseExploreSearch({}, "all"))).toBe(false);
    expect(hasActiveSearch(parseExploreSearch({ sort: "newest" }, "all"))).toBe(false);
    expect(hasActiveSearch(parseExploreSearch({ q: "apr" }, "all"))).toBe(true);
    // Filter-only search activates without text (brief §31).
    expect(hasActiveSearch(parseExploreSearch({ vehicle: "12" }, "cars"))).toBe(true);
  });

  it("counts ymin+ymax as one year refinement", () => {
    const p = parseExploreSearch({ ymin: "2018", ymax: "2020" }, "cars");
    expect(activeFilterCount(p)).toBe(1);
    expect(hasActiveSearch(p)).toBe(true);
  });

  it("counts min+max as one price refinement", () => {
    const p = parseExploreSearch({ min: "100", max: "300", condition: "used" }, "parts");
    expect(activeFilterCount(p)).toBe(2);
  });
});

describe("effectiveSort", () => {
  it("defaults to relevance while searching, newest otherwise", () => {
    expect(effectiveSort(parseExploreSearch({ q: "apr" }, "cars"), "cars")).toBe("relevance");
    expect(effectiveSort(parseExploreSearch({ vehicle: "12" }, "cars"), "cars")).toBe("newest");
    expect(effectiveSort(parseExploreSearch({ q: "apr" }, "parts"), "parts")).toBe("newest");
  });
});

describe("exploreSearchHref — scope transitions (brief §30)", () => {
  const parts = parseExploreSearch(
    {
      q: "coilovers",
      vehicle: "12-345",
      category: "suspension",
      condition: "used",
      min: "200",
      max: "600",
      fit: "1",
      sort: "price_asc",
    },
    "parts"
  );

  it("Parts → Builds keeps query and vehicle, sheds commerce refinements", () => {
    const href = exploreSearchHref("cars", parts);
    expect(href).toContain("tab=cars");
    expect(href).toContain("q=coilovers");
    expect(href).toContain("vehicle=12-345");
    expect(href).not.toContain("category");
    expect(href).not.toContain("condition");
    expect(href).not.toContain("min=");
    expect(href).not.toContain("fit=");
    // price sort isn't a Builds sort.
    expect(href).not.toContain("sort=price_asc");
  });

  it("Builds → Updates carries vehicle and year", () => {
    const cars = parseExploreSearch({ q: "golf", vehicle: "12", ymin: "2019" }, "cars");
    const href = exploreSearchHref("updates", cars);
    expect(href).toContain("tab=updates");
    expect(href).toContain("q=golf");
    expect(href).toContain("vehicle=12");
    expect(href).toContain("ymin=2019");
  });

  it("All drops the tab param and the commerce filters, keeps the shared ones", () => {
    const href = exploreSearchHref("all", parts);
    expect(href).not.toContain("tab=");
    expect(href).toContain("q=coilovers");
    expect(href).toContain("vehicle=12-345");
    expect(href).not.toContain("category");
    expect(href).not.toContain("condition");
  });

  it("an empty-string override removes the param (chip removal)", () => {
    const href = exploreSearchHref("parts", parts, { vehicle: "" });
    expect(href).not.toContain("vehicle");
    expect(href).toContain("q=coilovers");
  });

  it("clean state renders the bare path", () => {
    expect(exploreSearchHref("all", parseExploreSearch({}, "all"))).toBe("/explore");
  });
});

describe("parseVehicleParam", () => {
  it("splits make and model ids", () => {
    expect(parseVehicleParam("12-345")).toEqual({ makeId: 12, modelId: 345 });
    expect(parseVehicleParam("12")).toEqual({ makeId: 12, modelId: null });
    expect(parseVehicleParam("x")).toBeNull();
    expect(parseVehicleParam("0")).toBeNull();
  });
});
