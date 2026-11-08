// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Readiness 74: the agent's reply is announced to a screen reader when it
 * lands, the first one included, and the member's focus stays in the
 * composer so they can keep typing.
 */

const mocks = vi.hoisted(() => ({ send: vi.fn(), clear: vi.fn(), upload: vi.fn(), confirm: vi.fn() }));

vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));
vi.mock("./chat", () => ({ sendAgentMessage: mocks.send }));
vi.mock("./build", () => ({ confirmBuildChange: mocks.confirm }));
vi.mock("./clear-chat", () => ({ clearAgentChat: mocks.clear }));
vi.mock("@/lib/media-upload", () => ({ uploadImages: mocks.upload }));

const { AgentChat } = await import("./agent-chat");
const { announceAgentEvent, AGENT_CHAT_CLEARED } = await import("./chat-events");
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
  mocks.upload.mockReset();
  mocks.confirm.mockReset();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container.remove();
});

async function mount(initial: ChatMessage[] = [], props: { jobs?: boolean; userId?: string } = {}) {
  await act(async () => {
    root = createRoot(container);
    root.render(<AgentChat initial={initial} {...props} />);
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

describe("Clear chat drops the photos waiting to send (OS-W08 follow-up)", () => {
  const ME = "11111111-1111-4111-8111-111111111111";
  const PHOTO = `https://proj.supabase.co/storage/v1/object/authenticated/agent-chat-photos/${ME}/33333333-3333-4333-8333-333333333333.webp`;
  const thread = [message("m-1", "member", "Will this fit my car?"), message("m-2", "agent", "Yes, it fits your 2004 WRX.")];
  const thumbs = () => container.querySelectorAll(".chatbox__thumb");
  let revoked: string[];

  beforeEach(() => {
    revoked = [];
    URL.createObjectURL = (() => "blob:preview-1") as typeof URL.createObjectURL;
    URL.revokeObjectURL = ((url: string) => void revoked.push(url)) as typeof URL.revokeObjectURL;
    mocks.upload.mockImplementation(async ({ files }: { files: File[] }) => ({ uploaded: files.map((file) => ({ file, url: PHOTO })), failed: [] }));
  });

  /** Picks one photo and says it's for a listing, ready to send. */
  async function attach() {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [new File([new Uint8Array([1])], "part.jpg", { type: "image/jpeg" })] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(button("List this part")!);
    expect(thumbs()).toHaveLength(1);
    expect(button("List this part")!.getAttribute("aria-pressed")).toBe("true");
  }

  /** After a clear: no thumbnail, no photo-job choice, the preview released, and the next message carries neither. */
  async function expectNothingAttached() {
    expect(thumbs()).toHaveLength(0);
    expect(container.textContent).not.toContain("Photos for:");
    expect(revoked).toEqual(["blob:preview-1"]);
    mocks.send.mockResolvedValue({ messages: [message("m-3", "member", "hello"), message("m-4", "agent", "Hi.")] });
    type("hello");
    await act(async () => {
      container.querySelector("form:not(dialog form)")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send.mock.calls[0][0]).toMatchObject({ text: "hello", images: [], photoJob: undefined });
  }

  it("clearing here: the deleted photos can't be sent afterwards", async () => {
    mocks.clear.mockResolvedValue({ ok: "Chat cleared." });
    await mount(thread, { jobs: true, userId: ME });
    await attach();
    await click(button("Clear chat")!);
    const form = [...container.querySelectorAll("dialog form")][0] as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(log()!.children).toHaveLength(0);
    await expectNothingAttached();
  });

  it("cleared elsewhere (Settings, the other copy of the thread): the same", async () => {
    await mount(thread, { jobs: true, userId: ME });
    await attach();
    await act(async () => announceAgentEvent(AGENT_CHAT_CLEARED));
    expect(log()!.children).toHaveLength(0);
    await expectNothingAttached();
  });
});

describe("starters (OS-W07 N170)", () => {
  it("offers only what the agent can do: no fitment, sale prices or task status", async () => {
    await mount();
    const starters = [...container.querySelectorAll('[aria-label="Starters"] button')].map((b) => b.textContent?.trim());
    expect(starters).toContain("Find parts for my car");
    expect(starters).toContain("Update my build");
    for (const dead of ["Will this fit my car?", "What do parts like this sell for?", "What's my agent doing?"]) expect(starters).not.toContain(dead);
  });
});

describe("Update my build confirm card (OS-W07 N124)", () => {
  const link = { url: "https://www.kwsuspensions.com/en/products/v3-coilovers", host: "www.kwsuspensions.com" };
  const card = {
    kind: "build_change" as const,
    id: "55555555-5555-4555-8555-555555555555",
    carName: "Mk8 Golf R",
    part: "KW V3 coilovers",
    replaces: null,
    image: null,
    link,
    linkLeftOff: false,
    applied: false,
    href: "/cars/mk8",
    editHref: "/garage/c/edit?change=55555555-5555-4555-8555-555555555555#mods",
    sellHref: null,
  };

  it("shows where the link goes, host and full address, before Confirm, and confirms exactly that link", async () => {
    mocks.confirm.mockResolvedValue({ ok: "Saved to your build." });
    await mount([{ ...message("m-2", "agent", "Here's the change."), cards: [card] }]);
    expect(container.textContent).toContain("Link goes to");
    expect(container.textContent).toContain(link.host);
    expect(container.textContent).toContain(link.url);
    await click(button("Confirm")!);
    expect(mocks.confirm).toHaveBeenCalledWith(card.id, { productUrl: link.url });
  });

  it("says a link was left off, and confirms with none", async () => {
    mocks.confirm.mockResolvedValue({ ok: "Saved to your build." });
    await mount([{ ...message("m-2", "agent", "Here's the change."), cards: [{ ...card, link: null, linkLeftOff: true }] }]);
    expect(container.textContent).toContain("Left off");
    await click(button("Confirm")!);
    expect(mocks.confirm).toHaveBeenCalledWith(card.id, { productUrl: null });
  });
});
