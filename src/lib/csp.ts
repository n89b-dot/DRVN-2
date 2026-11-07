/**
 * The Content Security Policy the proxy sends on every page (src/proxy.ts).
 *
 * Stripe hosts are the Stripe.js set from Stripe's integration security guide
 * (docs.stripe.com/security/guide, "Content Security Policy" → Stripe.js),
 * scoped to what DRVN uses: the Payment Element for cards (checkout, saved
 * cards, settings) with 3-D Secure. `*.js.stripe.com` is where Stripe.js now
 * starts its card and 3-D Secure frames; `hooks.stripe.com` hosts redirect and
 * 3-D Secure challenge pages. Not added, because nothing here uses them:
 * `maps.googleapis.com` (Address Element autocomplete), Link's `*.link.com`
 * (payment_method_types is card-only), Checkout and Connect embedded
 * components. Add those with the feature that needs them.
 *
 * Violations are reported to CSP_REPORT_PATH, so a blocked payment frame shows
 * up in monitoring instead of failing silently.
 */
export const CSP_REPORT_PATH = "/api/monitoring/csp";
export const CSP_REPORT_GROUP = "csp";

const STRIPE_SCRIPTS = ["https://js.stripe.com", "https://*.js.stripe.com"];
const STRIPE_FRAMES = ["https://js.stripe.com", "https://*.js.stripe.com", "https://hooks.stripe.com"];
const STRIPE_CONNECT = ["https://api.stripe.com"];

export type CspOptions = {
  nonce: string;
  /** Supabase origin: http(s) for REST/storage, ws(s) for realtime. */
  supabaseOrigin: string;
  /** Dev server: React needs eval for its debugging tooling. */
  development: boolean;
  /** Plain-http local stack: no upgrade-insecure-requests. */
  allowInsecure: boolean;
};

export function buildContentSecurityPolicy({ nonce, supabaseOrigin, development, allowInsecure }: CspOptions): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic' lets the nonced bundle load Stripe.js in CSP3 browsers;
    // the host list is the fallback for browsers without it.
    ["script-src 'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(development ? ["'unsafe-eval'"] : []), ...STRIPE_SCRIPTS].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src 'self' data: blob: ${supabaseOrigin}`,
    ["connect-src 'self'", supabaseOrigin, supabaseOrigin.replace(/^http/, "ws"), ...STRIPE_CONNECT].join(" "),
    ["frame-src https://www.youtube-nocookie.com", ...STRIPE_FRAMES].join(" "),
    "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
    ...(allowInsecure ? [] : ["upgrade-insecure-requests"]),
    // report-to for the Reporting API (Chromium); report-uri for the rest —
    // browsers that understand report-to ignore report-uri.
    `report-uri ${CSP_REPORT_PATH}`,
    `report-to ${CSP_REPORT_GROUP}`,
  ].join("; ");
}

/** Pairs with `report-to` in the policy (Reporting API v1). */
export function reportingEndpointsHeader(): string {
  return `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`;
}
