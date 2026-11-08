import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * OS-W11 follow-up (Codex on #119): queuing cleanup signs the member out, and
 * the worker bans the sign-in before it records a hold, an operator step or
 * completion, so Settings could never show those states. The reference
 * they're handed at /login opens this page, which shows them signed out.
 */

const REFERENCE = "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

const db = vi.hoisted(() => ({
  result: { data: [] as unknown[] | null, error: null as { message: string } | null },
  eq: [] as unknown[][],
  reads: 0,
}));

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      db.reads += 1;
      expect(table).toBe("account_deletion_requests");
      const builder = {
        select: () => builder,
        eq: (...args: unknown[]) => {
          db.eq.push(args);
          return builder;
        },
        order: () => builder,
        limit: async () => db.result,
      };
      return builder;
    },
  }),
}));

const { default: AccountDeletionStatusPage } = await import("./page");
const { default: LoginPage } = await import("../../login/page");

vi.mock("@/lib/auth-providers", () => ({ googleSignInEnabled: async () => false }));
vi.mock("../../login/login-form", () => ({ LoginForm: () => <form data-form="login" /> }));

const render = async (reference = REFERENCE) =>
  renderToStaticMarkup(await AccountDeletionStatusPage({ params: Promise.resolve({ reference }) }));

const status = (outcome: string, hold_order_id: string | null = null, blocker_code: string | null = null) => ({
  data: [{ outcome, updated_at: "2026-11-08T10:00:00Z", hold_order_id, blocker_code }],
  error: null,
});
const ORDER = "a1b2c3d4-0000-4000-8000-000000000001";

beforeEach(() => {
  db.result = { data: [], error: null };
  db.eq = [];
  db.reads = 0;
});

describe("deletion status for a member who can't sign in (OS-W11)", () => {
  it("shows an operator step the worker recorded after banning the sign-in", async () => {
    db.result = status("operator_attention");
    const html = await render();
    expect(db.eq).toEqual([["job_id", REFERENCE]]);
    expect(html).toContain("DRVN is finishing your deletion by hand");
    expect(html).toContain("hello@drvn.app");
  });

  it("shows a hold the worker recorded, without saying the account can still be used", async () => {
    db.result = status("temporary_financial_hold");
    const html = await render();
    expect(html).toContain("paused on an open transaction");
    expect(html).not.toMatch(/keep using your account/i);
    expect(html).not.toContain("/orders/");
  });

  // OS-W11 follow-up: a hold pauses before the ban, so the member can sign in
  // and settle the order holding it.
  it("names the order holding the deletion and links to it through sign-in", async () => {
    db.result = status("temporary_financial_hold", ORDER);
    const html = await render();
    expect(html).toContain("Paused: settle order A1B2C3D4");
    expect(html).toContain("still sign in to settle it");
    expect(html).toContain(`href="/login?next=${encodeURIComponent(`/orders/${ORDER}`)}"`);
  });

  // Ruled 8 Nov 2026: an open bank chargeback holds deletion. The member is
  // told the bank is deciding it, not asked to settle it.
  it("says an open bank chargeback is the bank's to decide", async () => {
    db.result = status("temporary_financial_hold", ORDER, "open_chargeback");
    const html = await render();
    expect(html).toContain("Paused: order A1B2C3D4 has an open bank chargeback");
    expect(html).toContain("The bank is still deciding it");
    expect(html).not.toContain("settle");
    expect(html).toContain("Sign in to see the order");
  });

  it("never links an order once the case has moved past the hold", async () => {
    db.result = status("cleanup_pending", ORDER);
    expect(await render()).not.toContain("/orders/");
  });

  it("shows cleanup in progress and a finished deletion", async () => {
    db.result = status("cleanup_pending");
    expect(await render()).toContain("Your account is being deleted");
    db.result = status("completed");
    expect(await render()).toContain("Your account has been deleted");
  });

  it("never reads the database for something that isn't a reference", async () => {
    const html = await render("not-a-reference");
    expect(db.reads).toBe(0);
    expect(html).toContain("No deletion request found");
  });

  it("says a failed read is a failed read, not that there's no request", async () => {
    db.result = { data: null, error: { message: "timeout" } };
    const html = await render();
    expect(html).toContain("Couldn&#x27;t check right now");
    expect(html).not.toContain("No deletion request found");
  });
});

describe("the login notice after a deletion request (OS-W11)", () => {
  const login = async (params: Record<string, string>) =>
    renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve(params) }));

  it("links the reference to its status page", async () => {
    const html = await login({ deletion: "requested", reference: REFERENCE });
    expect(html).toContain(`href="/account-deletion/${REFERENCE}"`);
  });

  it("links nothing for a reference that isn't one", async () => {
    const html = await login({ deletion: "requested", reference: "../settings" });
    expect(html).not.toContain("/account-deletion/");
  });
});
