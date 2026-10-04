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
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL) : null;
const isolatedLocal = process.env.E2E_TEST_PROJECT_REF === "local-drvn-remediation" && ["127.0.0.1", "localhost"].includes(host || "") && supabaseUrl?.port === "54321";

const nextConfig: NextConfig = {
  // Isolated production benchmarks can coexist with the development server.
  distDir: process.env.DRVN_NEXT_DIST_DIR || ".next",
  // Listing-importer server deps that must stay native `require`s rather than
  // being bundled into server components: playwright-core is resolved
  // dynamically (optional rendering fallback — src/lib/listing-import/fetch/
  // render.ts); sharp/jsdom are on Next's built-in external list already.
  serverExternalPackages: ["playwright-core"],

  // The docs markdown route reads repo markdown off disk at request time
  // (src/app/(docs)/docs/md/[slug]/route.ts — registry in src/lib/docs/site.ts).
  // The read is marked turbopackIgnore so the tracer doesn't pull in the whole
  // project; these globs ship the actual documents with the route instead.
  outputFileTracingIncludes: {
    "/docs/md/[slug]": ["./docs/**/*.md", "./design-mockups/livesheet/design.md"],
  },

  images: {
    // Storage-hosted media was served unoptimized at full size to an
    // image-heavy feed; this turns resizing and modern formats back on.
    dangerouslyAllowLocalIP: isolatedLocal,
    remotePatterns: host
      ? [{ protocol: isolatedLocal ? "http" : "https", hostname: host, port: isolatedLocal ? "54321" : "", pathname: "/storage/v1/object/public/**" }]
      : [],
    formats: ["image/avif", "image/webp"],
    // Storage paths are content-unique (UUID per upload) and never rewritten,
    // so a resized variant can live a month. The 4-hour default forced the
    // slow AVIF re-encode (0.6–1 s per image) again every four hours.
    minimumCacheTTL: 2678400,
    // Uploads are capped at 2560px (src/lib/media-upload.ts), so a 3840px
    // variant is an upscale nobody needs — and the slowest encode there is.
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 2560],
  },

  // No `experimental.staleTimes.dynamic` (added in a164315, removed 1 Oct):
  // with a 30 s client copy, a prefetched page could be served stale after a
  // server action + router.refresh() — creating a beta invitation left it
  // out of "Recent invitations" until a manual reload (e2e/beta-invitations).
  // Bring back client reuse only with a fix that keeps action results fresh.

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            // `payment=()` blocked the Payment Request API everywhere,
            // including inside Stripe's Payment Element frame, which is how
            // Apple Pay and Google Pay render — so wallets silently never
            // appeared at checkout. Payment is now delegable to this origin
            // and to Stripe.js's frame origin (the only Stripe frame origin
            // the CSP's frame-src admits, src/proxy.ts); every other origin,
            // and every other sensitive feature, stays blocked.
            key: "Permissions-Policy",
            value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com")',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
