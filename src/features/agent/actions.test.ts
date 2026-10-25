import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  rows: new Map<string, unknown>(),
  invokeCapability: vi.fn(),
  loadAgentMode: vi.fn(),
  revalidatePath: vi.fn(),
  reportError: vi.fn(),
  capture: vi.fn(),
}));

/** A query builder that answers `maybeSingle()` with the row queued for its table. */
function chain(table: string) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) builder[method] = () => builder;
  builder.maybeSingle = async () => mocks.rows.get(table) ?? { data: null, error: null };
  return builder;
}

vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/lib/agent/beta", () => ({ agentStepOpen: async () => true, agentTabOpen: async () => true }));
vi.mock("@/lib/agent/member-mode", () => ({ loadAgentMode: mocks.loadAgentMode }));
vi.mock("@/lib/agent/context", () => ({ memberContext: (id: string, scope: string) => ({ id, scope }) }));
vi.mock("@/lib/capabilities/negotiation", () => ({ setAgentLimits: { name: "set_agent_limits" } }));
vi.mock("@/lib/capabilities/types", () => ({ CapabilityError: class CapabilityError extends Error {}, invokeCapability: mocks.invokeCapability }));
vi.mock("@/lib/analytics", () => ({ capture: mocks.capture }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/revalidate", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc, from: (table: string) => chain(table) }),
}));

import { decideAgentApproval, saveListingAgent, startBuyerAgent, stopBuyerAgent } from "./actions";

const LISTING = "11111111-1111-4111-8111-111111111111";

function buyerInput() {
  return { listingId: LISTING, ceilingCents: 130000, ceilingBasis: "item" as const, style: "balanced" as const, acknowledgeBinding: true };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows.clear();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mocks.loadAgentMode.mockResolvedValue("act");
  mocks.rpc.mockResolvedValue({ data: "revoked", error: null });
  mocks.invokeCapability.mockResolvedValue({ ok: true, mandateId: "m-1", code: null });
  mocks.rows.set("listings", { data: { id: LISTING, seller_id: "seller-1", status: "active", shipping_mode: "flat", price_cents: 150000 }, error: null });
});

describe("the member's agent mode (AG-7)", () => {
  it("lets Negotiate for me start under Act", async () => {
    const result = await startBuyerAgent(buyerInput());
    expect(result.ok).toContain("Your agent is negotiating");
    expect(mocks.invokeCapability).toHaveBeenCalledOnce();
  });

  it.each([
    ["off", "Agent is off in Settings."],
    ["suggest", "Agent is set to Suggest in Settings, so it can't negotiate for you."],
  ])("refuses to start a buyer mandate under %s, before touching anything", async (mode, message) => {
    mocks.loadAgentMode.mockResolvedValue(mode);
    await expect(startBuyerAgent(buyerInput())).resolves.toEqual({ error: message });
    expect(mocks.invokeCapability).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses to turn Let DRVN handle offers on under Off, but still lets it be turned off", async () => {
    mocks.loadAgentMode.mockResolvedValue("off");
    const on = { listingId: LISTING, on: true, minimumCents: 20000, targetCents: 24000, style: "balanced" as const, acknowledgeBinding: true };
    await expect(saveListingAgent(on)).resolves.toEqual({ error: "Agent is off in Settings." });
    expect(mocks.invokeCapability).not.toHaveBeenCalled();

    mocks.rows.set("agent_mandates", { data: { id: "m-1", status: "active" }, error: null });
    await expect(saveListingAgent({ ...on, on: false })).resolves.toEqual({ ok: "Your agent stopped handling offers on this listing." });
    expect(mocks.rpc).toHaveBeenCalledWith("agent_mandate_set_status", { p_mandate: "m-1", p_status: "revoked" });
  });
});

describe("stopBuyerAgent (readiness 64)", () => {
  function form(mandateId = "m-1", offerId?: string) {
    const data = new FormData();
    data.set("mandate_id", mandateId);
    if (offerId) data.set("offer_id", offerId);
    return data;
  }

  it("revokes the buyer's own mandate and refreshes the pages that show it", async () => {
    mocks.rows.set("agent_mandates", { data: { id: "m-1", listing_id: LISTING, scope: "buyer", status: "active" }, error: null });
    const result = await stopBuyerAgent({}, form("m-1", "offer-1"));
    expect(result.ok).toContain("Stopped.");
    expect(mocks.rpc).toHaveBeenCalledWith("agent_mandate_set_status", { p_mandate: "m-1", p_status: "revoked" });
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual(["/agent", `/listings/${LISTING}`, "/offers/offer-1"]);
    expect(mocks.capture).toHaveBeenCalledWith("user-1", { event: "negotiate_for_me_stopped" });
  });

  it("checks the database's answer rather than assuming it", async () => {
    mocks.rows.set("agent_mandates", { data: { id: "m-1", listing_id: LISTING, scope: "buyer", status: "active" }, error: null });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "22023" } });
    await expect(stopBuyerAgent({}, form())).resolves.toEqual({ error: "Couldn't stop your agent. Try again." });
    expect(mocks.reportError).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();

    mocks.rpc.mockResolvedValue({ data: "paused", error: null });
    expect((await stopBuyerAgent({}, form())).error).toBe("Couldn't stop your agent. Try again.");
  });

  it("only stops a buyer mandate the member owns", async () => {
    await expect(stopBuyerAgent({}, form("missing"))).resolves.toEqual({ error: "That's no longer there. Reload the page." });
    mocks.rows.set("agent_mandates", { data: { id: "m-2", listing_id: LISTING, scope: "seller", status: "active" }, error: null });
    await expect(stopBuyerAgent({}, form("m-2"))).resolves.toEqual({ error: "That's no longer there. Reload the page." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("says so when it had already stopped", async () => {
    mocks.rows.set("agent_mandates", { data: { id: "m-1", listing_id: LISTING, scope: "buyer", status: "revoked" }, error: null });
    await expect(stopBuyerAgent({}, form())).resolves.toEqual({ ok: "Your agent has already stopped on this part." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("decideAgentApproval (readiness 72)", () => {
  it("tells the truth about a dismissal: the task waits, nothing is queued", async () => {
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
    const data = new FormData();
    data.set("approval_id", "a-1");
    data.set("choice", "dismiss");
    await expect(decideAgentApproval({}, data)).resolves.toEqual({ ok: "Dismissed. Your agent waits for the next move on this offer." });
  });
});
