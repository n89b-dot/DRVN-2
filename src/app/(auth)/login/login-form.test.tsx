import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({ login: vi.fn() }));
vi.mock("../oauth-button", () => ({ OAuthButton: () => null }));

import { LoginForm } from "./login-form";

const render = (message?: string) => renderToStaticMarkup(<LoginForm message={message} />);

// Readiness N44 and N43: each return gets its own notice; N49: the query
// string never puts its own words on the page.
describe("login notices", () => {
  it("tells someone who cancelled Google that nothing changed, not that a link expired", () => {
    const html = render("oauth-cancelled");
    expect(html).toContain("Google sign-in cancelled");
    expect(html).not.toMatch(/expired|already used/);
  });

  it("keeps the expired-link notice for links", () => {
    expect(render("auth-error")).toContain("invalid, expired, or already used");
  });

  it("gives a blocked account the durable message", () => {
    const html = render("access-blocked");
    expect(html).toContain("Account unavailable");
    expect(html).toContain("hello@drvn.app");
    expect(html).not.toMatch(/try again/i);
  });

  it("renders nothing for an unknown message", () => {
    const html = render("<b>Your account is locked, call 0800</b>");
    expect(html).not.toContain("0800");
    expect(html).not.toContain('class="alert');
  });
});
