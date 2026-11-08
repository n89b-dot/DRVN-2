import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({ confirmAge: vi.fn(), logout: vi.fn() }));

import { ConfirmAgeForm } from "./confirm-age-form";

describe("the earlier member's 18+ confirmation (N686)", () => {
  it("N686: asks the one required box, carries the destination and offers sign-out", () => {
    const html = renderToStaticMarkup(<ConfirmAgeForm email="kaito@drvn.test" next="/listings/abc" />);
    const box = html.match(/<input[^>]*name="age_confirmed"[^>]*>/)?.[0] ?? "";
    expect(box).toContain('type="checkbox"');
    expect(box).toContain('value="yes"');
    expect(box).toContain("required");
    expect(html).toContain("18 or over");
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="next"[^>]*value="\/listings\/abc"/);
    expect(html).toContain("Not kaito@drvn.test? Sign out");
    expect(html.match(/<form/g)).toHaveLength(2);
  });

  it("N686: sends no destination when there is none", () => {
    expect(renderToStaticMarkup(<ConfirmAgeForm email="kaito@drvn.test" />)).not.toContain('name="next"');
  });
});
