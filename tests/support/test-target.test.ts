import { describe, expect, it } from "vitest";
import { assertIsolatedTestTarget } from "./test-target";

describe("destructive fixture target boundary", () => {
  it.each(["http://127.0.0.1:54321", "http://localhost:54321/"])("allows the explicit local stack: %s", url => {
    expect(() => assertIsolatedTestTarget({ url, projectRef: "local-drvn-remediation" })).not.toThrow();
  });
  it("rejects an arbitrary matching hosted ref, including an existing live project", () => {
    expect(() => assertIsolatedTestTarget({ url: "https://existing-project.supabase.co", projectRef: "existing-project" })).toThrow("reviewed disposable-project inventory");
  });
  it("allows only a reviewed hosted project with its exact HTTPS origin", () => {
    expect(() => assertIsolatedTestTarget({ url: "https://isolated-stage.supabase.co", projectRef: "isolated-stage" }, ["isolated-stage"])).not.toThrow();
    expect(() => assertIsolatedTestTarget({ url: "https://different.supabase.co", projectRef: "isolated-stage" }, ["isolated-stage"])).toThrow();
  });
  it.each([
    "http://127.0.0.1:55431", "http://127.0.0.1.evil.test:54321",
    "https://localhost:54321", "http://user:secret@localhost:54321",
    "http://localhost:54321/auth", "http://localhost:54321?target=live", "http://localhost:54321#live",
  ])("rejects a misleading local URL: %s", url => {
    expect(() => assertIsolatedTestTarget({ url, projectRef: "local-drvn-remediation" })).toThrow();
  });
  it.each(["http://isolated-stage.supabase.co", "https://isolated-stage.supabase.co.evil.test", "https://isolated-stage.supabase.co:8443"])("rejects a noncanonical approved origin: %s", url => {
    expect(() => assertIsolatedTestTarget({ url, projectRef: "isolated-stage" }, ["isolated-stage"])).toThrow();
  });
  it("never infers a missing environment", () => {
    expect(() => assertIsolatedTestTarget({})).toThrow("explicit isolated");
  });
});
