import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ACCOUNT_EXPORT_CONTRACT_VERSION, ACCOUNT_EXPORT_PAGE_SIZE, ACCOUNT_EXPORT_SECTIONS, MESSAGE_PHOTO_PAGE_SIZE, exportCursorFilter, exportDownloadDecision, exportPageSize, nextExportCheckpoint, storageObjectMissing } from "./account-export-contract";

describe("account export contract", () => {
  it("uses explicit projections and covers both sides of shared records", () => {
    expect(ACCOUNT_EXPORT_CONTRACT_VERSION).toBe("2026-10-25.v11");
    expect(ACCOUNT_EXPORT_SECTIONS.every((section) => !section.projection.includes("*"))).toBe(true);
    const keys = ACCOUNT_EXPORT_SECTIONS.map((section) => section.key);
    expect(keys).toEqual(expect.arrayContaining([
      "messages_sent", "messages_received", "offers_made", "offers_received", "offer_rounds_made", "offer_rounds_received", "returns",
      "dispute_evidence", "seller_adjustments", "transfers", "refunds", "refund_recredit_proofs", "order_snapshot_images",
      "shipments", "shipment_events",
    ]));
  });

  it("exports the seller's offer minimums from their private home", () => {
    const byKey = new Map(ACCOUNT_EXPORT_SECTIONS.map((section) => [section.key, section]));
    expect(byKey.get("listing_private_terms")).toMatchObject({ table: "listing_private_terms", access: "seller", filter: "seller_id" });
    expect(byKey.get("listing_private_terms")!.projection.split(",")).toContain("offer_floor_cents");
    expect(byKey.get("listings")!.projection.split(",")).not.toContain("offer_floor_cents");
  });

  it("exports the member's agent, without the queue or internal ids", () => {
    const byKey = new Map(ACCOUNT_EXPORT_SECTIONS.map((section) => [section.key, section]));
    for (const key of ["agent_mandates", "agent_mandate_versions", "agent_tasks", "agent_events", "agent_approvals", "agent_conversations", "agent_messages"]) {
      expect(byKey.get(key), `${key} is missing`).toMatchObject({ table: key, access: "owner", filter: "owner_id" });
    }
    const events = byKey.get("agent_events")!.projection.split(",");
    for (const field of ["job_id", "idempotency_key"]) expect(events, `agent_events leaked ${field}`).not.toContain(field);
    expect(ACCOUNT_EXPORT_SECTIONS.some((section) => ["agent_jobs", "agent_telemetry", "agent_controls"].includes(section.table))).toBe(false);
  });

  /**
   * A member's export has to contain the whole record, and a mod line is now
   * more than its text: whether the part is still on the car, when it came
   * off, where it was bought and what the shop charged. Missing columns here
   * are invisible — the export just quietly omits them — so the projection is
   * asserted rather than trusted.
   */
  it("exports a modification line's state and provenance, not just its text", () => {
    const mods = ACCOUNT_EXPORT_SECTIONS.find((section) => section.key === "mod_items");
    expect(mods).toBeDefined();
    const fields = mods!.projection.split(",").map((field) => field.trim());
    for (const field of [
      "status", "removed_at", "source_order_item_id",
      "product_url", "image_url", "source_domain",
      "ref_price_cents", "ref_price_currency", "origin",
    ]) {
      expect(fields, `mod_items export is missing ${field}`).toContain(field);
    }
  });

  /**
   * Two things the contract predated: photos sent in messages (the message
   * row only names their private paths) and the carry-forward ledger of label
   * costs. Both are the member's data and were silently absent.
   */
  it("exports message photos and the label-cost ledger", () => {
    const byKey = new Map(ACCOUNT_EXPORT_SECTIONS.map((section) => [section.key, section]));
    for (const key of ["messages_sent", "messages_received"]) {
      const fields = byKey.get(key)!.projection.split(",");
      expect(fields, `${key} is missing the photo paths`).toContain("attachments");
      expect(fields).toContain("kind");
    }
    expect(byKey.get("message_photos_sent")).toMatchObject({ table: "messages", filter: "sender_id", pageSize: MESSAGE_PHOTO_PAGE_SIZE });
    expect(byKey.get("message_photos_received")).toMatchObject({ table: "messages", filter: "recipient_id", pageSize: MESSAGE_PHOTO_PAGE_SIZE });
    const carry = byKey.get("seller_carry_entries")!;
    expect(carry).toMatchObject({ table: "seller_carry_entries", access: "seller", filter: "seller_id" });
    expect(carry.projection.split(",")).toEqual(expect.arrayContaining(["kind", "amount_cents", "order_id", "created_at"]));
    expect(carry.projection.split(",")).not.toContain("entry_key");
    const payouts = byKey.get("seller_carry_payouts")!;
    expect(payouts).toMatchObject({ table: "seller_carry_payouts", access: "seller", filter: "seller_id" });
    for (const field of ["destination", "transfer_reference", "locked_by", "last_error"]) {
      expect(payouts.projection.split(","), `seller_carry_payouts leaked ${field}`).not.toContain(field);
    }
  });

  it("pages a photo section by its own smaller size", () => {
    const section = ACCOUNT_EXPORT_SECTIONS.find((item) => item.key === "message_photos_sent")!;
    expect(exportPageSize(section)).toBe(MESSAGE_PHOTO_PAGE_SIZE);
    const full = Array.from({ length: MESSAGE_PHOTO_PAGE_SIZE }, (_, index) => ({ id: `m${index}` }));
    // A full small page continues the section; it must not be read as the last.
    expect(nextExportCheckpoint(section, { section: 3, offset: 0, cursor: null }, full)).toEqual({ section: 3, offset: MESSAGE_PHOTO_PAGE_SIZE, cursor: '["m9"]' });
    expect(nextExportCheckpoint(section, { section: 3, offset: 10, cursor: '["m9"]' }, full.slice(0, 4))).toEqual({ section: 4, offset: 0, cursor: null });
  });

  it("tells a missing photo from a storage failure", () => {
    expect(storageObjectMissing({ status: 404, message: "Object not found" })).toBe(true);
    expect(storageObjectMissing({ statusCode: "404" })).toBe(true);
    expect(storageObjectMissing({ status: 400, message: "Object not found" })).toBe(true);
    expect(storageObjectMissing({ status: 500, message: "upstream timeout" })).toBe(false);
    expect(storageObjectMissing(null)).toBe(false);
  });

  it("keeps provider secrets and unrelated counterparty profiles out", () => {
    const forbidden = ["raw", "idempotency_key", "token_hash", "code_hash", "provider_reference", "last_error", "destination_hash", "replaces_adjustment_id", "replacement_transfer_reference", "adjustment_id", "recovery_id", "verified_by", "balance_transaction", "recredit_transfer_reference"];
    for (const section of ACCOUNT_EXPORT_SECTIONS) {
      const fields = section.projection.split(",").map((field) => field.trim());
      for (const field of forbidden) expect(fields, `${section.key} leaked ${field}`).not.toContain(field);
      expect(section.projection).not.toMatch(/profiles!/);
    }
  });

  it("is a version the database will actually accept and stamp", () => {
    // The version lives in two places. The constant was once bumped without a
    // migration: every request was stamped with the old version, the worker
    // saw one that wasn't its own, purged it, and no export ever completed.
    const dir = join(process.cwd(), "supabase/migrations");
    const latest = readdirSync(dir)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .reverse()
      .map((file) => readFileSync(join(dir, file), "utf8"))
      .find((sql) => sql.includes("function public.request_account_export"));
    expect(latest, "no migration defines request_account_export").toBeDefined();
    expect(latest).toContain(`'${ACCOUNT_EXPORT_CONTRACT_VERSION}'`);
  });

  it("resumes beyond two page boundaries without replaying a cursor page", () => {
    const section = ACCOUNT_EXPORT_SECTIONS.find((item) => item.key === "messages_sent")!;
    const page = Array.from({ length: ACCOUNT_EXPORT_PAGE_SIZE }, (_, index) => ({ id: String(index).padStart(4, "0") }));
    const first = nextExportCheckpoint(section, { section: 0, offset: 0, cursor: null }, page);
    expect(first).toEqual({ section: 0, offset: 250, cursor: '["0249"]' });
    const second = nextExportCheckpoint(section, first, page.map((_, index) => ({ id: String(index + 250).padStart(4, "0") })));
    expect(second).toEqual({ section: 0, offset: 500, cursor: '["0499"]' });
    expect(nextExportCheckpoint(section, second, [{ id: "0500" }])).toEqual({ section: 1, offset: 0, cursor: null });
  });

  it("builds a stable lexicographic cursor for composite keys", () => {
    expect(exportCursorFilter(["target_type", "target_id"], '["car","abc"]')).toBe(
      'target_type.gt."car",and(target_type.eq."car",target_id.gt."abc")',
    );
    expect(() => exportCursorFilter(["target_type"], '["car", "extra"]')).toThrow("Invalid export cursor");
    expect(exportCursorFilter(["id"], "legacy-uuid-cursor")).toBe('id.gt."legacy-uuid-cursor"');
  });

  it("denies anonymous, unrelated, incomplete and expired downloads", () => {
    const request = { user_id: "owner", status: "completed", expires_at: "2030-01-02T00:00:00Z" };
    const now = new Date("2030-01-01T00:00:00Z").getTime();
    expect(exportDownloadDecision(null, request, now)).toBe("unauthenticated");
    expect(exportDownloadDecision("other", request, now)).toBe("not_found");
    expect(exportDownloadDecision("owner", { ...request, status: "processing" }, now)).toBe("not_ready");
    expect(exportDownloadDecision("owner", { ...request, status: "expired" }, now)).toBe("expired");
    expect(exportDownloadDecision("owner", { ...request, expires_at: "2029-12-01T00:00:00Z" }, now)).toBe("expired");
    expect(exportDownloadDecision("owner", request, now)).toBe("allowed");
  });
});
