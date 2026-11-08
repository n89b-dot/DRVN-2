import { beforeEach, describe, expect, it, vi } from "vitest";

// OS-W21 follow-up (Codex, PR #95): removing a reported post listed its
// replies through PostgREST, which caps a read at max_rows = 1000, so on a
// post with 1,001 replies the reports on the omitted replies stayed open and
// their reporters were never told. The takedown is now one database call
// (take_down_reported_content, 20261108130100) that closes every matching
// report through a join before the delete; the action tells every reporter
// it returns, however many.

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  rpc: vi.fn(),
  inserts: [] as unknown[],
  report: { id: "", subject_type: "post", subject_id: "post-1", status: "open" },
  reads: [] as string[],
}));

vi.mock("./guard", () => ({ getAdminContext: mocks.context }));
vi.mock("./audit", () => ({
  auditedAction: async (_admin: unknown, _entry: unknown, mutate: () => Promise<unknown>) => mutate(),
  RefusedOperationError: class extends Error {},
}));
vi.mock("@/lib/revalidate", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/money-worker", () => ({ runMoneyWorkerPass: vi.fn() }));
vi.mock("@/lib/payments/refunds", () => ({ refundOrder: vi.fn() }));
vi.mock("@/lib/payments/settlement", () => ({ markWebhookEventProcessed: vi.fn() }));
vi.mock("@/lib/payments/late-refund-recovery", () => ({ verifyLateRefundRecovery: vi.fn() }));
vi.mock("./replay-webhook", () => ({ dispatchRecordedWebhookEvent: vi.fn() }));
vi.mock("./alerts", () => ({ sendAdminAlert: vi.fn() }));
vi.mock("@/lib/media-lifecycle", () => ({ scheduleMediaCleanup: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      mocks.reads.push(table);
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = async () => ({ data: table === "reports" ? mocks.report : null, error: null });
      builder.insert = async (rows: unknown) => {
        mocks.inserts.push(rows);
        return { error: null };
      };
      return builder;
    },
    rpc: mocks.rpc,
  }),
}));

import { adminRemoveReportedContent } from "./actions";

const REPORT = "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** Every notification row the action inserted, flattened. */
function notified() {
  return mocks.inserts.flatMap((rows) => (Array.isArray(rows) ? rows : [rows])) as { user_id: string; kind: string }[];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inserts.length = 0;
  mocks.reads.length = 0;
  mocks.report = { id: REPORT, subject_type: "post", subject_id: "post-1", status: "open" };
  mocks.context.mockResolvedValue({ userId: "admin-1", role: "admin" });
});

describe("removing a reported post", () => {
  it("closes the reports in the takedown's own database call and tells every reporter, past 1,000 replies", async () => {
    // The post's own report, plus one report on each of 1,001 replies.
    const closed = [
      { id: REPORT, subject_type: "post", reporter_id: "reporter-post" },
      ...Array.from({ length: 1001 }, (_, i) => ({ id: `r-${i}`, subject_type: "comment", reporter_id: `reporter-${i}` })),
    ];
    mocks.rpc.mockResolvedValue({
      data: { removed: { id: "post-1", author_id: "author-1", title: "Spam" }, replyCount: 1001, closed },
      error: null,
    });

    const result = await adminRemoveReportedContent(null, form({ report_id: REPORT, reason: "Spam" }));

    expect(result).toEqual({ ok: "Post removed; the author and the reporter were told." });
    expect(mocks.rpc).toHaveBeenCalledWith("take_down_reported_content", {
      p_actor: "admin-1",
      p_report: REPORT,
      p_reason: "Spam",
    });
    // No reply list is read, and nothing is deleted outside that call.
    expect(mocks.reads).not.toContain("activity_comments");
    expect(mocks.reads).not.toContain("activity_posts");

    const reviewed = notified().filter((row) => row.kind === "report_reviewed");
    expect(new Set(reviewed.map((row) => row.user_id)).size).toBe(1002);
    expect(reviewed.map((row) => row.user_id)).toContain("reporter-1000");
    // Sent in batches, not 1,002 requests or one unbounded body.
    expect(mocks.inserts.filter((rows) => Array.isArray(rows) && rows.length > 1)).toHaveLength(3);
    expect(notified()).toContainEqual(expect.objectContaining({ user_id: "author-1", kind: "post_removed" }));
  });

  it("tells a reporter once per kind of thing, however many of the replies they reported", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        removed: { id: "post-1", author_id: "author-1" },
        replyCount: 3,
        closed: [
          { id: REPORT, subject_type: "post", reporter_id: "same" },
          { id: "r-1", subject_type: "comment", reporter_id: "same" },
          { id: "r-2", subject_type: "comment", reporter_id: "same" },
          { id: "r-3", subject_type: "comment", reporter_id: null },
        ],
      },
      error: null,
    });
    await adminRemoveReportedContent(null, form({ report_id: REPORT, reason: "Spam" }));
    expect(notified().filter((row) => row.kind === "report_reviewed")).toHaveLength(2);
  });

  it("changes nothing and tells no one when the database refuses", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "That post is already gone." } });
    const result = await adminRemoveReportedContent(null, form({ report_id: REPORT, reason: "Spam" }));
    expect(result).toEqual({ error: "That post is already gone." });
    expect(mocks.inserts).toHaveLength(0);
  });
});
