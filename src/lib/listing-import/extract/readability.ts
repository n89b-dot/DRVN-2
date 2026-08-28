import "server-only";

/**
 * Generic main-content fallback — Mozilla Readability over jsdom, used only
 * when no engine adapter and no structured metadata claimed the page. jsdom
 * runs with scripts disabled and no resource loading: the document is parsed,
 * never executed.
 */

export type ReadableContent = { title?: string; text: string };

export async function extractReadableContent(
  html: string,
  url: string
): Promise<ReadableContent | null> {
  try {
    const [{ JSDOM }, { Readability }] = await Promise.all([
      import("jsdom"),
      import("@mozilla/readability"),
    ]);
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    if (!article?.textContent?.trim()) return null;
    const text = article.textContent
      .split("\n")
      .map((line: string) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n")
      .slice(0, 20_000);
    return { title: article.title?.trim() || undefined, text };
  } catch {
    return null;
  }
}
