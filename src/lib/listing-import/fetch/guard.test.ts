import { describe, expect, it } from "vitest";

import { checkFetchUrl, isForbiddenAddress } from "./guard";

describe("isForbiddenAddress", () => {
  const forbidden = [
    "127.0.0.1",
    "127.8.8.8",
    "0.0.0.0",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "169.254.0.1",
    "100.64.1.1", // CGN
    "198.18.0.1", // benchmarking
    "192.0.2.10", // TEST-NET
    "224.0.0.1", // multicast
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fe80::1%en0",
    "fc00::1",
    "fd12:3456::1",
    "ff02::fb",
    "::ffff:127.0.0.1", // v4-mapped loopback
    "::ffff:10.0.0.1",
    "::ffff:192.168.0.9",
    "64:ff9b::7f00:1", // NAT64 loopback
    "2001:db8::1", // documentation
  ];
  for (const address of forbidden) {
    it(`refuses ${address}`, () => {
      expect(isForbiddenAddress(address)).toBe(true);
    });
  }

  const allowed = ["93.184.216.34", "8.8.8.8", "172.32.0.1", "172.15.0.1", "2606:4700::6810:84e5", "::ffff:8.8.8.8"];
  for (const address of allowed) {
    it(`allows ${address}`, () => {
      expect(isForbiddenAddress(address)).toBe(false);
    });
  }

  it("fails closed on garbage", () => {
    expect(isForbiddenAddress("not-an-ip")).toBe(true);
    expect(isForbiddenAddress("")).toBe(true);
    expect(isForbiddenAddress("999.1.1.1")).toBe(true);
  });
});

describe("checkFetchUrl", () => {
  it("accepts ordinary public http(s) URLs", () => {
    expect(checkFetchUrl("https://forum.example.com/threads/fs-turbo.123/").ok).toBe(true);
    expect(checkFetchUrl("http://example.com/a").ok).toBe(true);
  });

  it("refuses unsupported schemes", () => {
    for (const url of ["ftp://example.com/x", "file:///etc/passwd", "gopher://x", "javascript:alert(1)"]) {
      const result = checkFetchUrl(url);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("source_invalid");
    }
  });

  it("refuses embedded credentials", () => {
    const result = checkFetchUrl("https://user:pass@example.com/");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("source_invalid");
  });

  it("refuses non-standard ports", () => {
    const result = checkFetchUrl("https://example.com:8443/x");
    expect(result.ok).toBe(false);
  });

  it("refuses private/loopback IP-literal hosts", () => {
    for (const url of [
      "http://127.0.0.1/x",
      "http://10.1.2.3/x",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/x",
      "http://[fd00::1]/x",
    ]) {
      const result = checkFetchUrl(url);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("source_private_address");
    }
  });

  it("refuses localhost-style hostnames", () => {
    for (const url of ["http://localhost/x", "http://foo.localhost/x", "http://db.internal/x"]) {
      const result = checkFetchUrl(url);
      expect(result.ok).toBe(false);
    }
  });

  it("allowPrivate opens fixture servers for tests only", () => {
    expect(checkFetchUrl("http://127.0.0.1:4890/fixture", { allowPrivate: true }).ok).toBe(true);
  });
});
