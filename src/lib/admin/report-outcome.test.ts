import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import type { Database } from "@/lib/database.types";

import { closeSiblingReports, outcomeForResolution, reporterNotice, reportSubjectWord } from "./report-outcome";

describe("N140 reporter copy", () => {
  it("never says something was taken down unless it was", () => {
    expect(reporterNotice("listing", outcomeForResolution("actioned")).body).not.toMatch(/took (action|down)|removed/i);
    expect(reporterNotice("user", outcomeForResolution("actioned")).body).toBe(
      "We reviewed the member you reported and followed it up under DRVN's rules."
    );
    expect(reporterNotice("post", "removed").body).toBe("We took down the post you reported.");
    expect(reporterNotice("comment", "dismissed").body).toContain("didn't find a breach");
  });

  it("names a build and files it with engagement", () => {
    expect(reportSubjectWord("car")).toBe("build");
    expect(reporterNotice("car", "removed")).toMatchObject({ body: "We took down the build you reported.", section: "engagement" });
    expect(reporterNotice("listing", "removed").section).toBe("marketplace");
  });
});

/** Records the query a fake PostgREST builder was given. */
function fakeAdmin(rows: { id: string; subject_type: string }[]) {
  const calls: { update?: Record<string, unknown>; filters: [string, string, unknown][] }[] = [];
  const admin = {
    from(table: string) {
      expect(table).toBe("reports");
      const call: (typeof calls)[number] = { filters: [] };
      calls.push(call);
      const builder = {
        update(values: Record<string, unknown>) {
          call.update = values;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.filters.push(["eq", column, value]);
          return builder;
        },
        in(column: string, value: unknown) {
          call.filters.push(["in", column, value]);
          return builder;
        },
        neq(column: string, value: unknown) {
          call.filters.push(["neq", column, value]);
          return builder;
        },
        select: async () => ({ data: rows, error: null }),
      };
      return builder;
    },
  };
  return { admin: admin as unknown as SupabaseClient<Database>, calls };
}

describe("N140 a takedown settles the other open reports", () => {
  it("closes only open reports on the removed thing and its replies, never the one already handled", async () => {
    const { admin, calls } = fakeAdmin([{ id: "r2", subject_type: "post" }]);
    const closed = await closeSiblingReports(admin, {
      subjects: [
        { type: "post", ids: ["post-1"] },
        { type: "comment", ids: ["reply-1", "reply-2"] },
        { type: "comment", ids: [] },
      ],
      exceptReportId: "r1",
      adminId: "admin-1",
      note: "Removed: spam",
    });
    // The empty subject list is skipped: no query that could match everything.
    expect(calls).toHaveLength(2);
    expect(calls[0].update).toMatchObject({ status: "actioned", resolved_by: "admin-1", resolution_note: "Removed: spam" });
    expect(calls[0].filters).toEqual([
      ["eq", "subject_type", "post"],
      ["in", "subject_id", ["post-1"]],
      ["eq", "status", "open"],
      ["neq", "id", "r1"],
    ]);
    expect(calls[1].filters).toContainEqual(["in", "subject_id", ["reply-1", "reply-2"]]);
    expect(closed).toEqual([
      { id: "r2", subject_type: "post" },
      { id: "r2", subject_type: "post" },
    ]);
  });

  it("closes all open reports on a listing takedown, which has no report of its own", async () => {
    const { admin, calls } = fakeAdmin([]);
    await closeSiblingReports(admin, {
      subjects: [{ type: "listing", ids: ["listing-1"] }],
      exceptReportId: null,
      adminId: "admin-1",
      note: "Listing removed: counterfeit",
    });
    expect(calls[0].filters.some(([op]) => op === "neq")).toBe(false);
  });
});
