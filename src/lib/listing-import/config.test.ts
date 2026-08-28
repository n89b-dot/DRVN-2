import { describe, expect, it } from "vitest";

import { resolveImportConfig } from "./config";

describe("resolveImportConfig", () => {
  it("uses Anthropic when a key is present", () => {
    const config = resolveImportConfig({ ANTHROPIC_API_KEY: "sk-test", NODE_ENV: "production" });
    expect(config.aiMode).toBe("anthropic");
    expect(config.model).toBe("claude-sonnet-5");
  });

  it("honours the model override", () => {
    const config = resolveImportConfig({ ANTHROPIC_API_KEY: "k", LISTING_IMPORT_MODEL: "claude-opus-5" });
    expect(config.model).toBe("claude-opus-5");
  });

  it("falls back to the stub outside production", () => {
    expect(resolveImportConfig({ NODE_ENV: "development" }).aiMode).toBe("stub");
    expect(resolveImportConfig({ NODE_ENV: "test" }).aiMode).toBe("stub");
  });

  it("is disabled in production without a key", () => {
    expect(resolveImportConfig({ NODE_ENV: "production" }).aiMode).toBe("disabled");
  });

  it("refuses stub in production without the loud override", () => {
    expect(
      resolveImportConfig({ NODE_ENV: "production", LISTING_IMPORT_AI_MODE: "stub" }).aiMode
    ).toBe("disabled");
    expect(
      resolveImportConfig({
        NODE_ENV: "production",
        LISTING_IMPORT_AI_MODE: "stub",
        LISTING_IMPORT_ALLOW_STUB_IN_PRODUCTION: "true",
      }).aiMode
    ).toBe("stub");
  });

  it("never allows private hosts in production", () => {
    expect(
      resolveImportConfig({ NODE_ENV: "production", LISTING_IMPORT_ALLOW_PRIVATE_HOSTS: "true" })
        .allowPrivateHosts
    ).toBe(false);
    expect(
      resolveImportConfig({ NODE_ENV: "test", LISTING_IMPORT_ALLOW_PRIVATE_HOSTS: "true" })
        .allowPrivateHosts
    ).toBe(true);
  });
});
