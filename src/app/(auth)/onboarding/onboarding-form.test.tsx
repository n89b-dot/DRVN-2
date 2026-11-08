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

// F-3: with nowhere to return to, the primary is the car and the way past it
// is "Skip — just browsing", which posts next=/home. With a destination the
// form just finishes there.
describe("onboarding finish (F-3)", () => {
  it("offers add-your-car first and a Skip that goes to Home when there is no destination", () => {
    const html = renderToStaticMarkup(<OnboardingForm email="someone@gmail.test" />);
    expect(html).toContain("Next: add your car");
    const skip = html.match(/<button[^>]*>Skip — just browsing<\/button>/)?.[0] ?? "";
    expect(skip).toContain('name="next"');
    expect(skip).toContain('value="/home"');
    expect(html).not.toContain("Let&#x27;s go");
  });

  it("just finishes with a destination, carrying it in the form", () => {
    const html = renderToStaticMarkup(<OnboardingForm email="someone@gmail.test" next="/garage" />);
    expect(html).toContain("Let&#x27;s go");
    expect(html).toMatch(/<input[^>]*name="next"[^>]*value="\/garage"|<input[^>]*value="\/garage"[^>]*name="next"/);
    expect(html).not.toContain("just browsing");
  });
});
