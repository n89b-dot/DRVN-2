import { describe, expect, it } from "vitest";

import {
  dollarsToCents,
  humanizeService,
  mapRates,
  mapTracker,
  mapTrackingState,
} from "./easypost";
import { resolveShippingMode, ShippingConfigError } from "./provider";
import { stubShippingProvider } from "./stub";

const FLAG_ON = { FLAG_INTEGRATED_SHIPPING_V1: "true" };

describe("resolveShippingMode", () => {
  it("is disabled everywhere while the rollout flag is off", () => {
    expect(resolveShippingMode({})).toBe("disabled");
    expect(
      resolveShippingMode({ EASYPOST_API_KEY: "EZTK_x", SHIPPING_MODE: "easypost" }),
    ).toBe("disabled");
  });

  it("selects easypost when the key is present", () => {
    expect(resolveShippingMode({ ...FLAG_ON, EASYPOST_API_KEY: "EZTK_x" })).toBe("easypost");
    expect(
      resolveShippingMode({ ...FLAG_ON, EASYPOST_API_KEY: "EZTK_x", SHIPPING_MODE: "easypost" }),
    ).toBe("easypost");
  });

  it("refuses easypost mode without a key", () => {
    expect(() => resolveShippingMode({ ...FLAG_ON, SHIPPING_MODE: "easypost" })).toThrow(
      ShippingConfigError,
    );
  });

  it("defaults to stub outside production, disabled in production", () => {
    expect(resolveShippingMode({ ...FLAG_ON })).toBe("stub");
    // Missing key in production disables DRVN Shipping (sellers fall back to
    // seller-arranged shipping) instead of failing the deploy.
    expect(resolveShippingMode({ ...FLAG_ON, NODE_ENV: "production" })).toBe("disabled");
  });

  it("refuses an explicit stub in production without the loud override", () => {
    expect(() =>
      resolveShippingMode({ ...FLAG_ON, NODE_ENV: "production", SHIPPING_MODE: "stub" }),
    ).toThrow(ShippingConfigError);
    expect(
      resolveShippingMode({
        ...FLAG_ON,
        NODE_ENV: "production",
        SHIPPING_MODE: "stub",
        SHIPPING_ALLOW_STUB_IN_PRODUCTION: "true",
      }),
    ).toBe("stub");
  });

  it("rejects unknown modes", () => {
    expect(() => resolveShippingMode({ ...FLAG_ON, SHIPPING_MODE: "fedex" })).toThrow(
      ShippingConfigError,
    );
  });
});

describe("easypost mappers", () => {
  it("converts dollar strings to integer cents", () => {
    expect(dollarsToCents("7.33")).toBe(733);
    expect(dollarsToCents("23.00")).toBe(2300);
    expect(dollarsToCents(8.5)).toBe(850);
    expect(dollarsToCents("")).toBeNull();
    expect(dollarsToCents("nope")).toBeNull();
  });

  it("humanizes carrier service names", () => {
    expect(humanizeService("PriorityMailInternational")).toBe("Priority Mail International");
    expect(humanizeService("Ground")).toBe("Ground");
    expect(humanizeService("FEDEX_GROUND")).toBe("FEDEX_GROUND");
  });

  it("maps and sorts rates, dropping malformed entries", () => {
    const mapped = mapRates({
      id: "shp_1",
      rates: [
        { id: "r2", carrier: "USPS", service: "Express", rate: "31.40", currency: "USD" },
        { id: "r1", carrier: "USPS", service: "Priority", rate: "8.15", currency: "USD", delivery_days: 2 },
        { id: "junk", carrier: "USPS" },
        { carrier: "USPS", service: "NoId", rate: "1.00" },
      ],
    });
    expect(mapped.shipmentRef).toBe("shp_1");
    expect(mapped.rates.map((r) => r.rateRef)).toEqual(["r1", "r2"]);
    expect(mapped.rates[0]).toMatchObject({
      amountCents: 815,
      serviceLabel: "USPS Priority",
      estDeliveryDays: 2,
    });
  });

  it("maps tracker payloads into DRVN tracking state", () => {
    expect(mapTrackingState("delivered")).toBe("delivered");
    expect(mapTrackingState("error")).toBe("failure");
    expect(mapTrackingState("something_new")).toBe("unknown");

    const summary = mapTracker({
      id: "trk_1",
      tracking_code: "9400 1000",
      carrier: "USPS",
      status: "delivered",
      est_delivery_date: "2026-09-01T00:00:00Z",
      tracking_details: [
        {
          status: "in_transit",
          message: "Departed facility",
          datetime: "2026-08-30T10:00:00Z",
          tracking_location: { city: "Reno", state: "NV", country: "US" },
        },
        {
          status: "delivered",
          message: "Delivered, front door",
          datetime: "2026-08-31T15:00:00Z",
          tracking_location: { city: "Boise", state: "ID", country: "US" },
        },
      ],
    });
    expect(summary.state).toBe("delivered");
    expect(summary.deliveredAt).toBe("2026-08-31T15:00:00Z");
    expect(summary.events).toHaveLength(2);
    expect(summary.events[0].providerEventRef).toContain("2026-08-30T10:00:00Z");
    expect(summary.events[1].city).toBe("Boise");
  });
});

describe("stub provider", () => {
  const addr = {
    name: "A",
    street1: "1 Test St",
    city: "Reno",
    state: "NV",
    postalCode: "89501",
    country: "US",
  };
  const parcel = { lengthIn: 10, widthIn: 8, heightIn: 6, weightOz: 32 };

  it("rates deterministically from parcel weight", async () => {
    const a = await stubShippingProvider.getRates({ from: addr, to: addr, parcel });
    const b = await stubShippingProvider.getRates({ from: addr, to: addr, parcel });
    expect(a).toEqual(b);
    expect(a.rates.map((r) => r.amountCents)).toEqual([1120, 1980]);
  });

  it("buys the selected rate without shared state", async () => {
    const { shipmentRef, rates } = await stubShippingProvider.getRates({
      from: addr,
      to: addr,
      parcel,
    });
    const label = await stubShippingProvider.buyLabel({ shipmentRef, rateRef: rates[0].rateRef });
    expect(label.amountCents).toBe(rates[0].amountCents);
    expect(label.trackingCode).toContain("STUB");
    const tracking = await stubShippingProvider.getTracking({ trackingCode: label.trackingCode });
    expect(tracking.state).toBe("in_transit");
  });

  it("flags undeliverable addresses and delivered codes", async () => {
    const bad = await stubShippingProvider.verifyAddress({
      ...addr,
      street1: "1 UNDELIVERABLE Way",
    });
    expect(bad.deliverable).toBe(false);
    const done = await stubShippingProvider.getTracking({ trackingCode: "X_DELIVERED_1" });
    expect(done.state).toBe("delivered");
    expect(done.deliveredAt).not.toBeNull();
  });
});
