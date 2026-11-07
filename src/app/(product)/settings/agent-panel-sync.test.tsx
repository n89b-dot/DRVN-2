// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The side panel's thread stays mounted beside Settings. What Settings does
 * has to reach it: a clear under Privacy empties it (N125), and saving Act
 * after Off brings it back (AG-7).
 */

const mocks = vi.hoisted(() => ({ open: vi.fn(), clear: vi.fn(), save: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));
vi.mock("next/link", () => ({ default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> }));
vi.mock("@/features/agent/chat", () => ({ openAgentChat: mocks.open, sendAgentMessage: vi.fn() }));
vi.mock("@/features/agent/clear-chat", () => ({ clearAgentChat: mocks.clear }));
vi.mock("@/features/agent/build", () => ({ confirmBuildChange: vi.fn() }));
vi.mock("@/lib/media-upload", () => ({ uploadImages: vi.fn() }));
vi.mock("./agent-actions", () => ({ saveAgentMode: mocks.save }));

const { PanelThread } = await import("@/features/agent/agent-panel");
const { AgentChatPrivacy } = await import("./agent-chat-privacy");
const { AgentSection } = await import("./agent-section");

const thread = [
  { id: "m-1", role: "member" as const, body: "Will this fit my car?", cards: [], images: [], created_at: "2026-11-07T10:00:00.000Z" },
  { id: "m-2", role: "agent" as const, body: "Yes, it fits your 2004 WRX.", cards: [], images: [], created_at: "2026-11-07T10:00:05.000Z" },
];
const loaded = (messages = thread) => ({ messages, about: null, jobs: false, userId: "user-1" });

let container: HTMLDivElement;
let root: Root | null = null;
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const render = async (ui: ReactNode) => {
  await act(async () => {
    root ??= createRoot(container);
    root.render(ui);
  });
  await flush();
};
const panelLog = () => container.querySelector('[data-panel] [role="log"]');

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  vi.clearAllMocks();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container.remove();
});

describe("the side panel beside Settings", () => {
  it("drops the thread when the chat is cleared under Privacy", async () => {
    mocks.open.mockResolvedValue(loaded());
    mocks.clear.mockResolvedValue({ ok: "Chat cleared." });
    await render(
      <>
        <div data-panel>
          <PanelThread aboutRef={null} />
        </div>
        <div data-privacy>
          <AgentChatPrivacy messages={2} />
        </div>
      </>,
    );
    expect(panelLog()!.textContent).toContain("Yes, it fits your 2004 WRX.");

    const privacy = container.querySelector("[data-privacy]")!;
    const trigger = [...privacy.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Clear chat")!;
    await act(async () => trigger.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => {
      privacy.querySelector("dialog form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();

    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(panelLog()!.children).toHaveLength(0);
    expect(panelLog()!.textContent).not.toContain("WRX");
  });

  it("comes back once Act is saved after it opened under Off", async () => {
    mocks.open.mockResolvedValueOnce({ disabled: "Agent is off in Settings." }).mockResolvedValue(loaded());
    mocks.save.mockResolvedValue({ ok: "Agent set to Act within my limits." });
    await render(
      <>
        <div data-panel>
          <PanelThread aboutRef={null} />
        </div>
        <AgentSection initialMode="off" running={0} />
      </>,
    );
    expect(container.querySelector("[data-panel]")!.textContent).toContain("Agent is off in Settings.");

    const act_ = container.querySelector('input[value="act"]') as HTMLInputElement;
    await act(async () => act_.click());
    await act(async () => {
      container.querySelector("#agent form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();

    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.open).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[data-panel]")!.textContent).not.toContain("Agent is off in Settings.");
    expect(panelLog()!.textContent).toContain("Yes, it fits your 2004 WRX.");
  });

  it("clears the Off notice when a later load succeeds, as asking about another listing does", async () => {
    mocks.open.mockResolvedValueOnce({ disabled: "Agent is off in Settings." }).mockResolvedValue(loaded());
    await render(
      <div data-panel>
        <PanelThread aboutRef={{ kind: "listing", id: "l-1" }} />
      </div>,
    );
    expect(container.textContent).toContain("Agent is off in Settings.");
    await render(
      <div data-panel>
        <PanelThread aboutRef={{ kind: "listing", id: "l-2" }} />
      </div>,
    );
    expect(container.textContent).not.toContain("Agent is off in Settings.");
    expect(panelLog()).not.toBeNull();
  });
});
