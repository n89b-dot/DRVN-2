import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * N136: a promoted member's authenticator is first-come no longer. Until the
 * operator confirms it, /admin-verify offers that member enrolment and then
 * the factor's reference to read to the operator — never the console — and
 * everyone else still gets the console's 404.
 */

const state = vi.hoisted(() => ({
  role: null as string | null,
  enrolment: null as string | null,
  confirmed: null as string | null,
  factors: [] as { id: string; status: string; created_at: string }[],
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "member-1" } } }),
      mfa: { listFactors: async () => ({ data: { totp: state.factors, all: state.factors }, error: null }) },
    },
    rpc: async (name: string) => {
      const answers: Record<string, unknown> = { admin_role: state.role, admin_enrolment_state: state.enrolment, admin_confirmed_factor: state.confirmed };
      return { data: answers[name] ?? null, error: null };
    },
  }),
}));

// The real form, with the factor it will challenge written beside it.
vi.mock("./verify-form", async (importOriginal) => {
  const real = await importOriginal<typeof import("./verify-form")>();
  return {
    AdminVerifyForm: (props: Parameters<typeof real.AdminVerifyForm>[0]) => (
      <>
        <i data-challenge={props.factorId ?? "none"} />
        <real.AdminVerifyForm {...props} />
      </>
    ),
  };
});

const { default: AdminVerifyPage } = await import("./page");

const render = async () => renderToStaticMarkup(await AdminVerifyPage({ searchParams: Promise.resolve({ next: "/admin/users" }) }));

beforeEach(() => {
  state.role = null;
  state.enrolment = null;
  state.confirmed = null;
  state.factors = [];
});

describe("/admin-verify (N136)", () => {
  it("404s someone who isn't a console member", async () => {
    await expect(render()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("offers a promoted, unconfirmed member enrolment and says the operator must confirm it", async () => {
    state.enrolment = "pending";
    const html = await render();
    expect(html).toContain("Set up authenticator");
    expect(html).toContain("operator who added you has confirmed this authenticator");
    expect(html).not.toContain("Verification lasts 15 minutes");
  });

  it("shows a pending member with a verified factor its reference, not a way in", async () => {
    state.enrolment = "pending";
    state.factors = [{ id: "a1b2c3d4-0000-4000-8000-000000000001", status: "verified", created_at: "2026-11-07T10:00:00Z" }];
    const html = await render();
    expect(html).toContain("a1b2c3d4-0000-4000-8000-000000000001");
    expect(html).toContain("someone else has your password");
    expect(html).not.toContain("Authenticator code");
    expect(html).not.toContain("Set up authenticator");
  });

  it("challenges the confirmed factor, not another verified one on the account", async () => {
    state.role = "admin";
    state.confirmed = "factor-a";
    state.factors = [
      { id: "factor-b", status: "verified", created_at: "2026-11-07T09:00:00Z" },
      { id: "factor-a", status: "verified", created_at: "2026-11-07T10:00:00Z" },
    ];
    const html = await render();
    expect(html).toContain('data-challenge="factor-a"');
    expect(html).not.toContain('data-challenge="factor-b"');
  });

  it("asks a confirmed member for their code", async () => {
    state.role = "admin";
    state.confirmed = "f-1";
    state.factors = [{ id: "f-1", status: "verified", created_at: "2026-11-07T10:00:00Z" }];
    const html = await render();
    expect(html).toContain("Authenticator code");
    expect(html).toContain("Verification lasts 15 minutes");
    expect(html).not.toContain("Read them this reference");
  });
});
