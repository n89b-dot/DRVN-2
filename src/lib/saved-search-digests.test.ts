import { describe, expect, it } from "vitest";

import { renderDigest } from "./saved-search-digests";

const ORIGIN = "https://drvn.example";
const item = (n: number) => ({ id: `listing-${n}`, title: `Part ${n}`, price_cents: 12_500 });

describe("renderDigest", () => {
  it("names one match in the subject and links each part, the search and the opt-outs", () => {
    const email = renderDigest({ search_name: "E46 coilovers", href: "/marketplace?q=coilovers", match_count: 1, items: [item(1)] }, ORIGIN);
    expect(email.subject).toBe("New match for E46 coilovers: Part 1");
    expect(email.text).toContain("- Part 1 ($125)\n  https://drvn.example/listings/listing-1");
    expect(email.text).toContain("See them all: https://drvn.example/marketplace?q=coilovers");
    expect(email.text).toContain("Stop these emails: https://drvn.example/settings#signals");
    expect(email.text).toContain("Turn off alerts for this search: https://drvn.example/saved");
    expect(email.text).not.toContain("more.");
  });

  it("counts every match and says how many are not listed", () => {
    const email = renderDigest({ search_name: "Wheels", href: "/marketplace/wheels", match_count: 9, items: [1, 2, 3, 4, 5].map(item) }, ORIGIN);
    expect(email.subject).toBe("9 new parts match Wheels");
    expect(email.text).toContain("And 4 more.");
    expect(email.html).toContain("<p>And 4 more.</p>");
  });

  it("escapes what members wrote", () => {
    const email = renderDigest({
      search_name: `<script>"x"</script>`, href: "/marketplace", match_count: 2,
      items: [{ id: "a&b", title: `<img src=x onerror=alert(1)>`, price_cents: null }, { bogus: true }],
    }, ORIGIN);
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(email.html).toContain(`href="https://drvn.example/listings/a%26b"`);
  });

  it("renders the same message every time, so a retry sends the same email", () => {
    const digest = { search_name: "Seats", href: "/marketplace?q=seats", match_count: 2, items: [item(1), item(2)] };
    expect(renderDigest(digest, ORIGIN)).toEqual(renderDigest(digest, ORIGIN));
  });
});
