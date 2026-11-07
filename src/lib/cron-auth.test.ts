import { afterEach, describe, expect, it } from "vitest";

import { cronAuthorized, secretDigestHex, secretsEqual } from "./cron-auth";

const SECRET = "a".repeat(40);
const request = (authorization?: string) =>
  new Request("https://drvn.test/api/jobs/media-gc", { method: "POST", headers: authorization === undefined ? {} : { authorization } });

describe("secretsEqual", () => {
  it("matches equal secrets", () => {
    expect(secretsEqual(SECRET, SECRET)).toBe(true);
    expect(secretsEqual("Bearer ünïcode-✓", "Bearer ünïcode-✓")).toBe(true);
  });

  it("refuses unequal secrets of the same length", () => {
    expect(secretsEqual(SECRET, `${"a".repeat(39)}b`)).toBe(false);
  });

  it("refuses unequal lengths without throwing, either way round", () => {
    expect(() => secretsEqual(SECRET, SECRET.slice(1))).not.toThrow();
    expect(secretsEqual(SECRET, SECRET.slice(1))).toBe(false);
    expect(secretsEqual(SECRET.slice(1), SECRET)).toBe(false);
    expect(secretsEqual(SECRET, `${SECRET}a`)).toBe(false);
    // A prefix is not a match, however long the shared part.
    expect(secretsEqual(`Bearer ${SECRET}`, `Bearer ${SECRET}x`)).toBe(false);
  });

  it("never matches empty or missing values, even against each other", () => {
    expect(secretsEqual("", "")).toBe(false);
    expect(secretsEqual("", SECRET)).toBe(false);
    expect(secretsEqual(SECRET, "")).toBe(false);
    expect(secretsEqual(null, SECRET)).toBe(false);
    expect(secretsEqual(SECRET, undefined)).toBe(false);
    expect(secretsEqual(undefined, undefined)).toBe(false);
  });

  it("digests a secret the way the database does (sha256, hex)", () => {
    expect(secretDigestHex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("cronAuthorized", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("accepts exactly the bearer CRON_SECRET", () => {
    process.env.CRON_SECRET = SECRET;
    expect(cronAuthorized(request(`Bearer ${SECRET}`))).toBe(true);
  });

  it.each([
    ["no header", undefined],
    ["an empty header", ""],
    ["an empty bearer", "Bearer "],
    ["the bare secret", SECRET],
    ["another scheme", `Basic ${SECRET}`],
    ["a wrong secret of the same length", `Bearer ${"b".repeat(40)}`],
    ["a shorter secret", `Bearer ${SECRET.slice(1)}`],
    ["a longer secret", `Bearer ${SECRET}a`],
  ])("refuses %s", (_label, header) => {
    process.env.CRON_SECRET = SECRET;
    expect(cronAuthorized(request(header))).toBe(false);
  });

  it("refuses everyone when CRON_SECRET is unset or empty", () => {
    expect(cronAuthorized(request("Bearer "))).toBe(false);
    expect(cronAuthorized(request("Bearer undefined"))).toBe(false);
    process.env.CRON_SECRET = "";
    expect(cronAuthorized(request("Bearer "))).toBe(false);
  });
});
