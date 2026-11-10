import { beforeEach, describe, expect, it, vi } from "vitest";

const { capture, allow } = vi.hoisted(() => ({ capture: vi.fn(), allow: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ captureMessage: capture }));
vi.mock("@/lib/rate-limit", async (original) => ({ ...(await original<typeof import("@/lib/rate-limit")>()), allowAction: allow }));
vi.mock("@/lib/abuse-identity", () => ({ abuseIdentity: () => "network:test" }));

import { RATE_LIMITS } from "@/lib/rate-limit";

import { POST } from "./route";

beforeEach(() => { capture.mockReset(); allow.mockReset(); allow.mockResolvedValue(true); });

function post(body: unknown, type = "application/json") {
  return new Request("https://drvn.example/api/monitoring/photo", { method: "POST", headers: { "content-type": type }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

describe("N1053: the intake for an unsigned member photo on a page (review of #244)", () => {
  it("N1053: records a warning with the bucket and the area, and nothing else from the body", async () => {
    const response = await POST(post({ bucket: "car-images", area: "garage", path: "/garage/secret-token", src: "https://x.example/storage/v1/object/public/car-images/member/a.webp" }));
    expect(response.status).toBe(204);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith("A member photo reached a page unsigned (car-images)", "warning", { tags: { source: "unsigned-photo", bucket: "car-images", area: "garage" } });
    expect(JSON.stringify(capture.mock.calls)).not.toMatch(/secret-token|member\/a\.webp/);
  });

  it("N1053: an area written by hand is cut down as the sender cuts it; an unknown bucket or the docs record nothing", async () => {
    await POST(post({ bucket: "listing-images", area: "account-deletion/9f2c4e7a-51b6-4d0e-a3c8-7e1f0b2d6a94" }));
    expect(capture).toHaveBeenLastCalledWith(expect.any(String), "warning", { tags: { source: "unsigned-photo", bucket: "listing-images", area: "account-deletion" } });
    await POST(post({ bucket: "activity-images", area: "9f2c4e7a-51b6-4d0e-a3c8-7e1f0b2d6a94" }));
    expect(capture).toHaveBeenLastCalledWith(expect.any(String), "warning", { tags: { source: "unsigned-photo", bucket: "activity-images", area: "other" } });
    capture.mockClear();
    for (const body of [{ bucket: "avatars", area: "garage" }, { bucket: "car-images\n<script>", area: "garage" }, { area: "garage" }, { bucket: "car-images", area: "docs" }, [], "null", "not json"]) {
      expect((await POST(post(body))).status).toBe(204);
    }
    expect(capture).not.toHaveBeenCalled();
  });

  it("N1053: one visitor's limit, then a ceiling across every visitor, each checked before the body is read", async () => {
    allow.mockImplementation(async (limit: { action: string }) => limit.action !== RATE_LIMITS.photoReport.action);
    expect((await POST(post({ bucket: "car-images", area: "garage" }))).status).toBe(429);
    allow.mockImplementation(async (limit: { action: string }) => limit.action !== RATE_LIMITS.photoReportCeiling.action);
    expect((await POST(post({ bucket: "car-images", area: "garage" }))).status).toBe(429);
    expect(allow).toHaveBeenLastCalledWith(RATE_LIMITS.photoReportCeiling, "global");
    expect(capture).not.toHaveBeenCalled();
    // The ceiling is far below what one outage would otherwise send, and well under the per-visitor error limit times a crowd.
    expect(RATE_LIMITS.photoReportCeiling.limit).toBeLessThanOrEqual(60);
    expect(RATE_LIMITS.photoReportCeiling.failClosed).toBe(true);
  });

  it("N1053: refuses a body that is not JSON by type, or too large", async () => {
    expect((await POST(post("x", "text/plain"))).status).toBe(415);
    const big = new Request("https://drvn.example/api/monitoring/photo", { method: "POST", headers: { "content-type": "application/json", "content-length": "9000" }, body: "{}" });
    expect((await POST(big)).status).toBe(413);
    expect(capture).not.toHaveBeenCalled();
  });
});
