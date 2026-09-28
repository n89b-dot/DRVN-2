import { describe, expect, it } from "vitest";

import { normalizeCurrency, parsePriceCents, trimSiteName } from "./part-link";

/**
 * A reference price on a build sheet is read by a human and never used for a
 * transaction, which cuts both ways: nothing breaks if it is missing, and
 * nothing catches it if it is wrong. So the parser refuses everything it
 * cannot read unambiguously rather than guessing.
 */
describe("reference price from a pasted product link", () => {
  it("reads plain decimal prices", () => {
    expect(parsePriceCents("1299.00")).toBe(129900);
    expect(parsePriceCents("£1,299")).toBe(129900);
    expect(parsePriceCents("249")).toBe(24900);
    expect(parsePriceCents("  99.99 USD ")).toBe(9999);
  });

  it("refuses a price it would have to guess at", () => {
    // European decimal comma: 1.299,00 is one thousand two hundred, but
    // 1,299 is either 1.299 or 1299 depending on the shop's locale.
    expect(parsePriceCents("1.299,00")).toBeNull();
    expect(parsePriceCents("1299,50")).toBeNull();
    expect(parsePriceCents("")).toBeNull();
    expect(parsePriceCents(undefined)).toBeNull();
    expect(parsePriceCents("free")).toBeNull();
    expect(parsePriceCents("0")).toBeNull();
    expect(parsePriceCents("-40")).toBeNull();
  });

  it("only accepts an ISO-4217-shaped currency", () => {
    expect(normalizeCurrency("gbp")).toBe("GBP");
    expect(normalizeCurrency(" usd ")).toBe("USD");
    expect(normalizeCurrency("£")).toBeNull();
    expect(normalizeCurrency("dollars")).toBeNull();
    expect(normalizeCurrency(undefined)).toBeNull();
  });
});

describe("a page title with the shop's name on it", () => {
  it("drops the stated site name", () => {
    expect(trimSiteName("MX Wheel – Asphalt Black | fifteen52", "fifteen52")).toBe("MX Wheel – Asphalt Black");
    expect(trimSiteName("Downpipe - FCP Euro", "FCP Euro")).toBe("Downpipe");
  });

  it("drops the last pipe segment when the site isn't named", () => {
    expect(trimSiteName("MX | Asphalt Black | Off-Road Truck Wheels | 52OFFROAD")).toBe(
      "MX | Asphalt Black | Off-Road Truck Wheels"
    );
    expect(trimSiteName("Plain title")).toBe("Plain title");
  });
});

describe("Shopify-style product pages", () => {
  it("reads a ProductGroup's brand, and its price from the first variant", async () => {
    const { extractJsonLdProduct, loadHtml } = await import("@/lib/listing-import/extract/html");
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "ProductGroup",
      name: "MX Asphalt Black",
      brand: { "@type": "Brand", name: "fifteen52" },
      hasVariant: [
        {
          "@type": "Product",
          sku: "MXAB-17",
          image: "https://shop.example/mx.jpg",
          offers: { "@type": "Offer", price: "405.00", priceCurrency: "USD" },
        },
      ],
    })}</script>`;
    const product = extractJsonLdProduct(loadHtml(html), "https://shop.example/p/mx");
    expect(product?.name).toBe("MX Asphalt Black");
    expect(product?.brand).toBe("fifteen52");
    expect(product?.priceText).toBe("405.00");
    expect(product?.currency).toBe("USD");
    expect(product?.partNumber).toBe("MXAB-17");
    expect(product?.images[0]).toBe("https://shop.example/mx.jpg");
  });
});
