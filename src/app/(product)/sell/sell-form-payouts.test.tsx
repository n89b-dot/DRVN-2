import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * R-audit-sell — a seller without payouts learns it before investing in the
 * form, not from the checklist above Publish, and the greyed-out Publish
 * button says why beside itself (desktop row and the phone's pinned bar).
 */

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));
vi.mock("./actions", () => ({ checkListingEdit: vi.fn(), createListing: vi.fn(), updateListing: vi.fn() }));
vi.mock("@/lib/media-staging", () => ({ deleteStagedIfUnconsumed: vi.fn() }));
vi.mock("@/lib/media-upload", () => ({ uploadImages: vi.fn() }));

const { SellForm } = await import("./sell-form");

function render(canPublish: boolean) {
  return renderToStaticMarkup(
    <SellForm cars={[]} makes={[]} userId="00000000-0000-4000-8000-000000000001" canPublish={canPublish} />
  );
}

/** Visible words, tags dropped. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");

describe("sell form without payouts (R-audit-sell)", () => {
  it("names the payouts blocker and its fix before the first field", () => {
    const html = render(false);
    const notice = html.indexOf("Set up payouts to publish");
    const firstSection = html.indexOf("Photos");
    expect(notice).toBeGreaterThan(-1);
    expect(notice).toBeLessThan(firstSection);
    const head = html.slice(0, firstSection);
    expect(head).toContain('href="/payouts"');
    expect(text(head)).toMatch(/save it as a draft now/i);
  });

  it("explains the disabled Publish beside the button, and on the phone bar", () => {
    const html = render(false);
    expect(html).toMatch(/id="publish-blocked-note"/);
    expect(text(html)).toMatch(/Publish is off until payouts are set up/);
    expect(text(html)).toMatch(/Payouts needed to publish/);
    // Both copies of the commit button (the row and the phone's pinned bar)
    // stay focusable and point at the visible note first.
    const publish = html.match(/<button[^>]*>Publish<\/button>/g) ?? [];
    expect(publish).toHaveLength(2);
    for (const button of publish) {
      expect(button).toContain('aria-disabled="true"');
      expect(button).toContain('aria-describedby="publish-blocked-note publish-checklist"');
      expect(button).not.toMatch(/\sdisabled=/);
    }
  });

  it("says nothing about payouts when the seller can publish", () => {
    const html = render(true);
    expect(html).not.toContain("Set up payouts to publish");
    expect(html).not.toContain("publish-blocked-note");
    expect(text(html)).not.toMatch(/Payouts needed/);
    for (const button of html.match(/<button[^>]*>Publish<\/button>/g) ?? []) {
      expect(button).not.toContain("aria-disabled");
    }
  });
});
