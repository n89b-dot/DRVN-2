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

// R69-age: asked here only when sign-up or checkout didn't record it.
describe("onboarding 18+ confirmation", () => {
  it("asks a first Google sign-in, as a required box", () => {
    const html = renderToStaticMarkup(<OnboardingForm email="someone@gmail.test" askAge />);
    expect(html).toContain("18 or over");
    const box = html.match(/<input[^>]*name="age_confirmed"[^>]*>/)?.[0] ?? "";
    expect(box).toContain('type="checkbox"');
    expect(box).toContain('value="yes"');
    expect(box).toContain("required");
  });

  it("doesn't ask an account that already confirmed", () => {
    const html = renderToStaticMarkup(<OnboardingForm email="someone@gmail.test" />);
    expect(html).not.toContain("age_confirmed");
  });
});
