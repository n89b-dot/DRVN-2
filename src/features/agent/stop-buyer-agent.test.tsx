// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentState } from "./actions";

/**
 * "Stop negotiating for me" revalidates the offer page it sits on, so the
 * Server Action response carries that page with the mandate revoked beside
 * "Stopped.". The result must survive that, in either commit order —
 * e2e/buyer-agent.spec.ts:180 failed when the page dropped the control and
 * "Stopped." only flashed, or never painted.
 */

type Pending = { resolve: (state: AgentState) => void; reject: (error: unknown) => void };
const stops: Pending[] = [];

vi.mock("./actions", () => ({
  stopBuyerAgent: vi.fn(
    () =>
      new Promise<AgentState>((resolve, reject) => {
        stops.push({ resolve, reject });
      }),
  ),
}));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));

const { StopBuyerAgent } = await import("./stop-buyer-agent");

let root: Root | null = null;
let host: HTMLDivElement;

function render(live: boolean) {
  act(() => {
    root ??= createRoot(host);
    root.render(<StopBuyerAgent mandateId="00000000-0000-4000-8000-000000000001" offerId="00000000-0000-4000-8000-000000000002" live={live} />);
  });
}

async function flush(fn: () => void) {
  await act(async () => {
    fn();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const button = (name: string) => {
  const found = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
  if (!found) throw new Error(`No ${name} button`);
  return found;
};

/** Open the confirm and submit it, as the buyer does. */
function stop() {
  act(() => button("Stop negotiating for me").click());
  act(() => {
    const form = document.querySelector("dialog form") as HTMLFormElement | null;
    if (!form) throw new Error("No confirm form");
    form.requestSubmit(button("Stop my agent"));
  });
}

const alerts = () => [...host.querySelectorAll('[role="alert"]')].map((n) => n.textContent);
const stopped = "Stopped. Your agent makes no more moves on this part; any offer it already sent stands until it expires.";

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has the element but not the modal methods the shared Dialog calls.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  stops.length = 0;
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

describe("StopBuyerAgent across the stop", () => {
  it("keeps Stopped. when the page with the revoked mandate lands after it", async () => {
    render(true);
    stop();
    expect(stops).toHaveLength(1);
    await flush(() => stops[0].resolve({ ok: stopped }));
    render(false);
    expect(alerts()).toEqual([stopped]);
    expect(host.querySelector("button")).toBeNull();
  });

  it("keeps Stopped. when the page with the revoked mandate lands first", async () => {
    render(true);
    stop();
    render(false);
    await flush(() => stops[0].resolve({ ok: stopped }));
    expect(alerts()).toEqual([stopped]);
    expect(host.querySelector("button")).toBeNull();
  });

  it("drops the lost-response notice once the page shows the agent stopped", async () => {
    render(true);
    stop();
    await flush(() => stops[0].reject(new TypeError("Failed to fetch")));
    expect(document.querySelector('dialog [role="alert"]')?.textContent).toBe("Couldn't confirm your agent stopped. Check Agent before trying again.");
    render(false);
    expect(host.innerHTML).toBe("");
  });

  it("renders nothing for a mandate that was already stopped", () => {
    render(false);
    expect(host.innerHTML).toBe("");
  });

  it("offers the stop while the mandate runs", () => {
    render(true);
    expect(button("Stop negotiating for me")).toBeTruthy();
  });
});
