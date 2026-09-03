import { normalizeBlocks } from "@/lib/activity-blocks";

/**
 * The user-visible text of an activity document — the TypeScript mirror of
 * `activity_post_search_text()` (migration 0057), used when building
 * Typesense documents so the engine indexes exactly what the canonical
 * PostgreSQL search sees.
 *
 * Deliberate extraction, not stringification: text blocks, mod labels and
 * details, and performance notes are what a reader actually sees. Internal
 * structure — image urls, video ids, enum values, mod item ids — is never
 * search material. If a block type is added here it must be added to the SQL
 * extractor too (which means re-creating the generated `search_text` column;
 * see docs/site/search.md).
 */
export function activitySearchText(body: unknown): string {
  const parts: string[] = [];
  for (const block of normalizeBlocks(body)) {
    switch (block.type) {
      case "text":
        if (block.text.trim()) parts.push(block.text.trim());
        break;
      case "mod": {
        const text = [block.label, block.detail].filter(Boolean).join(" ").trim();
        if (text) parts.push(text);
        break;
      }
      case "performance":
        if (block.note?.trim()) parts.push(block.note.trim());
        break;
      default:
        break;
    }
  }
  return parts.join(" ");
}
