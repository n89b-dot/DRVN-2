// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * N125: Settings → Privacy offers Clear chat on its own, so a member whose
 * agent is Off (which hides the thread on /agent and the side panel) can
 * still clear what is stored.
 */

const mocks = vi.hoisted(() => ({ clear: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));
vi.mock("@/features/agent/clear-chat", () => ({ clearAgentChat: mocks.clear }));

const { AgentChatPrivacy } = await import("./agent-chat-privacy");

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  mocks.clear.mockReset();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container.remove();
});

describe("AgentChatPrivacy (N125)", () => {
  it("clears the stored chat from Settings, behind the confirm", async () => {
    mocks.clear.mockResolvedValue({ ok: "Chat cleared." });
    await act(async () => {
      root = createRoot(container);
      root.render(<AgentChatPrivacy messages={12} />);
    });
    expect(container.textContent).toContain("12 messages, yours and your agent's");
    const trigger = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Clear chat")!;
    await act(async () => trigger.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(mocks.clear).not.toHaveBeenCalled();
    await act(async () => {
      container.querySelector("dialog form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Chat cleared.");
    expect([...container.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Clear chat")).toBe(false);
  });
});
