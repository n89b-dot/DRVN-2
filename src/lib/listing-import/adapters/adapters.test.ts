import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadHtml } from "../extract/html";
import { policyFor } from "../policy";
import { fetchNormalizedSource } from "./index";
import { fetchFacebookListing } from "./facebook";
import { extractForumFirstPost } from "./forums";
import { filterImageCandidates } from "./images";
import { extractListing } from "../extract/ai";
import { finalizeExtraction } from "../extract/validate";
import {
  DISCOURSE_SHELL,
  DISCOURSE_TOPIC_JSON,
  FACEBOOK_EVO_EXHAUST,
  FACEBOOK_LISTING_GONE,
  FACEBOOK_LOGIN_WALL,
  FACEBOOK_OPENGRAPH_ONLY,
  FACEBOOK_XR50_WHEELS,
  facebookMarketplacePage,
  GENERIC_JSONLD_LISTING,
  PHPBB_TOPIC,
  VBULLETIN_THREAD,
  XENFORO_THREAD,
} from "./fixtures";

/**
 * Fixture-driven adapter tests. String-parsable engines (XenForo, vBulletin,
 * phpBB) are tested directly; everything that fetches (Discourse JSON,
 * Facebook, the generic ladder) runs against a local fixture server through
 * the real safeFetch path (allowPrivate = the test escape hatch).
 */

let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const html = (body: string) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(body);
    };
    if (url.startsWith("/t/fs-034-dogbone/55.json")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(DISCOURSE_TOPIC_JSON);
    } else if (url.startsWith("/t/fs-034-dogbone/55")) {
      html(DISCOURSE_SHELL);
    } else if (url.startsWith(`/marketplace/item/${FACEBOOK_EVO_EXHAUST.id}`)) {
      html(facebookMarketplacePage(FACEBOOK_EVO_EXHAUST));
    } else if (url.startsWith(`/marketplace/item/${FACEBOOK_XR50_WHEELS.id}`)) {
      html(facebookMarketplacePage(FACEBOOK_XR50_WHEELS));
    } else if (url.startsWith("/marketplace/item/1234567890")) {
      html(FACEBOOK_OPENGRAPH_ONLY);
    } else if (url.startsWith("/marketplace/item/456282203388872")) {
      html(FACEBOOK_LISTING_GONE);
    } else if (url.startsWith("/marketplace/item/999")) {
      html(FACEBOOK_LOGIN_WALL);
    } else if (url.startsWith("/products/apr-turbo-inlet")) {
      html(GENERIC_JSONLD_LISTING);
    } else if (url.startsWith("/threads/fs-apr-downpipe.412")) {
      html(XENFORO_THREAD);
    } else {
      res.writeHead(404);
      res.end("nope");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const fetchOpts = { allowPrivate: true, browserEnabled: false };

describe("forum engine extraction (first post only)", () => {
  it("XenForo: OP text + attachments, no replies, no avatars, no quotes", () => {
    const $ = loadHtml(XENFORO_THREAD);
    const result = extractForumFirstPost($, XENFORO_THREAD, "https://forum.example/threads/fs-apr-downpipe.412/");
    expect(result?.adapter).toBe("xenforo");
    const source = result?.source;
    expect(source?.title).toContain("APR Stage 2 Downpipe");
    expect(source?.text).toContain("$450 shipped OBO");
    expect(source?.text).toContain("DPK0018");
    expect(source?.text).not.toContain("bump");
    expect(source?.text).not.toContain("quoting someone else");
    const urls = source?.images.map((i) => i.url) ?? [];
    expect(urls.some((u) => u.includes("downpipe-front"))).toBe(true);
    expect(urls.some((u) => u.includes("downpipe-side"))).toBe(true);
    expect(urls.some((u) => u.includes("avatar"))).toBe(false);
  });

  it("vBulletin: first post only", () => {
    const $ = loadHtml(VBULLETIN_THREAD);
    const result = extractForumFirstPost($, VBULLETIN_THREAD, "https://old.example/showthread.php?t=1");
    expect(result?.adapter).toBe("vbulletin");
    expect(result?.source?.text).toContain("Bilstein B16");
    expect(result?.source?.text).not.toContain("glws");
  });

  it("phpBB: first post only", () => {
    const $ = loadHtml(PHPBB_TOPIC);
    const result = extractForumFirstPost($, PHPBB_TOPIC, "https://phpbb.example/viewtopic.php?t=2");
    expect(result?.adapter).toBe("phpbb");
    expect(result?.source?.text).toContain("curb rash");
    expect(result?.source?.text).not.toContain("pm sent");
  });
});

describe("fetchNormalizedSource", () => {
  it("detects Discourse and prefers the topic JSON", async () => {
    const url = new URL(`${base}/t/fs-034-dogbone/55`);
    const outcome = await fetchNormalizedSource(policyFor(url), url, fetchOpts);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.adapter).toBe("discourse");
      expect(outcome.source.title).toContain("034 dogbone");
      expect(outcome.source.text).toContain("$60 shipped");
      expect(outcome.source.text).not.toContain("someone quoted");
      expect(outcome.source.images[0]?.url).toContain("insert.jpg");
    }
  });

  it("detects XenForo on an unknown domain from the document itself", async () => {
    const url = new URL(`${base}/threads/fs-apr-downpipe.412/`);
    const outcome = await fetchNormalizedSource(policyFor(url), url, fetchOpts);
    expect(outcome.ok && outcome.adapter).toBe("xenforo");
  });

  it("generic ladder reads JSON-LD product facts", async () => {
    const url = new URL(`${base}/products/apr-turbo-inlet`);
    const outcome = await fetchNormalizedSource(policyFor(url), url, fetchOpts);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.adapter).toBe("generic");
      expect(outcome.source.title).toBe("APR Turbo Inlet");
      expect(outcome.source.structuredFacts?.priceText).toBe("189.00");
      expect(outcome.source.structuredFacts?.currency).toBe("USD");
      expect(outcome.source.structuredFacts?.partNumber).toBe("MS100141");
      expect(outcome.source.images.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("Facebook adapter", () => {
  const fb = (path: string) =>
    fetchFacebookListing(new URL(`${base}${path}`), { allowPrivate: true, browserEnabled: false });

  it("reads the linked listing's own data, never a recommended listing's", async () => {
    const outcome = await fb(`/marketplace/item/${FACEBOOK_EVO_EXHAUST.id}/`);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { source } = outcome;
    expect(source.title).toBe("Evo X Turbo XS exhaust");
    expect(source.structuredFacts?.priceText).toBe("$200");
    expect(source.structuredFacts?.currency).toBe("USD");
    expect(source.structuredFacts?.location).toBe("San Bruno, CA");
    expect(source.structuredFacts?.conditionText).toBe("Used - Good");
    expect(source.text).toContain("no leaks");
    expect(source.canonicalUrl).toBe(`https://www.facebook.com/marketplace/item/${FACEBOOK_EVO_EXHAUST.id}/`);
    // The neighbours on the page ($100 kayak, $25 pillow) leave no trace.
    const serialized = JSON.stringify(source);
    expect(serialized).not.toMatch(/Kayak|Pillow|Commodore|neighbour/);
    expect(outcome.rendered).toBe(false);
  });

  it("imports the whole gallery in order, not OpenGraph's single crop", async () => {
    const outcome = await fb(`/marketplace/item/${FACEBOOK_EVO_EXHAUST.id}/`);
    expect(outcome.ok && outcome.source.images.map((i) => i.url)).toEqual(FACEBOOK_EVO_EXHAUST.photos);
  });

  it("carries a foreign currency through, and the draft gets no dollar price", async () => {
    const outcome = await fb(`/marketplace/item/${FACEBOOK_XR50_WHEELS.id}/`);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.source.structuredFacts?.priceText).toBe("A$1,850");
    expect(outcome.source.structuredFacts?.currency).toBe("AUD");

    const ai = await extractListing(outcome.source, { aiMode: "stub", model: "x", browserEnabled: false, allowPrivateHosts: true }, { ownerId: "44444444-4444-4444-8444-444444444444" });
    const finalized = ai.ok ? finalizeExtraction(ai.raw, outcome.source) : null;
    expect(finalized?.ok).toBe(true);
    if (!finalized?.ok) return;
    expect(finalized.extraction.priceCents).toBeUndefined();
    const price = finalized.extraction.needsReview.find((issue) => issue.field === "price");
    expect(price?.message).toContain("A$1,850");
    expect(price?.message).toContain("US dollars");
  });

  it("falls back to OpenGraph alone when the embedded data is missing — no page-wide guessing", async () => {
    const outcome = await fb("/marketplace/item/1234567890/");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.source.title).toBe("APR Intercooler MK7 GTI/R");
    expect(outcome.source.text).toContain("bent fins");
    expect(outcome.source.structuredFacts?.priceText).toBeUndefined();
    expect(outcome.source.images.map((i) => i.url)).toEqual(["https://scontent.example/v/ic1.jpg"]);
  });

  it("reports a removed listing as gone, not as a login wall", async () => {
    const outcome = await fb("/marketplace/item/456282203388872/");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("source_listing_gone");
      expect(outcome.attemptedRender).toBe(false);
    }
  });

  it("stops at a login wall and reports the paste fallback", async () => {
    const outcome = await fb("/marketplace/item/999/");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("source_login_required");
      expect(outcome.attemptedRender).toBe(false);
    }
  });
});

describe("filterImageCandidates", () => {
  it("drops avatars, icons, SVG/GIF and declared-tiny graphics", () => {
    const kept = filterImageCandidates([
      { url: "https://x.example/photos/real-part.jpg" },
      { url: "https://x.example/avatars/user.jpg" },
      { url: "https://x.example/styles/smilies/wink.gif" },
      { url: "https://x.example/logo.svg" },
      { url: "https://x.example/pixel.png", width: 1, height: 1 },
      { url: "https://x.example/photos/real-part.jpg" }, // duplicate
    ]);
    expect(kept.map((c) => c.url)).toEqual(["https://x.example/photos/real-part.jpg"]);
  });
});
