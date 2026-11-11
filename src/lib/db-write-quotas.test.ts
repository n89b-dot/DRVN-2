import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/monitoring", () => ({ captureMessage: vi.fn() }));

import { DB_QUOTA_SQLSTATE, DB_WRITE_QUOTAS, isDatabaseQuotaError } from "./db-write-quotas";
import { RATE_LIMITS } from "./rate-limit";

// The quota function and every trigger as the database holds them
// (supabase/schema/, plan 2 items A1 and A6), not one migration's text.
const schema = join(process.cwd(), "supabase/schema");
const migration = [
  readFileSync(join(schema, "functions/private.member_write_quota.sql"), "utf8"),
  ...readdirSync(join(schema, "triggers")).sort().map((file) => readFileSync(join(schema, "triggers", file), "utf8")),
].join("\n");

function seconds(window: string): number {
  const [n, unit] = window.split(" ");
  return Number(n) * (unit.startsWith("minute") ? 60 : unit.startsWith("hour") ? 3600 : 1);
}

describe("N247 database write quotas", () => {
  const triggers = [
    ...migration.matchAll(
      /before insert on public\.(\w+)\s+for each row execute function private\.member_write_quota\('([\w-]+)', '(\d+)', '([^']+)'\)/gi
    ),
  ].map(([, table, action, limit, window]) => ({ table, action, limit: Number(limit), windowSeconds: seconds(window) }));

  it("puts a database quota on every direct member write path the app limits", () => {
    expect(triggers.map((t) => t.table).sort()).toEqual(DB_WRITE_QUOTAS.map((q) => q.table).sort());
    for (const quota of DB_WRITE_QUOTAS) {
      expect(triggers).toContainEqual({
        table: quota.table,
        action: quota.action,
        limit: quota.limit,
        windowSeconds: quota.windowSeconds,
      });
    }
  });

  it("matches the app's own rule, so the database never refuses before the friendly message", () => {
    for (const quota of DB_WRITE_QUOTAS) {
      if (!quota.appRule) continue;
      const rule = RATE_LIMITS[quota.appRule as keyof typeof RATE_LIMITS];
      expect(rule, quota.appRule).toBeDefined();
      expect(rule.limit).toBe(quota.limit);
      expect(rule.windowSeconds).toBe(quota.windowSeconds);
      expect(rule.action).toBe(quota.action);
    }
  });

  it("recognises the trigger's SQLSTATE and nothing else", () => {
    expect(migration).toContain(`errcode = '${DB_QUOTA_SQLSTATE}'`);
    expect(isDatabaseQuotaError({ code: "RL429", message: "x" })).toBe(true);
    expect(isDatabaseQuotaError({ code: "23505" })).toBe(false);
    expect(isDatabaseQuotaError(null)).toBe(false);
  });
});
