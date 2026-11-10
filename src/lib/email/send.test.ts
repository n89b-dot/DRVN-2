import { afterEach, describe, expect, it, vi } from "vitest";

const reportError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/monitoring", () => ({ reportError }));

import { TRANSPORTS, emailTransport } from "./send";

const shipped = { ...TRANSPORTS };
afterEach(() => {
  reportError.mockReset();
  for (const name of Object.keys(TRANSPORTS)) delete TRANSPORTS[name];
  Object.assign(TRANSPORTS, shipped);
});

describe("the email seam", () => {
  it("is off, quietly, while no provider is chosen (R-email); Resend is the one transport shipped (OS-W41)", () => {
    expect(Object.keys(TRANSPORTS)).toEqual(["resend"]);
    expect(emailTransport({})).toBeNull();
    expect(emailTransport({ EMAIL_PROVIDER: " " })).toBeNull();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("reports a provider it doesn't know, or one with no sender, and stays off", () => {
    expect(emailTransport({ EMAIL_PROVIDER: "unknown", EMAIL_FROM: "alerts@drvn.example" })).toBeNull();
    TRANSPORTS.fixture = () => async () => ({ status: "sent", providerId: null });
    expect(emailTransport({ EMAIL_PROVIDER: "fixture" })).toBeNull();
    expect(reportError).toHaveBeenCalledTimes(2);
  });

  it("hands a registered provider its sender and environment", async () => {
    const send = vi.fn(async () => ({ status: "sent" as const, providerId: "fixture-id" }));
    const factory = vi.fn(() => send);
    TRANSPORTS.fixture = factory;
    const env = { EMAIL_PROVIDER: "fixture", EMAIL_FROM: "alerts@drvn.example" };
    const transport = emailTransport(env);
    expect(transport?.name).toBe("fixture");
    expect(factory).toHaveBeenCalledWith({ from: "alerts@drvn.example", env });
    const message = { to: "member@drvn.test", subject: "s", text: "t", html: "h", idempotencyKey: "k" };
    await expect(transport!.send(message)).resolves.toEqual({ status: "sent", providerId: "fixture-id" });
    expect(send).toHaveBeenCalledWith(message);
  });
});
