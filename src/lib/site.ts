/**
 * The canonical origin. Needed by `metadataBase`, the sitemap and robots — a
 * relative OpenGraph image URL resolves against nothing without it, which is why
 * share previews had no artwork.
 *
 * Set `NEXT_PUBLIC_SITE_URL` in the deployment environment. Vercel's
 * `VERCEL_PROJECT_PRODUCTION_URL` is used as a fallback so preview deploys still
 * produce absolute URLs.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;

  return "http://localhost:3000";
}
