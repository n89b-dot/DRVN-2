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
  },

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
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
