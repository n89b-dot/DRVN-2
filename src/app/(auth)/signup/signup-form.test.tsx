import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({ signup: vi.fn() }));
vi.mock("../oauth-button", () => ({ OAuthButton: ({ next }: { next?: string }) => <a data-oauth-next={next ?? ""}>Google</a> }));

import { SignupForm } from "./signup-form";

// F-3: "Add your car" links to /signup?next=/garage; the form posts that
// destination with the account, keeps it on the switch to sign-in, and hands
// it to Google sign-in too.
describe("sign-up keeps the return target (F-3)", () => {
  it("posts next=/garage and carries it to Sign in and Google", () => {
    const html = renderToStaticMarkup(<SignupForm next="/garage" betaEnforced={false} google />);
    expect(html).toMatch(/<input type="hidden" name="next" value="\/garage"\/>/);
    expect(html).toContain('href="/login?next=%2Fgarage"');
    expect(html).toContain('data-oauth-next="/garage"');
  });

  it("posts no destination when there is none", () => {
    const html = renderToStaticMarkup(<SignupForm betaEnforced={false} />);
    expect(html).not.toContain('name="next"');
  });
});
