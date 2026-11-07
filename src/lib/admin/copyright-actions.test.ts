import { beforeEach, describe, expect, it, vi } from "vitest";

// R69-dmca: the console's Take down and Reject on a copyright notice. The
// database function decides (admin, step-up, one transaction, audit); the
// action parses the targets, then tells the members, starts the storage
// deletion and drops the cached pages and the proxy's blocked list.

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  sessionRpc: vi.fn(),
  notify: vi.fn(),
  cleanup: vi.fn(),
  forget: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("./guard", () => ({ getAdminContext: mocks.context }));
vi.mock("./audit", () => ({ auditedAction: vi.fn() }));
vi.mock("@/lib/revalidate", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/money-worker", () => ({ runMoneyWorkerPass: vi.fn() }));
vi.mock("@/lib/payments/refunds", () => ({ refundOrder: vi.fn() }));
vi.mock("@/lib/payments/settlement", () => ({ markWebhookEventProcessed: vi.fn() }));
vi.mock("@/lib/payments/late-refund-recovery", () => ({ verifyLateRefundRecovery: vi.fn() }));
vi.mock("./replay-webhook", () => ({ dispatchRecordedWebhookEvent: vi.fn() }));
vi.mock("./alerts", () => ({ sendAdminAlert: vi.fn() }));
vi.mock("@/lib/media-lifecycle", () => ({ scheduleMediaCleanup: mocks.cleanup }));
vi.mock("@/lib/copyright/blocked-media", () => ({ forgetBlockedMedia: mocks.forget }));
vi.mock("@/lib/copyright/hosts", () => ({ copyrightHosts: () => ({ site: ["drvn.app"], storage: ["proj.supabase.co"] }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.sessionRpc }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ insert: mocks.notify }) }),
}));

import { adminCopyrightTakedown, adminRejectCopyrightNotice } from "./actions";
import { capabilityFor } from "./capabilities";

const NOTICE = "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const LISTING = "8f6c2a52-3d1e-4b8a-9c3f-2b1d4e5f6a7b";
const SELLER = "11111111-2222-4333-8444-555555555555";
const PHOTO = `https://proj.supabase.co/storage/v1/object/public/listing-images/${SELLER}/x.webp`;

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ userId: "admin-1", role: "admin" });
  mocks.notify.mockResolvedValue({ error: null });
  mocks.sessionRpc.mockResolvedValue({
    data: { removedListings: [LISTING], objects: [`listing-images/${SELLER}/x.webp`], stillReferenced: [], owners: [SELLER] },
    error: null,
  });
});

describe("copyright takedown", () => {
  it("is a registered admin action family", () => {
    expect(capabilityFor("copyright.takedown")?.requires).toBe("admin");
  });

  it("sends the notice's listings and photos, plus the admin's additions, to the database function", async () => {
    const extra = "https://drvn.app/listings/22222222-3333-4444-8555-666666666666";
    const result = await adminCopyrightTakedown(
      null,
      form({ notice_id: NOTICE, listing_ids: LISTING, media_urls: PHOTO, more: extra, reason: "Photographer's notice" })
    );
    expect(mocks.sessionRpc).toHaveBeenCalledWith("copyright_takedown", {
      p_notice: NOTICE,
      p_listing_ids: [LISTING, "22222222-3333-4444-8555-666666666666"],
      p_media_urls: [PHOTO],
      p_note: "Photographer's notice",
    });
    expect(result).toEqual({ ok: "1 listing(s) and 1 photo(s) taken down, order snapshots included." });
  });

  it("tells each member whose content went, removes it from storage now, and clears the caches", async () => {
    await adminCopyrightTakedown(null, form({ notice_id: NOTICE, listing_ids: LISTING, reason: "Photographer's notice" }));
    expect(mocks.notify).toHaveBeenCalledWith([
      expect.objectContaining({ user_id: SELLER, kind: "copyright_takedown", body: expect.stringContaining("Photographer's notice") }),
    ]);
    expect(mocks.cleanup).toHaveBeenCalledWith(SELLER);
    expect(mocks.forget).toHaveBeenCalled();
    expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
  });

  it("refuses links it can't place before asking the database", async () => {
    const result = await adminCopyrightTakedown(
      null,
      form({ notice_id: NOTICE, more: "https://drvn.app/posts/abc", reason: "Notice" })
    );
    expect(result?.error).toMatch(/Not a DRVN listing or photo link/);
    expect(mocks.sessionRpc).not.toHaveBeenCalled();
  });

  it("asks for the authenticator again when the step-up has lapsed, and changes nothing here", async () => {
    mocks.sessionRpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Admin step-up required" } });
    const result = await adminCopyrightTakedown(null, form({ notice_id: NOTICE, listing_ids: LISTING, reason: "Notice" }));
    expect(result).toEqual({ error: "Confirm your authenticator again, then retry." });
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it("refuses a viewer", async () => {
    mocks.context.mockResolvedValue({ userId: "viewer-1", role: "viewer" });
    const result = await adminCopyrightTakedown(null, form({ notice_id: NOTICE, listing_ids: LISTING, reason: "Notice" }));
    expect(result?.error).toMatch(/Read-only/);
    expect(mocks.sessionRpc).not.toHaveBeenCalled();
  });

  it("rejects a notice through its own database function", async () => {
    mocks.sessionRpc.mockResolvedValue({ data: null, error: null });
    await expect(adminRejectCopyrightNotice(null, form({ notice_id: NOTICE, reason: "No DRVN link" }))).resolves.toHaveProperty("ok");
    expect(mocks.sessionRpc).toHaveBeenCalledWith("reject_copyright_notice", { p_notice: NOTICE, p_note: "No DRVN link" });
  });
});
