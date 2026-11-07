import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./account-actions", () => ({ changeEmail: vi.fn(), changePassword: vi.fn(), sendPasswordSetupLink: vi.fn() }));
vi.mock("@/lib/google-sign-in", () => ({ startGoogleSignIn: vi.fn() }));

import { DeleteAccount } from "./delete-account";
import { PasswordSection } from "./password-section";
import { ReconfirmIdentity, type IdentityProof } from "./reconfirm-identity";

vi.mock("../garage/actions", () => ({ deleteAccount: vi.fn() }));

const passwordMember: IdentityProof = { usesPassword: true, google: true, confirmedRecently: false };
const googleMember: IdentityProof = { usesPassword: false, google: true, confirmedRecently: false };

// Readiness N45: Google-only members were shown a current-password form they
// could never use.
describe("password section", () => {
  it("shows the change-password form to a member with a password, plus a reset link", () => {
    const html = renderToStaticMarkup(<PasswordSection currentEmail="m@drvn.test" proof={passwordMember} />);
    expect(html).toContain("Current password");
    expect(html).toContain("Change password");
    expect(html).toContain("Email me a reset link");
  });

  it("shows a Google-only member the set-password path instead", () => {
    const html = renderToStaticMarkup(<PasswordSection currentEmail="g@drvn.test" proof={googleMember} />);
    expect(html).not.toContain("Current password");
    expect(html).not.toContain("Change password");
    expect(html).toContain("You sign in with Google");
    expect(html).toContain("Email me a link to set a password");
  });
});

// Readiness N41: deletion and email change ask for fresh proof, of the kind
// the member actually has.
describe("confirm it's you", () => {
  const render = (proof: IdentityProof, needsGoogle = false) =>
    renderToStaticMarkup(<ReconfirmIdentity id="x" proof={proof} returnTo="/settings#danger" needsGoogle={needsGoogle} />);

  it("asks a member with a password to type it", () => {
    const html = render(passwordMember);
    expect(html).toContain("Your password");
    expect(html).toContain('name="current_password"');
    expect(html).not.toContain("Confirm with Google");
  });

  it("offers a Google-only member Google again, not a password field", () => {
    const html = render(googleMember);
    expect(html).toContain("Confirm with Google");
    expect(html).not.toContain('name="current_password"');
  });

  it("says so when the Google sign-in was a moment ago, until the server asks again", () => {
    expect(render({ ...googleMember, confirmedRecently: true })).toContain("a moment ago");
    expect(render({ ...googleMember, confirmedRecently: true }, true)).toContain("Confirm with Google");
  });

  it("points to support when Google sign-in is off", () => {
    expect(render({ ...googleMember, google: false })).toContain("hello@drvn.app");
  });

  it("keeps the delete flow closed until asked", () => {
    expect(renderToStaticMarkup(<DeleteAccount proof={passwordMember} />)).toContain("Delete my account");
  });
});
