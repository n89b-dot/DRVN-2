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
/** How many "delivered" writes fail before one succeeds. */
let failMarkDelivered = 0;

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
      // Filters accumulate; awaiting the builder (or .select()) applies the
      // update to every matching row, like PostgREST.
      const filters: ((row: Row) => boolean)[] = [];
      const apply = () => {
        if (failMarkDelivered > 0 && values.status === "delivered") {
          failMarkDelivered -= 1;
          return { data: null, error: { message: "write failed" } };
        }
        const matched = table.filter((row) => filters.every((f) => f(row)));
        for (const row of matched) Object.assign(row, values);
        return { data: matched.map((row) => ({ id: row.id })), error: null };
      };
      const builder = {
        eq(col: string, value: unknown) {
          filters.push((row) => row[col] === value);
          return builder;
        },
        lte(col: string, value: string) {
          filters.push((row) => String(row[col] ?? "") <= value);
          return builder;
        },
        select: async () => apply(),
        then: (resolve: (value: unknown) => unknown) => resolve(apply()),
      };
      return builder;
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
    failMarkDelivered = 0;
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

  it("sends the alert id so a receiver can recognise a re-send", async () => {
    vi.stubEnv("ADMIN_ALERT_WEBHOOK_URL", WEBHOOK);
    const fetchSpy = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await sendAdminAlert({ kind: "test", title: "hello" });
    const init = (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe(table[0].id);
    expect(JSON.parse(String(init.body)).alertId).toBe(table[0].id);
  });

  it("retries a lost delivered write once instead of re-sending the alert", async () => {
    vi.stubEnv("ADMIN_ALERT_WEBHOOK_URL", WEBHOOK);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
    failMarkDelivered = 1;
    await sendAdminAlert({ kind: "test", title: "hello" });
    expect(table[0].status).toBe("delivered");
  });

  it("holds a delivered-but-unmarked alert back from the next sweep", async () => {
    vi.stubEnv("ADMIN_ALERT_WEBHOOK_URL", WEBHOOK);
    const fetchSpy = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    failMarkDelivered = 2;
    await sendAdminAlert({ kind: "test", title: "hello" });
    expect(table[0].status).toBe("pending");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    await processAlertOutbox(createAdminClient());
    // The claim's lease keeps it from going out again straight away.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
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
      next_attempt_at: new Date(Date.now() - 1000).toISOString(),
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
      next_attempt_at: new Date(Date.now() - 1000).toISOString(),
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
