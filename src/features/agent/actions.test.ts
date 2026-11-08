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

describe("resuming a paused seller agent (readiness 71)", () => {
  const on = { listingId: LISTING, on: true, minimumCents: 20000, targetCents: 24000, style: "balanced" as const, acknowledgeBinding: true };

  beforeEach(() => {
    mocks.rows.set("agent_mandates", { data: { id: "m-1", status: "paused" }, error: null });
  });

  it("says the agent is handling offers only once the database has resumed it", async () => {
    mocks.rpc.mockResolvedValue({ data: "active", error: null });
    await expect(saveListingAgent(on)).resolves.toEqual({ ok: "Your agent is handling offers on this listing." });
    expect(mocks.rpc).toHaveBeenCalledWith("agent_mandate_set_status", { p_mandate: "m-1", p_status: "active" });
    expect(mocks.capture).toHaveBeenCalledWith("user-1", expect.objectContaining({ event: "agent_offers_enabled" }));
  });

  it.each([
    ["a refusal", { data: null, error: { code: "42501" } }, "Your account can't do that right now."],
    ["an ended mandate", { data: null, error: { code: "22023" } }, "Couldn't resume it. Try again."],
    ["an answer other than active", { data: "paused", error: null }, "Couldn't resume it. Try again."],
  ])("keeps the refusal on %s, and never claims the agent is handling offers", async (_case, answer, reason) => {
    mocks.rpc.mockResolvedValue(answer);
    const result = await saveListingAgent(on);
    expect(result.ok).toBeUndefined();
    expect(result.stillPaused).toBe(true);
    expect(result.error).toBe(`Your agent's limits are saved, but it is still paused and isn't handling offers. ${reason}`);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.reportError).toHaveBeenCalledWith("[agent] resume refused", expect.objectContaining({ mandateId: "m-1" }));
  });

  it("doesn't try to resume a mandate that was already active", async () => {
    mocks.rows.set("agent_mandates", { data: { id: "m-1", status: "active" }, error: null });
    await expect(saveListingAgent(on)).resolves.toEqual({ ok: "Your agent is handling offers on this listing." });
    expect(mocks.rpc).not.toHaveBeenCalled();
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
  function answer(choice: "accept" | "dismiss") {
    const data = new FormData();
    data.set("approval_id", "a-1");
    data.set("choice", choice);
    return decideAgentApproval({}, data);
  }

  it("tells the truth about a dismissal: the task waits, nothing is queued", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "dismissed", outcome: "dismissed", replayed: false }, error: null });
    await expect(answer("dismiss")).resolves.toEqual({ ok: "Dismissed. Your agent waits for the next move on this offer." });
  });

  it("opens the offer only when the database reports an accept (N128)", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "approved", outcome: "accepted", order_id: "o-1", replayed: false }, error: null });
    mocks.rows.set("agent_approvals", { data: { offer_id: "offer-1" }, error: null });
    await expect(answer("accept")).rejects.toThrow("redirect:/offers/offer-1");
    expect(mocks.capture).toHaveBeenCalledWith("user-1", { event: "agent_approval_answered", props: { choice: "accept", outcome: "accepted" } });
  });

  it.each([
    ["expired", "This offer expired before you accepted it, so nothing was sold."],
    ["refused", "This offer can't be accepted any more, so nothing was sold. Open the offer to see where it stands."],
    ["noop", "The offer moved on before you answered, so nothing changed. Open the offer to see where it stands."],
  ])("an accept that came back %s says so, and doesn't open the offer as a sale (N128)", async (outcome, copy) => {
    mocks.rpc.mockResolvedValue({ data: { status: outcome, outcome, replayed: outcome === "noop" }, error: null });
    mocks.rows.set("agent_approvals", { data: { offer_id: "offer-1" }, error: null });
    await expect(answer("accept")).resolves.toEqual({ error: copy });
    expect(mocks.capture).toHaveBeenCalledWith("user-1", { event: "agent_approval_answered", props: { choice: "accept", outcome } });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/agent");
  });

  it("never claims a sale when the result has no outcome", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "approved" }, error: null });
    await expect(answer("accept")).resolves.toEqual({ error: "Couldn't confirm what happened. Open the offer to see where it stands." });
  });
});
