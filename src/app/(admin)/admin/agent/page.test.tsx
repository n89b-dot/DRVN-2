import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R-audit-killstate: when the kill switches can't be read, the admin agent
 * page says the state is unknown and offers no Pause or Lift, rather than
 * reading the failure as "Running".
 */

const mocks = vi.hoisted(() => ({ tables: new Map<string, { data: unknown; error: unknown }>() }));

function query(table: string) {
  const result = () => mocks.tables.get(table) ?? { data: [], error: null };
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "is", "order", "gte"]) builder[method] = () => builder;
  builder.maybeSingle = async () => result();
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
  return builder;
}

vi.mock("@/lib/admin/guard", async () => {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return {
    getAdminContext: async () => ({ role: "admin" }),
    requireAdminRead: async () => ({ role: "admin" }),
    adminReadClient: async () => createAdminClient(),
  };
});
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => query(table),
    rpc: async (name: string) => (name === "agent_health" ? { data: { stuck_tasks: 0, controls_on: [] }, error: null } : { data: { global_usd: 0 }, error: null }),
  }),
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("./actions", () => ({ setAgentBetaStep: vi.fn(), setAgentSpendLimits: vi.fn() }));
vi.mock("./agent-admin-forms", () => ({ AgentActionForm: ({ submitLabel }: { submitLabel: string }) => <button data-form="action">{submitLabel}</button> }));
vi.mock("./agent-switch-form", () => ({
  AgentSwitchForm: ({ on, add }: { on: boolean; add?: boolean }) => <button data-form="switch">{add ? "Pause one" : on ? "Pause" : "Lift"}</button>,
}));

const { default: AdminAgentPage } = await import("./page");

const render = async () => renderToStaticMarkup(await AdminAgentPage());
const switchForms = (html: string) => html.match(/data-form="switch"/g)?.length ?? 0;

beforeEach(() => {
  mocks.tables.clear();
  mocks.tables.set("agent_beta_steps", { data: [{ step: "seller", open: true, changed_at: null, reason: null }], error: null });
  mocks.tables.set("agent_spend_limits", { data: { per_member_daily_usd: 1, global_daily_usd: 50 }, error: null });
});

describe("/admin/agent kill switch state (R-audit-killstate)", () => {
  it("says State unknown and offers no Pause or Lift when the switches can't be read", async () => {
    mocks.tables.set("agent_controls", { data: null, error: { code: "57014", message: "timeout" } });
    const html = await render();
    expect(html).toContain("State unknown");
    expect(html).toContain("Kill switch state unknown");
    expect(html).not.toMatch(/>Running</);
    expect(html).not.toMatch(/Running\.|Paused\./);
    expect(html).not.toContain("No member, mandate, listing or account is paused.");
    expect(switchForms(html)).toBe(0);
    expect(html).toContain('href="/admin/agent"');
  });

  it("reads Running, with a Pause for each global switch, once they load and none is on", async () => {
    mocks.tables.set("agent_controls", { data: [], error: null });
    const html = await render();
    expect(html).toMatch(/>Running</);
    expect(html).not.toContain("State unknown");
    // Everyone, seller side, buyer side, and the targeted add form.
    expect(switchForms(html)).toBe(4);
    expect(html).not.toContain(">Lift<");
  });

  it("reads Paused for everyone, with Lift, when the all switch is on", async () => {
    mocks.tables.set("agent_controls", { data: [{ id: "c-1", scope: "all", subject_id: null, reason: "incident", set_at: "2026-11-07T10:00:00Z" }], error: null });
    const html = await render();
    expect(html).toContain("Paused for everyone");
    expect(html).toContain(">Lift<");
  });

  it("says a beta step is unknown, with no Open or Close, when the steps can't be read", async () => {
    mocks.tables.set("agent_controls", { data: [], error: null });
    mocks.tables.set("agent_beta_steps", { data: null, error: { code: "57014" } });
    const html = await render();
    expect(html).toContain("A3a · Seller negotiation · unknown");
    expect(html).not.toMatch(/data-form="action">(Open|Close)</);
  });
});
