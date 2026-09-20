import { normalizeBlocks, type ActivityBlock } from "@/lib/activity-blocks";
import type { Json } from "@/lib/database.types";

/**
 * What to call a post that may not have a title (W-1).
 *
 * A quick post is a photo and a caption. Giving it a generated heading would
 * be writing on somebody's behalf — "Update from the Silvia" is DRVN's
 * sentence, not theirs — so the fallback is their own first line, trimmed to
 * something that fits a card, and only then a neutral label.
 *
 * Every reader goes through here rather than assuming `title` is a string.
 * There are a dozen of them, and each would otherwise invent its own answer,
 * which is how one surface ends up saying "Untitled" while another shows a
 * blank heading.
 */

const MAX = 90;

function firstText(blocks: ActivityBlock[]): string | null {
  for (const block of blocks) {
    if (block.type === "text") {
      const text = block.text.replace(/\s+/g, " ").trim();
      if (text) return text;
    }
    if (block.type === "mod" && block.label) return block.label;
  }
  return null;
}

export function postHeadline(post: {
  title?: string | null;
  body?: Json | null;
  intro?: string | null;
}): string {
  const title = post.title?.trim();
  if (title) return title;

  const intro = post.intro?.trim();
  if (intro) return clamp(intro);

  try {
    const line = firstText(normalizeBlocks(post.body ?? []));
    if (line) return clamp(line);
  } catch {
    // A malformed body is not a reason to render nothing.
  }
  // Last resort. Deliberately plain: it reads as a label, not as a title
  // somebody chose badly.
  return "Update";
}

/** True when this post has a real, author-written title. */
export function hasTitle(post: { title?: string | null }): boolean {
  return Boolean(post.title?.trim());
}

function clamp(text: string): string {
  if (text.length <= MAX) return text;
  const cut = text.slice(0, MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * The heading and the body for a post's own page.
 *
 * On a card the fallback headline stands alone. On the page it sits directly
 * above the body it was taken from, so a quick post read "New wheels turned
 * up." as a heading and then "New wheels turned up." again as its first
 * line. When the heading IS the first text block, whole, that block is left
 * out of the body. When the caption was too long to be a heading, the page
 * uses the neutral label and the body keeps every word — a clipped sentence
 * over the full one is the same stutter.
 */
export function pageHeadline(
  post: { title?: string | null; body?: Json | null; intro?: string | null },
  blocks: ActivityBlock[]
): { headline: string; blocks: ActivityBlock[] } {
  if (hasTitle(post) || post.intro?.trim()) return { headline: postHeadline(post), blocks };
  const index = blocks.findIndex((b) => b.type === "text" && b.text.replace(/\s+/g, " ").trim());
  const first = index >= 0 ? blocks[index] : null;
  if (!first || first.type !== "text") return { headline: postHeadline(post), blocks };
  const text = first.text.replace(/\s+/g, " ").trim();
  if (text.length > MAX) return { headline: "Update", blocks };
  return { headline: text, blocks: blocks.filter((_, i) => i !== index) };
}
