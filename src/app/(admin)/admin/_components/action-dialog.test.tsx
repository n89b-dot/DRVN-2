import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * R-audit-closecase: a select with a placeholder starts on that blank,
 * disabled, required choice, so the browser won't submit an answer nobody
 * chose. (Rendered with the dialog open; the Dialog primitive is stubbed.)
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), unstable_rethrow: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children }: { children: ReactNode }) => <a>{children}</a> }));
vi.mock("@/components/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui")>()),
  Dialog: ({ children }: { children: ReactNode }) => <div data-dialog>{children}</div>,
}));
vi.mock("./admin-action-toast", () => ({ announceAdminAction: vi.fn() }));

const { ActionDialog } = await import("./action-dialog");

const select = (placeholder?: string) =>
  renderToStaticMarkup(
    <ActionDialog
      action={async () => null}
      title="Close recovery case"
      trigger="Close case"
      hidden={{ recovery_id: "rec-1" }}
      fields={[{ kind: "select", name: "outcome", label: "Outcome", placeholder, options: [{ value: "recovered", label: "Recovered" }, { value: "written_off", label: "Written off" }] }]}
      submitLabel="Close case"
    />
  );

describe("ActionDialog select placeholder", () => {
  it("starts blank and unsubmittable when a placeholder is given", () => {
    const html = select("Choose an outcome");
    expect(html).toMatch(/<select[^>]*name="outcome"[^>]*required/);
    expect(html).toContain('<option value="" disabled="" selected="">Choose an outcome</option>');
    expect(html).not.toMatch(/<option value="recovered" selected/);
  });
});
