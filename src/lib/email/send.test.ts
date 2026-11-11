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

  it("reports a half-configured provider and retries every send instead of dropping it as off (OS-W41)", async () => {
    const message = { to: "member@drvn.test", subject: "s", text: "t", html: "h", idempotencyKey: "k" };
    const unknown = emailTransport({ EMAIL_PROVIDER: "unknown", EMAIL_FROM: "alerts@drvn.example" });
    expect(unknown).not.toBeNull();
    await expect(unknown!.send(message)).resolves.toEqual({ status: "retry", reason: "unknown: unknown provider", provider: true });
    expect(emailTransport({ EMAIL_PROVIDER: "toString", EMAIL_FROM: "alerts@drvn.example" })!.name).toBe("toString");
    await expect(emailTransport({ EMAIL_PROVIDER: "toString", EMAIL_FROM: "a@drvn.example" })!.send(message)).resolves.toMatchObject({ status: "retry" });
    TRANSPORTS.fixture = () => async () => ({ status: "sent", providerId: null });
    await expect(emailTransport({ EMAIL_PROVIDER: "fixture" })!.send(message)).resolves.toEqual({ status: "retry", reason: "fixture: EMAIL_FROM missing", provider: true });
    expect(reportError).toHaveBeenCalled();
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
