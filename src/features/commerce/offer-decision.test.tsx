// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommerceState } from "./action-types";

/**
 * A move that settles an offer returns with the settled page, so the status
 * prop flips beside the move's result. The result note must survive that,
 * in either commit order — e2e/offer-action-recovery.spec.ts failed when
 * the card unmounted with its buttons and "Offer accepted" only flashed.
 */

type Pending = { resolve: (state: CommerceState) => void; reject: (error: unknown) => void };
const moves: Pending[] = [];
const pendingMove = () =>
  new Promise<CommerceState>((resolve, reject) => {
    moves.push({ resolve, reject });
  });

vi.mock("./actions", () => ({
  respondToOffer: vi.fn(pendingMove),
  withdrawOffer: vi.fn(pendingMove),
  acceptCounter: vi.fn(pendingMove),
  counterOffer: vi.fn(pendingMove),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  unstable_rethrow: () => {},
}));

const { OfferDecision } = await import("./offer-decision");

let root: Root | null = null;
let host: HTMLDivElement;

function render(status: string) {
  act(() => {
    root ??= createRoot(host);
    root.render(
      <OfferDecision
        offerId="00000000-0000-4000-8000-000000000001"
        status={status}
        amountCents={8000}
        counterAmountCents={null}
        incoming
        counterpartyName="@buyer"
        round={1}
        block
      />,
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

const accept = () => {
  const button = [...host.querySelectorAll("button")].find((b) => /accept \$80/i.test(b.textContent ?? ""));
  if (!button) throw new Error("No accept button");
  act(() => button.click());
};
const alerts = () => [...host.querySelectorAll('[role="alert"]')].map((n) => n.textContent);
const accepted = "Offer accepted — the buyer has 24 hours to complete checkout.";

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  moves.length = 0;
  refresh.mockClear();
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

describe("OfferDecision after the move that settles the offer", () => {
  it("keeps the accept result when the settled page lands after it", async () => {
    render("open");
    accept();
    await flush(() => moves[0].resolve({ ok: accepted }));
    expect(refresh).toHaveBeenCalledTimes(1);
    render("accepted");
    expect(alerts()).toEqual([accepted]);
    expect(host.querySelector("button")).toBeNull();
  });

  it("keeps the accept result when the settled page lands first", async () => {
    render("open");
    accept();
    render("accepted");
    await flush(() => moves[0].resolve({ ok: accepted }));
    expect(alerts()).toEqual([accepted]);
  });

  it("keeps an accept that couldn't notify the buyer, so the seller can message them", async () => {
    const warning = "Offer accepted. We couldn't notify the buyer just now — message them so they check out within 24 hours.";
    render("open");
    accept();
    await flush(() => moves[0].resolve({ ok: warning }));
    render("accepted");
    expect(alerts()).toEqual([warning]);
  });

  it("drops the lost-response notice once the page shows the saved result", async () => {
    render("open");
    accept();
    await flush(() => moves[0].reject(new TypeError("Failed to fetch")));
    expect(alerts()).toEqual(["Couldn't confirm the offer update. Retry to check the saved result."]);
    render("accepted");
    expect(host.innerHTML).toBe("");
  });

  it("renders nothing for an offer that was already settled", () => {
    render("declined");
    expect(host.innerHTML).toBe("");
  });
});
