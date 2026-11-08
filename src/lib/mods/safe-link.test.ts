import { describe, expect, it } from "vitest";

import { linksIn, memberLink, safeProductLink } from "./safe-link";

/** N124 (OS-W07): which links may go on a member's build. */
describe("safeProductLink", () => {
  it("keeps a public web page, with its host as it really is", () => {
    expect(safeProductLink("https://www.KWsuspensions.com/en/v3?colour=yellow")).toEqual({ url: "https://www.kwsuspensions.com/en/v3?colour=yellow", host: "www.kwsuspensions.com" });
    expect(safeProductLink("http://shop.ecstuning.com/p/1")?.host).toBe("shop.ecstuning.com");
    // A look-alike international name shows as punycode, not as the brand it imitates.
    expect(safeProductLink("https://kwsuspensiоns.com/v3")?.host).toMatch(/^xn--/);
  });

  it("refuses anything that isn't a plain public web address", () => {
    for (const bad of [
      null,
      42,
      "",
      "not a link",
      "javascript:alert(1)",
      "data:text/html,hi",
      "ftp://kwsuspensions.com/v3",
      "https://user:pass@kwsuspensions.com/v3",
      "https://kwsuspensions.com:8443/v3",
      "http://127.0.0.1/admin",
      "http://[::1]/",
      "http://169.254.169.254/latest/meta-data",
      "https://localhost/x",
      "https://printer.local/x",
      "https://intranet/x",
      "https://metadata.internal/x",
      // RFC 8375 home networks, and the rest of the special-use .arpa tree.
      "http://router.home.arpa/admin",
      "https://home.arpa/",
      "https://nas.office.home.arpa/x",
      "http://1.0.168.192.in-addr.arpa/",
      "https://printer.localdomain/x",
      "https://router.lan/x",
      `https://kwsuspensions.com/${"a".repeat(2_000)}`,
    ]) {
      expect(safeProductLink(bad), String(bad)).toBeNull();
    }
  });
});

describe("memberLink", () => {
  const typed = linksIn("Fitted these today: https://www.kwsuspensions.com/en/v3/. Also see (https://shop.ecstuning.com/p/1)");

  it("finds the links a member typed, without trailing punctuation", () => {
    expect(typed).toEqual(["https://www.kwsuspensions.com/en/v3/", "https://shop.ecstuning.com/p/1"]);
  });

  it("returns the member's own address for the same page, never the model's spelling", () => {
    expect(memberLink("https://kwsuspensions.com/en/v3?ref=agent#buy", typed)).toEqual({ url: "https://www.kwsuspensions.com/en/v3/", host: "www.kwsuspensions.com" });
  });

  it("refuses a page the member didn't give, or a different host with the same path", () => {
    expect(memberLink("https://parts-deals.example.net/en/v3", typed)).toBeNull();
    expect(memberLink("https://kwsuspensions.com/en/other", typed)).toBeNull();
    expect(memberLink("https://kwsuspensions.com/en/v3", [])).toBeNull();
    expect(memberLink("javascript:alert(1)", ["javascript:alert(1)"])).toBeNull();
  });
});
