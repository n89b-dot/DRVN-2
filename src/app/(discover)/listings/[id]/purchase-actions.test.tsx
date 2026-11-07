// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * R-audit-buybar: the phone's sticky buy bar used to open a new offer even
 * when the buyer already had a live one on the part. It now does what the
 * desktop controls do — show the existing offer.
 */

vi.mock("@/features/commerce/actions", () => ({
  addToCart: vi.fn(),
  buyNow: vi.fn(),
  makeOffer: vi.fn(),
}));
vi.mock("./negotiate-for-me", () => ({ NegotiateForMe: () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  unstable_rethrow: () => {},
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { PurchaseActions } = await import("./purchase-actions");

let root: Root | null = null;
let host: HTMLDivElement;

function render(myOffer: { id: string; amountCents: number; counterCents: number | null } | null) {
  act(() => {
    root ??= createRoot(host);
    root.render(
      <PurchaseActions
        listingId="listing-1"
        isLoggedIn
        betaEnforced={false}
        buyerEligible
        isOwn={false}
        isActive
        paymentsLive={false}
        priceCents={20000}
        shippingCents={1500}
        myOffer={myOffer}
      />
    );
  });
}

const buybar = () => {
  const bar = host.querySelector(".buybar");
  if (!bar) throw new Error("No buy bar");
  return bar;
};
// jsdom has no modal dialogs; the shared Dialog opens through showModal().
const showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  showModal.mockClear();
  HTMLDialogElement.prototype.showModal = showModal;
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

it("R-audit-buybar: with a live offer, the phone bar shows that offer instead of opening a new one", () => {
  render({ id: "offer-1", amountCents: 17500, counterCents: null });

  const link = buybar().querySelector<HTMLAnchorElement>('a[href="/offers/offer-1"]');
  expect(link).not.toBeNull();
  expect(link?.getAttribute("aria-label")).toBe("You offered $175 — view offer");
  // No control in the bar opens the offer form.
  expect([...buybar().querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Offer");
});

it("R-audit-buybar: a countered offer reads as countered in the phone bar", () => {
  render({ id: "offer-1", amountCents: 17500, counterCents: 19000 });

  const link = buybar().querySelector<HTMLAnchorElement>('a[href="/offers/offer-1"]');
  expect(link?.textContent).toBe("Countered");
  expect(link?.getAttribute("aria-label")).toBe("Seller countered $190 — view offer");
});

it("with no offer yet, the phone bar's Offer opens the offer form as before", () => {
  render(null);

  const offer = [...buybar().querySelectorAll("button")].find((b) => b.textContent === "Offer");
  expect(offer).toBeDefined();
  expect(buybar().querySelector('a[href^="/offers/"]')).toBeNull();
  act(() => offer?.click());
  expect(showModal).toHaveBeenCalled();
});
