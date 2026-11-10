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

import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

const root = path.resolve(__dirname, "../..");

function files(dir: string, name: RegExp, out: string[] = []): string[] {
  for (const item of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const relative = `${dir}/${item.name}`;
    if (item.isDirectory()) files(relative, name, out);
    else if (name.test(item.name)) out.push(relative);
  }
  return out;
}

/** Permanent addresses: a public avatar, or a constant of ours. */
const PERMANENT = /\bavatar_url\b|\bSHARE_PHOTO\b/;
const IMAGE_KEYS = new Set(["og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src"]);

/**
 * The share images a source file's metadata names, read from its syntax tree
 * (review of #244: the first version read only `images:` written inline in an
 * `openGraph` or `twitter` literal). Each is the text of what the image is
 * given as, or a sentence saying why the scan could not read it; either way
 * it must be shown to be a permanent address.
 *  - `openGraph: { images: X }` and `twitter: { images: X }`: X;
 *  - `images` written as a shorthand, a spread inside either object, or
 *    either object given as a value built somewhere else: can't be read;
 *  - a raw `"og:image"` or `"twitter:image"` key anywhere (`metadata.other`).
 */
export function metadataImages(source: string, file = "page.tsx"): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const keyOf = (name: ts.PropertyName) => (ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : null);
  const visit = (node: ts.Node) => {
    if (ts.isShorthandPropertyAssignment(node) && (node.name.text === "openGraph" || node.name.text === "twitter")) {
      found.push(`${node.name.text} given as a value built elsewhere`);
    } else if (ts.isPropertyAssignment(node)) {
      const key = keyOf(node.name);
      if (key && IMAGE_KEYS.has(key)) found.push(`"${key}": ${node.initializer.getText(tree)}`);
      if (key === "openGraph" || key === "twitter") {
        const value = node.initializer;
        if (!ts.isObjectLiteralExpression(value)) found.push(`${key} given as a value built elsewhere: ${value.getText(tree).slice(0, 60)}`);
        else {
          for (const property of value.properties) {
            if (ts.isSpreadAssignment(property)) found.push(`${key} spreads ${property.expression.getText(tree)}, which may carry images`);
            else if (ts.isShorthandPropertyAssignment(property) && property.name.text === "images") found.push(`${key}.images given as a value built elsewhere`);
            else if (ts.isPropertyAssignment(property) && keyOf(property.name) === "images") found.push(property.initializer.getText(tree));
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

// ---- The card routes, run for real with their three outside doors replaced.
const calls = vi.hoisted(() => ({ order: [] as string[] }));
vi.mock("next/server", () => ({ connection: async () => { calls.order.push("connection"); } }));
vi.mock("next/og", () => ({ ImageResponse: class { constructor(readonly element: unknown, readonly options: unknown) { calls.order.push("image"); } } }));
vi.mock("@/lib/supabase/public", () => {
  /** A query that can be chained any way and answers "no rows": the card for a page nobody can read. */
  const query: unknown = new Proxy(function () {}, {
    get: (_target, property) => (property === "then" ? (resolve: (value: unknown) => unknown) => resolve({ data: null, count: 0, error: null }) : () => query),
    apply: () => query,
  });
  return { createPublicClient: () => { calls.order.push("read"); return query; } };
});

beforeEach(() => { calls.order.length = 0; });

describe("N1048: a share image is an address that does not run out (work review #132)", () => {
  it("N1048: reads the images a file's metadata names, however they are written", () => {
    expect(metadataImages("const m = { openGraph: {\n  title: t,\n  images: image?.url ? [{ url: image.url }] : undefined,\n},\ntwitter: { card: 'summary' } };")).toEqual(["image?.url ? [{ url: image.url }] : undefined"]);
    expect(metadataImages("const m = { openGraph: { title: t, url: `/cars/${slug}` },\ntwitter: {\n  images: [SHARE_PHOTO.url],\n} };")).toEqual(["[SHARE_PHOTO.url]"]);
    expect(metadataImages("const images = rows; export const m = { openGraph: { title } };")).toEqual([]);
    // What the first version of this scan could not see (review of #244).
    expect(metadataImages("const images = [photo.url]; return { openGraph: { title, images } };")).toEqual(["openGraph.images given as a value built elsewhere"]);
    expect(metadataImages("const og = { images: [photo.url] }; return { title, openGraph: og };")).toEqual(["openGraph given as a value built elsewhere: og"]);
    expect(metadataImages("return { openGraph: { ...shared, title } };")).toEqual(["openGraph spreads shared, which may carry images"]);
    expect(metadataImages("const twitter = card(photo); return { twitter };")).toEqual(["twitter given as a value built elsewhere"]);
    expect(metadataImages('return { other: { "og:image": photo.url } };')).toEqual(['"og:image": photo.url']);
    expect(metadataImages("return { openGraph: { 'images': photo.url } };")).toEqual(["photo.url"]);
  });

  it("N1048: nothing in the app puts a member photo's own link in a page's metadata", () => {
    // Every source file, not only pages: generateMetadata may build its answer in a helper.
    const offenders = files("src", /\.tsx?$/)
      .filter((file) => !/\.(test|d)\.tsx?$/.test(file))
      .flatMap((file) =>
        metadataImages(fs.readFileSync(path.join(root, file), "utf8"), file)
          .filter((images) => !PERMANENT.test(images))
          .map((images) => `${file}: ${images}`),
      );
    expect(offenders, "Give the segment an opengraph-image.tsx instead: a member photo's link is signed and stops working within two hours. If the scan could not read how the image is given, write it inline.").toEqual([]);
  });

  const SEGMENTS = ["src/app/(discover)/listings/[id]", "src/app/(discover)/cars/[slug]", "src/app/(discover)/posts/[postId]", "src/app/(discover)/cars/[slug]/activity/[postId]"];

  it("N1048: every public page that shows a member's photos has a generated share image", () => {
    for (const segment of SEGMENTS) {
      const route = `${segment}/opengraph-image.tsx`;
      expect(fs.existsSync(path.join(root, route)), route).toBe(true);
      const source = fs.readFileSync(path.join(root, route), "utf8");
      // Read as a signed-out visitor, never with the server key.
      expect(source, route).not.toMatch(/createAdminClient|SERVICE_ROLE|SUPABASE_SECRET_KEY/);
    }
  });

  it("N1048: each card, run, waits for a request before it reads anything, and declares no stored lifetime", async () => {
    const routes = files("src/app", /^(opengraph|twitter)-image\.tsx$/);
    // The four above at least; a card added later is held to the same rule.
    expect(routes).toEqual(expect.arrayContaining(SEGMENTS.map((segment) => `${segment}/opengraph-image.tsx`)));
    for (const route of routes) {
      const card = (await import(/* @vite-ignore */ path.join(root, route))) as Record<string, unknown>;
      // A size and a type for the crawler.
      expect(card.size, route).toEqual({ width: 1200, height: 630 });
      expect(card.contentType, route).toBe("image/png");
      // Nothing that would have the framework keep a render: a card drawn while
      // the photo signer had no answer has no photo, and must not be the card
      // everyone gets afterwards.
      expect(card.revalidate, route).toBeUndefined();
      expect(card.fetchCache, route).toBeUndefined();
      expect(card.generateStaticParams, route).toBeUndefined();
      expect([undefined, "force-dynamic"], route).toContain(card.dynamic);
      calls.order.length = 0;
      const rendered = await (card.default as (props: { params: Promise<Record<string, string>> }) => Promise<unknown>)({
        params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000", slug: "none", postId: "00000000-0000-4000-8000-000000000000" }),
      });
      expect(rendered, route).toBeTruthy();
      // The first thing it does is wait for a request; only then does it read, and then draw.
      expect(calls.order[0], `${route}: ${calls.order.join(", ")}`).toBe("connection");
      expect(calls.order.filter((step) => step === "connection"), route).toHaveLength(1);
      expect(calls.order, route).toContain("read");
      expect(calls.order.at(-1), route).toBe("image");
    }
  });
});
