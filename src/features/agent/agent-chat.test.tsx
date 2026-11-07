// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Readiness 74: the agent's reply is announced to a screen reader when it
 * lands, the first one included, and the member's focus stays in the
 * composer so they can keep typing.
 */

const mocks = vi.hoisted(() => ({ send: vi.fn(), clear: vi.fn() }));

vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));
vi.mock("./chat", () => ({ sendAgentMessage: mocks.send }));
vi.mock("./build", () => ({ confirmBuildChange: vi.fn() }));
vi.mock("./clear-chat", () => ({ clearAgentChat: mocks.clear }));
vi.mock("@/lib/media-upload", () => ({ uploadImages: vi.fn() }));

const { AgentChat } = await import("./agent-chat");
type ChatMessage = import("./chat").ChatMessage;

const message = (id: string, role: ChatMessage["role"], body: string): ChatMessage => ({ id, role, body, cards: [], images: [], created_at: "2026-11-07T10:00:00.000Z" });

let container: HTMLDivElement;
let root: Root | null = null;

const log = () => container.querySelector('[role="log"]') as HTMLElement | null;
const box = () => container.querySelector("textarea") as HTMLTextAreaElement;

function type(text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(box(), text);
  box().dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  // jsdom has the element but not the modal methods the shared Dialog calls.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  mocks.send.mockReset();
  mocks.clear.mockReset();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container.remove();
});

async function mount(initial: ChatMessage[] = []) {
  await act(async () => {
    root = createRoot(container);
    root.render(<AgentChat initial={initial} />);
  });
}

describe("AgentChat (readiness 74)", () => {
  it("has a polite, named live log before the first message", async () => {
    await mount();
    const region = log();
    expect(region).not.toBeNull();
    expect(region!.getAttribute("aria-live")).toBe("polite");
    expect(region!.getAttribute("aria-relevant")).toBe("additions");
    expect(region!.getAttribute("aria-label")).toBe("Conversation with your agent");
    expect(region!.children).toHaveLength(0);
  });

  it("adds the reply inside the same live region, and leaves focus in the composer", async () => {
    mocks.send.mockResolvedValue({ messages: [message("m-1", "member", "Will this fit my car?"), message("m-2", "agent", "Yes, it fits your 2004 WRX.")] });
    await mount();
    const region = log();

    box().focus();
    type("Will this fit my car?");
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(mocks.send).toHaveBeenCalledOnce();
    // The same element the screen reader was already watching, not a new one.
    expect(log()).toBe(region);
    expect(region!.textContent).toContain("Yes, it fits your 2004 WRX.");
    expect(document.activeElement).toBe(box());
    expect(box().value).toBe("");
  });
});

const button = (name: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === name) as HTMLButtonElement | undefined;
const click = (el: HTMLElement) => act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

describe("Clear chat (N125)", () => {
  const thread = [message("m-1", "member", "Will this fit my car?"), message("m-2", "agent", "Yes, it fits your 2004 WRX.")];

  it("is offered only when there is something to clear", async () => {
    await mount();
    expect(button("Clear chat")).toBeUndefined();
  });

  it("asks first, then empties the thread once the server has cleared it", async () => {
    mocks.clear.mockResolvedValue({ ok: "Chat cleared." });
    await mount(thread);
    await click(button("Clear chat")!);
    // The confirm says what goes and what stays; nothing is deleted yet.
    expect(container.textContent).toContain("Every message in this chat, yours and your agent's, is deleted for good");
    expect(container.textContent).toContain("Offers, listings and your build stay exactly as they are");
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(log()!.textContent).toContain("Yes, it fits your 2004 WRX.");

    const form = [...container.querySelectorAll("dialog form")][0] as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(log()!.children).toHaveLength(0);
    expect(container.textContent).toContain("Chat cleared.");
    expect(button("Clear chat")).toBeUndefined();
  });

  it("keeps the thread when the server refuses", async () => {
    mocks.clear.mockResolvedValue({ error: "Couldn't clear your chat. Nothing was deleted; try again." });
    await mount(thread);
    await click(button("Clear chat")!);
    const form = [...container.querySelectorAll("dialog form")][0] as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(log()!.textContent).toContain("Yes, it fits your 2004 WRX.");
    expect(container.textContent).toContain("Couldn't clear your chat. Nothing was deleted; try again.");
  });
});
