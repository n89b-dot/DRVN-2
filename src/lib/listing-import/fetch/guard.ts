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
    const fillers = 8 - head.length - tail.length - (v4Tail?.length ?? 0);
    if (fillers < 0) return null;
    hextets = [...head, ...Array(fillers).fill(0), ...tail, ...(v4Tail ?? [])];
  } else {
    const groups = parseGroups(ip);
    if (!groups) return null;
    hextets = [...groups, ...(v4Tail ?? [])];
  }
  return hextets.length === 8 ? hextets : null;
}

function isForbiddenIpv6(hextets: number[]): boolean {
  const [h0] = hextets;
  const isZero = (from: number, to: number) => hextets.slice(from, to).every((h) => h === 0);

  // :: (unspecified) and ::1 (loopback)
  if (isZero(0, 7) && (hextets[7] === 0 || hextets[7] === 1)) return true;
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-translated ::ffff:0:a.b.c.d / 64:ff9b::/96
  if (isZero(0, 5) && hextets[5] === 0xffff) {
    return isForbiddenIpv4(((hextets[6] << 16) | hextets[7]) >>> 0);
  }
  if (h0 === 0x64 && hextets[1] === 0xff9b) {
    return isForbiddenIpv4(((hextets[6] << 16) | hextets[7]) >>> 0);
  }
  // fe80::/10 link-local, fc00::/7 unique-local, ff00::/8 multicast
  if ((h0 & 0xffc0) === 0xfe80) return true;
  if ((h0 & 0xfe00) === 0xfc00) return true;
  if ((h0 & 0xff00) === 0xff00) return true;
  // 2001:db8::/32 documentation
  if (h0 === 0x2001 && hextets[1] === 0x0db8) return true;
  return false;
}

/**
 * True when the resolved address must never be connected to. Accepts IPv4 and
 * IPv6 literals in the forms DNS resolution produces.
 */
export function isForbiddenAddress(address: string): boolean {
  const v4 = parseIpv4(address);
  if (v4 !== null) return isForbiddenIpv4(v4);
  const v6 = parseIpv6(address);
  if (v6 !== null) return isForbiddenIpv6(v6);
  // Unparseable = unknowable = forbidden. Fail closed.
  return true;
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
