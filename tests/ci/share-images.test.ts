// A link preview's picture must outlive the preview (work review #132, N1048).
//
// A member photo is a private object: the address a page shows is signed and
// stops working within two hours. Put in a page's metadata it becomes the
// share image a chat or a search engine keeps, and the picture is gone the
// next time the preview is fetched. So a page that shows member photos gets
// its share image from an `opengraph-image` route in its own segment, which
// Next.js serves at an address of ours, and its metadata names no image.
// (A profile's avatar is in a public bucket and its address is permanent.)
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");

function files(dir: string, name: RegExp, out: string[] = []): string[] {
  for (const item of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const relative = `${dir}/${item.name}`;
    if (item.isDirectory()) files(relative, name, out);
    else if (name.test(item.name)) out.push(relative);
  }
  return out;
}

/** The object literal that starts at the first "{" at or after `from`. */
function block(source: string, from: number): string {
  const open = source.indexOf("{", from);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  return source.slice(open);
}

/** The `images:` entries a file's metadata gives openGraph or twitter, as written. */
export function metadataImages(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/\b(?:openGraph|twitter):\s*\{/g)) {
    const body = block(source, match.index!);
    for (const images of body.matchAll(/\bimages:\s*([^\n]*)/g)) found.push(images[1].trim());
  }
  return found;
}

/** Permanent addresses: a public avatar, or a constant of ours. */
const PERMANENT = /\bavatar_url\b|\bSHARE_PHOTO\b/;

describe("N1048: a share image is an address that does not run out (work review #132)", () => {
  it("N1048: reads the images a page's metadata names", () => {
    expect(metadataImages("openGraph: {\n  title: t,\n  images: image?.url ? [{ url: image.url }] : undefined,\n},\ntwitter: { card: 'summary' }")).toEqual(["image?.url ? [{ url: image.url }] : undefined,"]);
    expect(metadataImages("openGraph: { title: t, url: `/cars/${slug}` },\ntwitter: {\n  images: [SHARE_PHOTO.url],\n}")).toEqual(["[SHARE_PHOTO.url],"]);
    expect(metadataImages("const images = rows; return { openGraph: { title } };")).toEqual([]);
  });

  it("N1048: no page or layout puts a member photo's own link in its metadata", () => {
    const offenders = files("src/app", /^(page|layout)\.tsx$/).flatMap((file) =>
      metadataImages(fs.readFileSync(path.join(root, file), "utf8"))
        .filter((images) => !PERMANENT.test(images))
        .map((images) => `${file}: images: ${images}`),
    );
    expect(offenders, "Give the segment an opengraph-image.tsx instead: a member photo's link is signed and stops working within two hours").toEqual([]);
  });

  it("N1048: every public page that shows a member's photos has a generated share image", () => {
    const segments = ["src/app/(discover)/listings/[id]", "src/app/(discover)/cars/[slug]", "src/app/(discover)/posts/[postId]", "src/app/(discover)/cars/[slug]/activity/[postId]"];
    for (const segment of segments) {
      const route = `${segment}/opengraph-image.tsx`;
      expect(fs.existsSync(path.join(root, route)), route).toBe(true);
      const source = fs.readFileSync(path.join(root, route), "utf8");
      // Read as a signed-out visitor, never with the server key; a size and a type for the crawler.
      expect(source, route).toContain("createPublicClient(");
      expect(source, route).not.toMatch(/createAdminClient|SERVICE_ROLE|SUPABASE_SECRET_KEY/);
      expect(source, route).toMatch(/export const size = \{ width: 1200, height: 630 \}/);
      expect(source, route).toMatch(/export const contentType = "image\/png"/);
    }
  });
});
