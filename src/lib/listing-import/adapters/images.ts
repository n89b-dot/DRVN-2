import type { ImportImageCandidate } from "../schema";

/**
 * Shared candidate-image filtering for adapters: drop the graphics that are
 * never listing photos (avatars, smilies, reaction icons, signature banners,
 * tracking pixels, SVG) before anything is downloaded.
 */

const JUNK_PATTERNS =
  /(avatar|smil(ey|ies)|emoji|emoticon|badge|button|icon|sprite|logo|signature|banner|pixel|spacer|blank|loading|placeholder)/i;

export function filterImageCandidates(
  candidates: ImportImageCandidate[],
  max = 16
): ImportImageCandidate[] {
  const seen = new Set<string>();
  const kept: ImportImageCandidate[] = [];
  for (const candidate of candidates) {
    const url = candidate.url;
    if (!/^https?:\/\//i.test(url)) continue;
    let pathname: string;
    try {
      pathname = new URL(url).pathname.toLowerCase();
    } catch {
      continue;
    }
    if (pathname.endsWith(".svg") || pathname.endsWith(".gif")) continue;
    if (JUNK_PATTERNS.test(url)) continue;
    // Declared-tiny images are decoration; real photos say nothing or say big.
    if ((candidate.width && candidate.width < 200) || (candidate.height && candidate.height < 200)) {
      continue;
    }
    const key = url.split("#")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(candidate);
    if (kept.length >= max) break;
  }
  return kept;
}
