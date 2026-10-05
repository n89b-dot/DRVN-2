import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConsentVideo } from "./consent-video";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("ConsentVideo", () => {
  it("renders nothing that contacts YouTube before the visitor presses play", () => {
    const html = renderToStaticMarkup(<ConsentVideo videoId="dQw4w9WgXcQ" title="Dyno day" />);
    expect(html).not.toContain("<iframe");
    expect(html).not.toMatch(/<img|ytimg|youtube-nocookie/);
    expect(html).toContain('aria-label="Play Dyno day from YouTube"');
    // The only YouTube URL is a plain link the visitor has to click.
    expect(html.match(/youtube\.com/g)).toHaveLength(1);
    expect(html).toContain('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"');
  });

  it("is the only place a YouTube player is embedded", () => {
    // An iframe rendered anywhere else loads YouTube on view, without the
    // visitor choosing. Embed through ConsentVideo.
    const offenders = sourceFiles(join(process.cwd(), "src")).filter(
      (file) =>
        !file.endsWith("components/ui/consent-video.tsx") &&
        !file.endsWith("src/proxy.ts") &&
        /youtube(-nocookie)?\.com\/embed\/\$\{/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
