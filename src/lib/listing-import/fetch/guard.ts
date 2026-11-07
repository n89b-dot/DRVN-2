/**
 * Pure address validation for the safe fetcher — every rule the SSRF tests
 * assert lives here, dependency-free and unit-testable.
 *
 * The threat: "please have DRVN's server fetch http://169.254.169.254/ for
 * me." Every hostname is resolved BEFORE connecting and every resolved
 * address must be public; redirects re-run the whole gauntlet.
 */

/** Parses a dotted-quad IPv4 string into its 32-bit value, or null. */
function parseIpv4(host: string): number | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inRange(value: number, base: number, maskBits: number): boolean {
  const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
  return (value & mask) === (base & mask);
}

const V4 = (a: number, b: number, c: number, d: number) =>
  (((a << 24) | (b << 16) | (c << 8) | d) >>> 0);

/** Forbidden IPv4 space: loopback, RFC1918, link-local (incl. cloud metadata
 *  at 169.254.169.254), CGN, benchmarks, doc nets, multicast, reserved. */
const FORBIDDEN_V4: [number, number][] = [
  [V4(0, 0, 0, 0), 8], // "this" network
  [V4(10, 0, 0, 0), 8], // RFC1918
  [V4(100, 64, 0, 0), 10], // CGN
  [V4(127, 0, 0, 0), 8], // loopback
  [V4(169, 254, 0, 0), 16], // link-local + cloud metadata
  [V4(172, 16, 0, 0), 12], // RFC1918
  [V4(192, 0, 0, 0), 24], // IETF protocol assignments
  [V4(192, 0, 2, 0), 24], // TEST-NET-1
  [V4(192, 88, 99, 0), 24], // 6to4 relay anycast (deprecated)
  [V4(192, 168, 0, 0), 16], // RFC1918
  [V4(198, 18, 0, 0), 15], // benchmarking
  [V4(198, 51, 100, 0), 24], // TEST-NET-2
  [V4(203, 0, 113, 0), 24], // TEST-NET-3
  [V4(224, 0, 0, 0), 4], // multicast
  [V4(240, 0, 0, 0), 4], // reserved + broadcast
];

function isForbiddenIpv4(value: number): boolean {
  return FORBIDDEN_V4.some(([base, bits]) => inRange(value, base, bits));
}

/** Expands an IPv6 string into 8 hextets, or null when unparseable. */
function parseIpv6(host: string): number[] | null {
  let ip = host.trim().toLowerCase();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  // Zone index (fe80::1%eth0) — strip; the address part decides.
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);

  // Embedded IPv4 tail (::ffff:127.0.0.1)
  let v4Tail: number[] | null = null;
  const lastColon = ip.lastIndexOf(":");
  if (lastColon !== -1 && ip.includes(".", lastColon)) {
    const v4 = parseIpv4(ip.slice(lastColon + 1));
    if (v4 === null) return null;
    v4Tail = [(v4 >>> 16) & 0xffff, v4 & 0xffff];
    ip = ip.slice(0, lastColon + 1);
    if (!ip.endsWith("::")) ip = ip.slice(0, -1); // drop trailing ':' unless it's '::'
  }

  const doubleColon = ip.indexOf("::");
  if (doubleColon !== ip.lastIndexOf("::")) return null;

  const parseGroups = (part: string): number[] | null => {
    if (!part) return [];
    const groups = part.split(":");
    const out: number[] = [];
    for (const g of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  let hextets: number[];
  if (doubleColon !== -1) {
    const head = parseGroups(ip.slice(0, doubleColon));
    const tail = parseGroups(ip.slice(doubleColon + 2));
    if (!head || !tail) return null;
    // "::" stands for at least one zero group; anything else is malformed.
    const fillers = 8 - head.length - tail.length - (v4Tail?.length ?? 0);
    if (fillers < 1) return null;
    hextets = [...head, ...Array(fillers).fill(0), ...tail, ...(v4Tail ?? [])];
  } else {
    const groups = parseGroups(ip);
    if (!groups) return null;
    hextets = [...groups, ...(v4Tail ?? [])];
  }
  return hextets.length === 8 ? hextets : null;
}

/**
 * An address in one canonical form, whatever notation it arrived in. An IPv6
 * address that is only a wrapper for an IPv4 one — IPv4-mapped
 * (::ffff:a.b.c.d, also written ::ffff:7f00:1 or 0:0:0:0:0:ffff:127.0.0.1) —
 * becomes that IPv4 address, so the IPv4 rules decide it and no spelling of
 * 127.0.0.1 is treated as "some IPv6 address". Null when unparseable.
 */
export type CanonicalAddress = { family: 4; value: number } | { family: 6; hextets: number[] };

export function canonicalAddress(address: string): CanonicalAddress | null {
  const v4 = parseIpv4(address.trim());
  if (v4 !== null) return { family: 4, value: v4 };
  const v6 = parseIpv6(address);
  if (v6 === null) return null;
  if (v6.slice(0, 5).every((h) => h === 0) && v6[5] === 0xffff) {
    return { family: 4, value: (((v6[6] << 16) | v6[7]) >>> 0) };
  }
  return { family: 6, hextets: v6 };
}

const embedded = (high: number, low: number) => (((high << 16) | low) >>> 0);

/**
 * Forbidden IPv6 space, as an allow-list: only global unicast (2000::/3) is
 * ever a website. Everything outside it is refused — unspecified and
 * loopback, the deprecated IPv4-compatible ::a.b.c.d (::/96), IPv4-translated
 * ::ffff:0:a.b.c.d, discard-only 100::/64, local-use NAT64 64:ff9b:1::/48,
 * unique-local fc00::/7, link-local fe80::/10, the old site-local fec0::/10,
 * multicast ff00::/8 and every unassigned block — except well-known NAT64
 * (64:ff9b::/96), where the IPv4 address it carries decides. Inside 2000::/3
 * the special-purpose blocks are refused, and 6to4 (2002::/16) is judged by
 * the IPv4 address it carries.
 */
function isForbiddenIpv6(h: number[]): boolean {
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) {
    return isForbiddenIpv4(embedded(h[6], h[7]));
  }
  if ((h[0] & 0xe000) !== 0x2000) return true;
  // 2001::/23 IETF protocol assignments: Teredo 2001::/32 (an obfuscated
  // IPv4 client address), benchmarking 2001:2::/48, ORCHID and the rest.
  if (h[0] === 0x2001 && h[1] < 0x0200) return true;
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true; // documentation
  if (h[0] === 0x2002) return isForbiddenIpv4(embedded(h[1], h[2])); // 6to4
  if (h[0] === 0x3ffe) return true; // the returned 6bone block
  if (h[0] === 0x3fff && (h[1] & 0xf000) === 0) return true; // documentation 3fff::/20
  return false;
}

/**
 * True when the resolved address must never be connected to. Accepts IPv4 and
 * IPv6 literals in any notation; each is canonicalised first.
 */
export function isForbiddenAddress(address: string): boolean {
  const canonical = canonicalAddress(address);
  // Unparseable = unknowable = forbidden. Fail closed.
  if (!canonical) return true;
  return canonical.family === 4 ? isForbiddenIpv4(canonical.value) : isForbiddenIpv6(canonical.hextets);
}

export type UrlCheck =
  | { ok: true; url: URL }
  | { ok: false; code: "source_invalid" | "source_private_address" };

/**
 * Structural checks that need no network: scheme, credentials, port, and
 * IP-literal hosts. DNS-resolved addresses are checked at connect time by the
 * fetcher's pinned lookup (guarding against rebinding between checks).
 */
export function checkFetchUrl(raw: string, opts?: { allowPrivate?: boolean }): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: "source_invalid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, code: "source_invalid" };
  }
  if (url.username || url.password) return { ok: false, code: "source_invalid" };
  if (url.port && url.port !== "80" && url.port !== "443") {
    if (!opts?.allowPrivate) return { ok: false, code: "source_invalid" };
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!opts?.allowPrivate) {
    // An IP-literal host skips DNS, so check it here.
    if (/^[\d.]+$/.test(host) || host.includes(":")) {
      if (isForbiddenAddress(host)) return { ok: false, code: "source_private_address" };
    }
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
      return { ok: false, code: "source_private_address" };
    }
  }
  return { ok: true, url };
}
