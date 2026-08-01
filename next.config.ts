import type { NextConfig } from "next";

/** Supabase storage host, derived from the project URL. */
function supabaseHost(): string | null {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
      : null;
  } catch {
    return null;
  }
}

const host = supabaseHost();

/**
 * Security headers. `Content-Security-Policy` is deliberately conservative but
 * has to allow what the app actually uses: inline styles (Tailwind's runtime
 * layer and the `Rv` reveal styles), Supabase over https/wss, and
 * youtube-nocookie frames for activity embeds.
 *
 * `'unsafe-inline'` for scripts is required by Next's inlined bootstrap; a nonce
 * -based policy is the upgrade once there's a reason to tighten further.
 */
// Stripe.js loads from js.stripe.com, talks to api.stripe.com and renders
// its 3DS/payment frames from js.stripe.com + hooks.stripe.com — the
// officially documented CSP allowances for the Payment Element.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  `img-src 'self' data: blob: https://${host ?? "*.supabase.co"}`,
  `connect-src 'self' https://${host ?? "*.supabase.co"} wss://${host ?? "*.supabase.co"} https://api.stripe.com`,
  "frame-src https://www.youtube-nocookie.com https://js.stripe.com https://hooks.stripe.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  images: {
    // Storage-hosted media was served unoptimized at full size to an
    // image-heavy feed; this turns resizing and modern formats back on.
    remotePatterns: host
      ? [{ protocol: "https", hostname: host, pathname: "/storage/v1/object/public/**" }]
      : [],
    formats: ["image/avif", "image/webp"],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
