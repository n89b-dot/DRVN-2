/**
 * Source policy — the ONE place that decides how a pasted URL may be ingested.
 * Route components never test domains; they ask this module.
 *
 * Modes:
 *  - "public_url": DRVN attempts a single anonymous fetch of exactly the page
 *    the seller pasted. No crawling, no search, no link-following, no sessions.
 *    Facebook Marketplace is deliberately in this bucket: the attempt is
 *    user-directed, single-page and logged-out; when Facebook withholds the
 *    page (login wall / challenge), the SAME import falls forward to paste.
 *  - "paste_only": the site's access posture or terms make a direct fetch
 *    inappropriate or pointless — the seller pastes the post they already
 *    wrote and keeps URL provenance. Not an error state; a supported path.
 *  - "unsupported": not a fetchable listing URL at all.
 *
 * Adding/changing a source's behavior is an edit to POLICIES, nothing else.
 */

export type ImportAccessMode = "public_url" | "paste_only" | "unsupported";

export type SourcePolicy = {
  /** Adapter id recorded on the import row ("facebook", "generic", …). */
  adapterId: string;
  mode: ImportAccessMode;
  /** Seller-facing source name ("Facebook Marketplace", "golfmk7.com"). */
  label: string;
  /** Why this mode — documentation for maintainers, never shown to sellers. */
  reason: string;
};

type PolicyRule = {
  /** Matches a hostname (with or without subdomains). */
  hosts: string[];
  policy: Omit<SourcePolicy, "label"> & { label?: string };
};

const RULES: PolicyRule[] = [
  {
    hosts: ["facebook.com", "fb.com", "fb.me", "fb.watch"],
    policy: {
      adapterId: "facebook",
      mode: "public_url",
      label: "Facebook Marketplace",
      reason:
        "User-directed single-page anonymous attempt; login wall or challenge falls forward to paste. No sessions, no bypass, no crawling.",
    },
  },
  {
    hosts: ["craigslist.org"],
    policy: {
      adapterId: "paste",
      mode: "paste_only",
      label: "Craigslist",
      reason: "Craigslist's terms prohibit automated collection — paste keeps the seller moving.",
    },
  },
  {
    hosts: ["instagram.com"],
    policy: {
      adapterId: "paste",
      mode: "paste_only",
      label: "Instagram",
      reason: "Login-walled to anonymous requests; nothing useful is served without a session.",
    },
  },
  {
    hosts: ["discord.com", "discord.gg"],
    policy: {
      adapterId: "paste",
      mode: "paste_only",
      label: "Discord",
      reason: "Message links require guild membership — no public document exists to fetch.",
    },
  },
];

function hostMatches(hostname: string, ruleHost: string): boolean {
  return hostname === ruleHost || hostname.endsWith(`.${ruleHost}`);
}

/** Normalizes and validates a pasted URL string. Null = not a usable URL. */
export function parseImportUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!url.hostname.includes(".")) return null;
  return url;
}

/** The policy decision for a URL the seller pasted. */
export function policyFor(url: URL): SourcePolicy {
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  for (const rule of RULES) {
    if (rule.hosts.some((h) => hostMatches(hostname, h))) {
      return {
        adapterId: rule.policy.adapterId,
        mode: rule.policy.mode,
        label: rule.policy.label ?? hostname,
        reason: rule.policy.reason,
      };
    }
  }
  // Everything else: attempt the public page once; unknown engines resolve to
  // the generic extraction ladder, and a refusal falls forward to paste.
  return {
    adapterId: "generic",
    mode: "public_url",
    label: hostname,
    reason: "Unknown public site — one deterministic fetch, engine detected from the document.",
  };
}

/**
 * Canonical dedupe key for a source URL: scheme-insensitive, hash-free,
 * tracking-params-free. Same-listing re-pastes resume the same import.
 */
export function canonicalizeImportUrl(url: URL): string {
  const clean = new URL(url.href);
  clean.hash = "";
  clean.hostname = clean.hostname.toLowerCase().replace(/^www\./, "");
  clean.protocol = "https:";
  const params = clean.searchParams;
  const drop: string[] = [];
  params.forEach((_value, key) => {
    if (/^(utm_|fbclid|gclid|igsh|ref$|ref_|mibextid)/i.test(key)) drop.push(key);
  });
  for (const key of drop) params.delete(key);
  clean.search = params.toString() ? `?${params.toString()}` : "";
  if (clean.pathname !== "/" && clean.pathname.endsWith("/")) {
    clean.pathname = clean.pathname.replace(/\/+$/, "");
  }
  return clean.href;
}
