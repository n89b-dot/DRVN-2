import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

import { resumeIncompleteRefunds } from "./refunds";

type Row = { id: string; status: string; updated_at: string; next_attempt_at: string | null };

/**
 * A refund_operations table that applies the sweep's filters the way
 * PostgREST would, and records which operations the sweep went on to run.
 * Loading an operation answers "not found", so each run ends straight away.
 */
function fakeQueue(rows: Row[]) {
  const attempted: string[] = [];
  const admin = {
    from(table: string) {
      if (table !== "refund_operations") throw new Error(`unexpected table ${table}`);
      let result = [...rows];
      let limit = Infinity;
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.in = (column: keyof Row, values: string[]) => {
        result = result.filter((row) => values.includes(String(row[column])));
        return builder;
      };
      builder.lt = (column: keyof Row, value: string) => {
        result = result.filter((row) => String(row[column]) < value);
        return builder;
      };
      builder.or = (filter: string) => {
        const due = /^next_attempt_at\.is\.null,next_attempt_at\.lte\.(.+)$/.exec(filter);
        if (!due) throw new Error(`unexpected filter ${filter}`);
        result = result.filter((row) => row.next_attempt_at === null || row.next_attempt_at <= due[1]);
        return builder;
      };
      builder.order = (column: keyof Row) => {
        result.sort((a, b) => String(a[column]).localeCompare(String(b[column])));
        return builder;
      };
      builder.limit = (n: number) => {
        limit = n;
        return builder;
      };
      builder.eq = (_column: string, id: string) => {
        attempted.push(id);
        return builder;
      };
      builder.maybeSingle = async () => ({ data: null, error: null });
      builder.then = (resolve: (value: { data: Row[]; error: null }) => unknown) =>
        resolve({ data: result.slice(0, limit), error: null });
      return builder;
    },
  };
  return { admin: admin as never, attempted };
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const minutesAhead = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

describe("resumeIncompleteRefunds", () => {
  it("runs due operations even when backed-off ones are oldest", async () => {
    const { admin, attempted } = fakeQueue([
      // The oldest three are waiting out a backoff — they used to fill the batch.
      { id: "waiting-1", status: "provider_pending", updated_at: minutesAgo(60), next_attempt_at: minutesAhead(30) },
      { id: "waiting-2", status: "provider_pending", updated_at: minutesAgo(59), next_attempt_at: minutesAhead(45) },
      { id: "waiting-3", status: "reversal_pending", updated_at: minutesAgo(58), next_attempt_at: minutesAhead(50) },
      { id: "due-1", status: "effects_pending", updated_at: minutesAgo(40), next_attempt_at: null },
      { id: "due-2", status: "provider_pending", updated_at: minutesAgo(30), next_attempt_at: minutesAgo(1) },
      { id: "due-3", status: "requested", updated_at: minutesAgo(20), next_attempt_at: null },
      { id: "due-4", status: "requested", updated_at: minutesAgo(10), next_attempt_at: null },
    ]);

    const summary = await resumeIncompleteRefunds(admin, { batch: 3 });

    expect(attempted).toEqual(["due-1", "due-2", "due-3"]);
    expect(summary.scanned).toBe(3);
  });

  it("leaves finished and freshly touched operations alone", async () => {
    const { admin, attempted } = fakeQueue([
      { id: "done", status: "completed", updated_at: minutesAgo(60), next_attempt_at: null },
      { id: "fresh", status: "requested", updated_at: minutesAgo(1), next_attempt_at: null },
      { id: "due", status: "requested", updated_at: minutesAgo(30), next_attempt_at: null },
    ]);

    await resumeIncompleteRefunds(admin, { batch: 3 });

    expect(attempted).toEqual(["due"]);
  });
});
