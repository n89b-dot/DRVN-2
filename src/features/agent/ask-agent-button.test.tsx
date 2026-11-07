import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui")>()),
  useSidePanel: () => ({ available: false, open: () => {} }),
}));

const { AskAgentButton } = await import("./ask-agent-button");

describe("AskAgentButton, disabled", () => {
  it("gives each copy its own reason id, so a page with several stays valid", () => {
    const html = renderToStaticMarkup(
      <>
        <AskAgentButton about={{ kind: "car", id: "c-1" }} disabledReason="Agent is off in Settings." />
        <AskAgentButton about={{ kind: "listing", id: "l-1" }} disabledReason="Agent is off in Settings." />
      </>,
    );
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    const described = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(described).toEqual(ids);
  });
});
