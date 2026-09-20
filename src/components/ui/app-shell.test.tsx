import { PassThrough } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";
import type { ShellCounts } from "./streamed-shell-counts";

vi.mock("next/navigation", () => ({ usePathname: () => "/home" }));
vi.mock("./livesheet-bar", () => ({ LivesheetBar: ({ unreadCount = 0, cartCount = 0 }: ShellCounts) => <nav data-unread={unreadCount} data-cart={cartCount}>Navigation</nav> }));

it("streams primary content and navigation before badges, then delivers the counts", async () => {
  let release!: (value: ShellCounts) => void;
  const counts = new Promise<ShellCounts>(resolve => { release = resolve; });
  const output = new PassThrough();
  let html = "";
  let firstChunk!: () => void;
  const ready = new Promise<void>(resolve => { firstChunk = resolve; });
  output.on("data", chunk => { html += chunk.toString(); firstChunk(); });
  const done = new Promise<void>((resolve, reject) => { output.on("end", resolve); output.on("error", reject); });
  const errors: unknown[] = [];
  const stream = renderToPipeableStream(
    <AppShell signedIn initialNight={false} initialRailOpen cartCount={2} counts={counts}>
      <h1>Primary page content</h1>
    </AppShell>,
    { onShellReady() { stream.pipe(output); }, onError(error) { errors.push(error); } }
  );
  try {
    await ready;
    expect(html).toContain("Primary page content");
    expect(html).toContain('data-cart="2"');
    expect(html).not.toContain("3 needing your attention");
    release({ cartCount: 2, unreadCount: 4, offersCount: 3, messagesCount: 2 });
    await done;
    expect(html).toContain("3 needing your attention");
    expect(html).toContain('data-unread="4"');
    // N-5: a count, not a dot — a buyer waiting on one answer and a seller
    // with nine threads open are different situations.
    expect(html).toContain("2 conversations with unread messages");
    expect(errors).toEqual([]);
  } finally { stream.abort(); }
});
