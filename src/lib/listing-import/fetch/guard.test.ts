import { describe, expect, it } from "vitest";

import { canonicalAddress, checkFetchUrl, isForbiddenAddress } from "./guard";

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

// N76: every notation of a private or special-purpose address, and the
// public ones that must still pass. Canonicalised before the range checks.
describe("address corpus (IPv6 and embedded IPv4)", () => {
  const forbidden: [string, string][] = [
    // IPv4-mapped, in every spelling
    ["::ffff:7f00:1", "mapped loopback, hex"],
    ["0:0:0:0:0:ffff:127.0.0.1", "mapped loopback, uncompressed"],
    ["0000:0000:0000:0000:0000:FFFF:7F00:0001", "mapped loopback, padded upper-case"],
    ["::FFFF:169.254.169.254", "mapped metadata"],
    ["::ffff:a9fe:a9fe", "mapped metadata, hex"],
    ["[::ffff:10.0.0.1]", "mapped RFC1918, bracketed"],
    // IPv4-compatible (deprecated ::/96) and IPv4-translated
    ["::127.0.0.1", "compatible loopback"],
    ["::7f00:1", "compatible loopback, hex"],
    ["::a9fe:a9fe", "compatible metadata"],
    ["::8.8.8.8", "compatible public: deprecated, never a website"],
    ["::ffff:0:127.0.0.1", "translated loopback"],
    ["::ffff:0:7f00:1", "translated loopback, hex"],
    // NAT64
    ["64:ff9b::127.0.0.1", "NAT64 loopback, dotted"],
    ["64:ff9b::a9fe:a9fe", "NAT64 metadata"],
    ["64:ff9b:0:0:0:0:c0a8:1", "NAT64 RFC1918, uncompressed"],
    ["64:ff9b:1::808:808", "local-use NAT64"],
    // 6to4 carrying a private IPv4
    ["2002:7f00:1::", "6to4 loopback"],
    ["2002:a9fe:a9fe::1", "6to4 metadata"],
    ["2002:c0a8:101::1", "6to4 RFC1918"],
    // Teredo and the rest of 2001::/23
    ["2001::1", "Teredo"],
    ["2001:0:4136:e378:8000:63bf:3fff:fdd2", "Teredo client"],
    ["2001:2::1", "benchmarking"],
    ["2001:10::1", "ORCHID"],
    ["2001:db8:85a3::8a2e:370:7334", "documentation"],
    ["3fff::1", "documentation 3fff::/20"],
    ["3ffe::1", "returned 6bone"],
    // Outside global unicast
    ["fec0::1", "site-local"],
    ["febf::1", "link-local top"],
    ["fe80::1%25eth0", "link-local, encoded zone"],
    ["100::1", "discard-only"],
    ["::2", "IPv4-compatible space"],
    ["4000::1", "unassigned"],
    ["e000::1", "unassigned"],
    ["ff0e::1", "global multicast"],
    // Malformed: fail closed
    ["1::2::3", "two ::"],
    ["1:2:3:4:5:6:7:8::", "a :: that stands for nothing"],
    ["12345::1", "five-digit group"],
    ["::ffff:127.1", "short embedded IPv4"],
    ["::ffff:256.0.0.1", "out-of-range embedded IPv4"],
    ["1:2:3:4:5:6:7", "seven groups"],
    ["1:2:3:4:5:6:7:8:9", "nine groups"],
    ["g::1", "not hex"],
    ["192.88.99.1", "6to4 relay anycast"],
  ];
  for (const [address, why] of forbidden) {
    it(`refuses ${address} (${why})`, () => {
      expect(isForbiddenAddress(address)).toBe(true);
    });
  }

  const allowed = [
    "2606:4700:4700::1111",
    "2a00:1450:4009:81f::200e",
    "2001:4860:4860::8888",
    "2600::1",
    "3ffd:ffff::1",
    "::ffff:93.184.216.34",
    "0:0:0:0:0:ffff:5db8:d822",
    "64:ff9b::8.8.8.8",
    "64:ff9b::808:808",
    "2002:808:808::1",
  ];
  for (const address of allowed) {
    it(`allows ${address}`, () => {
      expect(isForbiddenAddress(address)).toBe(false);
    });
  }

  it("canonicalises a mapped address to the IPv4 address it wraps", () => {
    expect(canonicalAddress("::ffff:7f00:1")).toEqual({ family: 4, value: 0x7f000001 });
    expect(canonicalAddress("0:0:0:0:0:FFFF:127.0.0.1")).toEqual({ family: 4, value: 0x7f000001 });
    expect(canonicalAddress("2606:4700::1")).toEqual({ family: 6, hextets: [0x2606, 0x4700, 0, 0, 0, 0, 0, 1] });
    expect(canonicalAddress("nope")).toBeNull();
  });

  it("refuses alternate IPv4 and IPv6 notations in a URL's host", () => {
    for (const url of [
      "http://0x7f.1/",
      "http://2130706433/",
      "http://0177.0.0.1/",
      "http://127.1/",
      "http://127.0.0.1./",
      "http://0xa9.0xfe.0xa9.0xfe/latest/meta-data/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:7f00:1]/",
      "http://[0:0:0:0:0:ffff:a9fe:a9fe]/",
      "http://[::127.0.0.1]/",
      "http://[64:ff9b::169.254.169.254]/",
      "http://[2002:7f00:1::]/",
      "http://[2001::1]/",
      "http://[fec0::1]/",
    ]) {
      const result = checkFetchUrl(url);
      expect(result.ok, url).toBe(false);
      if (!result.ok) expect(result.code, url).toBe("source_private_address");
    }
    expect(checkFetchUrl("https://[2606:4700:4700::1111]/").ok).toBe(true);
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
