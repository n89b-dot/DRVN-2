import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { processAlertOutbox, sendAdminAlert } from "./alerts";

/**
 * Delivery-path tests for the durable alert outbox. The Supabase admin client
 * is replaced with an in-memory table double; fetch is stubbed per scenario.
 * What these pin down: enqueue is the durable commitment (rows exist whatever
 * delivery does), failures leave retryable `pending` rows instead of lying,
 * an unset destination is recorded as `disabled` — never pretended delivered —
 * and dedup keys collapse repeats.
 */

type Row = Record<string, unknown> & { id: string; status: string; attempts: number };

const table: Row[] = [];
let nextId = 1;

function chain(rowsAfterOp: () => Row[]) {
  // Minimal PostgREST-builder double: supports the exact chains alerts.ts uses.
  return {
    insert(values: Record<string, unknown>) {
      const dedup = values.dedup_key as string | null;
      if (dedup && table.some((r) => r.dedup_key === dedup)) {
        const error = { code: "23505", message: "duplicate key" };
        return {
          select: () => ({ maybeSingle: async () => ({ data: null, error }) }),
        };
      }
      const row = {
        id: `alert-${nextId++}`,
        status: "pending",
        attempts: 0,
        next_attempt_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        last_error: null,
        delivered_at: null,
        ...values,
      } as Row;
      table.push(row);
      return {
        select: () => ({ maybeSingle: async () => ({ data: { ...row }, error: null }) }),
      };
    },
    update(values: Record<string, unknown>) {
      return {
        eq: async (_col: string, id: string) => {
          const row = table.find((r) => r.id === id);
          if (row) Object.assign(row, values);
          return { data: null, error: null };
        },
      };
    },
    select() {
      const rows = rowsAfterOp();
      const builder = {
        eq: () => builder,
        lte: () => builder,
        order: () => builder,
        limit: async () => ({ data: rows.map((r) => ({ ...r })), error: null }),
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => chain(() => table.filter((r) => r.status === "pending")),
  }),
}));

const WEBHOOK = "https://hooks.example/drvn";

describe("sendAdminAlert", () => {
  beforeEach(() => {
    table.length = 0;
    nextId = 1;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("delivers and marks delivered on 2xx", async () => {
    vi.stubEnv("ADMIN_ALERT_WEBHOOK_URL", WEBHOOK);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
    await sendAdminAlert({ kind: "test", title: "hello" });
    expect(table).toHaveLength(1);
    expect(table[0].status).toBe("delivered");
  });

  it("leaves a retryable pending row on provider error (HTTP 500)", async () => {
    vi.stubEnv("ADMIN_ALERT_WEBHOOK_URL", WEBHOOK);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    await sendAdminAlert({ kind: "test", title: "hello" });
    expect(table[0].status).toBe("pending");
    expect(table[0].attempts).toBe(1);
    expect(String(table[0].last_error)).toContain("500");
  });

  it("leaves a retryable pending row on timeout/network failure", async () => {
    vi.stubEnv("ADMIN_ALERT_WEBHOOK_URL", WEBHOOK);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("timeout");
      })
    );
    await sendAdminAlert({ kind: "test", title: "hello" });
    expect(table[0].status).toBe("pending");
    expect(table[0].attempts).toBe(1);
  });

  it("records 'disabled' — not delivered — when no destination is configured", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await sendAdminAlert({ kind: "test", title: "hello" });
    expect(table[0].status).toBe("disabled");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("dedup key collapses duplicate generation", async () => {
    vi.stubEnv("ADMIN_ALERT_WEBHOOK_URL", WEBHOOK);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
    await sendAdminAlert({ kind: "test", title: "a", dedupKey: "same" });
    await sendAdminAlert({ kind: "test", title: "a again", dedupKey: "same" });
    expect(table).toHaveLength(1);
  });
});

describe("processAlertOutbox", () => {
  beforeEach(() => {
    table.length = 0;
    nextId = 1;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("retries pending rows and marks delivered on success", async () => {
    vi.stubEnv("ADMIN_ALERT_WEBHOOK_URL", WEBHOOK);
    table.push({
      id: "alert-p1",
      kind: "test",
      title: "queued",
      detail: null,
      order_id: null,
      amount_cents: null,
      status: "pending",
      attempts: 2,
    } as Row);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const summary = await processAlertOutbox(createAdminClient());
    expect(summary.delivered).toBe(1);
    expect(table[0].status).toBe("delivered");
  });

  it("marks 'failed' — visibly — when attempts exhaust", async () => {
    vi.stubEnv("ADMIN_ALERT_WEBHOOK_URL", WEBHOOK);
    table.push({
      id: "alert-p2",
      kind: "test",
      title: "doomed",
      detail: null,
      order_id: null,
      amount_cents: null,
      status: "pending",
      attempts: 9, // one below MAX_DELIVERY_ATTEMPTS (10)
    } as Row);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 503 })));
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const summary = await processAlertOutbox(createAdminClient());
    expect(summary.retrying).toBe(1);
    expect(table[0].status).toBe("failed");
    expect(table[0].attempts).toBe(10);
  });

  it("does nothing when the destination is unset", async () => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const summary = await processAlertOutbox(createAdminClient());
    expect(summary).toEqual({ delivered: 0, retrying: 0, skipped: 0 });
  });
});
