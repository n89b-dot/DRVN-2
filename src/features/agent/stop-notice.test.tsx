// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentState } from "./actions";

/**
 * /agent after "Stop negotiating for me": the stop revalidates the page, so
 * the response carries /agent with the mandate revoked beside "Stopped.".
 * There the control's row has moved to Done, or gone (its Needs you
 * approval dismissed, or the mandate's own row). "Stopped." must still show,
 * whichever of the two commits lands first.
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
const { StopNotices } = await import("./stop-notice");

let root: Root | null = null;
let host: HTMLDivElement;

const MANDATE = "00000000-0000-4000-8000-000000000001";

/**
 * The page's shape, cut down: a Working list with the row that carries the
 * stop, and a Done list. "row" keeps the control; "done" moves the task to
 * Done without it (a cancelled task); "gone" drops the row entirely.
 */
function render(page: "row" | "done" | "gone") {
  act(() => {
    root ??= createRoot(host);
    root.render(
      <StopNotices>
        <ul data-list="working">
          {page === "row" && (
            <li key="task-1">
              Agent coilovers <StopBuyerAgent mandateId={MANDATE} compact />
            </li>
          )}
        </ul>
        <ul data-list="done">{page === "done" && <li key="task-1">Agent coilovers · turned off by owner</li>}</ul>
      </StopNotices>,
    );
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

describe("/agent keeps Stopped. after a stop", () => {
  for (const page of ["done", "gone"] as const) {
    const moved = page === "done" ? "the row moves to Done" : "the row goes";
    it(`when ${moved} after the result lands`, async () => {
      render("row");
      stop();
      expect(stops).toHaveLength(1);
      await flush(() => stops[0].resolve({ ok: stopped }));
      render(page);
      expect(alerts()).toEqual([stopped]);
      expect(host.querySelector("button")).toBeNull();
    });

    it(`when ${moved} before the result lands`, async () => {
      render("row");
      stop();
      render(page);
      expect(host.querySelector("button")).toBeNull();
      await flush(() => stops[0].resolve({ ok: stopped }));
      expect(alerts()).toEqual([stopped]);
    });
  }

  it("shows Stopped. once, in the page's slot, while the row is still there", async () => {
    render("row");
    stop();
    await flush(() => stops[0].resolve({ ok: stopped }));
    expect(alerts()).toEqual([stopped]);
    expect(host.firstElementChild?.getAttribute("role")).toBe("alert");
  });

  it("leaves a refusal on the control and nothing in the slot", async () => {
    render("row");
    stop();
    await flush(() => stops[0].resolve({ error: "Couldn't stop your agent. Try again." }));
    expect(document.querySelector('dialog [role="alert"]')?.textContent).toBe("Couldn't stop your agent. Try again.");
    expect(host.firstElementChild?.getAttribute("role")).not.toBe("alert");
  });

  it("shows nothing before any stop", () => {
    render("row");
    expect(alerts()).toEqual([]);
  });
});
