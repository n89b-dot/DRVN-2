/**
 * A product link that may go on a member's build (OS-W07 N124). An agent's
 * build draft can carry a link, and the model may have read a listing or a
 * message that tries to plant one, so a drafted link is held to three rules:
 *
 * 1. It is a plain public web address: http(s), no user name or password,
 *    no port, a dotted public host name (never an IP address, localhost or
 *    an internal name), at most 2,000 characters (safeProductLink).
 * 2. On the model's turn it is one the member gave: a link they typed in
 *    that message, or the page read_part_link read for them. The member's
 *    own address is kept, never the model's spelling of it (memberLink).
 * 3. The confirm card shows its host and its full address, and Confirm saves
 *    exactly the link the card showed (features/agent/build.ts).
 *
 * Pure: the chat's card, the mods editor and the server share it.
 */

export type SafeLink = { url: string; host: string };

const MAX_LINK = 2_000;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const INTERNAL = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|test|example|invalid|onion)$/;

export function safeProductLink(raw: unknown): SafeLink | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.length > MAX_LINK) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.port) return null;
  // URL lowercases the host and writes an international name as punycode
  // (xn--…), so a look-alike host shows as what it really is.
  const host = url.hostname;
  if (!host || host.includes(":") || host.startsWith("[") || IPV4.test(host)) return null;
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null;
  const tld = labels[labels.length - 1];
  if (!/^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld) || INTERNAL.test(host)) return null;
  if (url.href.length > MAX_LINK) return null;
  return { url: url.href, host };
}

/** The links in a message, as typed (trailing punctuation dropped). */
export function linksIn(message: string): string[] {
  return (message.match(/https?:\/\/[^\s<>"']+/gi) ?? []).map((match) => match.replace(/[).,!?]+$/, ""));
}

/** Same page: host without www, and path without a trailing slash. */
export function linkKey(link: URL): string {
  return `${link.hostname.replace(/^www\./, "").toLowerCase()}${link.pathname.replace(/\/$/, "")}`;
}

/**
 * The member's own link for the page a draft points at, or null when the
 * draft's link isn't one they gave. Matched by host and path; what comes
 * back is the member's address, checked by safeProductLink, so a query
 * string or fragment the model added is never kept.
 */
export function memberLink(proposed: string, given: readonly string[]): SafeLink | null {
  const wanted = safeProductLink(proposed);
  if (!wanted) return null;
  const key = linkKey(new URL(wanted.url));
  for (const candidate of given) {
    const safe = safeProductLink(candidate);
    if (safe && linkKey(new URL(safe.url)) === key) return safe;
  }
  return null;
}
