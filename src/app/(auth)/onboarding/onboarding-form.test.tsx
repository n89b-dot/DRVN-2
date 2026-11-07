import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({ completeOnboarding: vi.fn(), logout: vi.fn() }));

import { OnboardingForm } from "./onboarding-form";

// Readiness N40: onboarding has no Close, so an account that can't finish
// needs a way out that doesn't loop back here.
describe("onboarding way out", () => {
  it("always offers sign-out, naming the account", () => {
    const html = renderToStaticMarkup(<OnboardingForm email="someone@gmail.test" />);
    expect(html).toContain("Not someone@gmail.test? Sign out");
    expect(html.match(/<form/g)).toHaveLength(2);
  });
});
