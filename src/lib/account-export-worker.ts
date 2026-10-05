import { allRows } from "./account-export-pagination";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import "server-only";

import {
  ACCOUNT_EXPORT_CONTRACT_VERSION,
  ACCOUNT_EXPORT_EXCLUSIONS,
  ACCOUNT_EXPORT_SECTIONS,
  MESSAGE_PHOTO_SECTIONS,
  exportCursorFilter,
  exportPageSize,
  storageObjectMissing,
  nextExportCheckpoint,
  type ExportSection,
} from "./account-export-contract";
import { jobHeartbeat } from "./job-lease";
import { reportError } from "./monitoring";
import { createAdminClient } from "./supabase/admin";

type ExportJob = { id: string; lease_id: string; payload: { request_id: string; user_id: string } };
type ExportRequest = {
  id: string;
  job: ExportJob;
  user_id: string;
  cutoff_at: string;
  current_section: number;
  current_offset: number;
  current_cursor: string | null;
  expires_at: string;
  status: string;
  contract_version: string;
};
type UntypedAdmin = SupabaseClient;

const BUCKET = "account-exports";
const PURGE_RETRY_AFTER_MS = 15 * 60 * 1000;
const PURGE_RESWEEP_AFTER_MS = 24 * 60 * 60 * 1000;

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function ids(admin: UntypedAdmin, table: string, field: string, filter: string, userId: string) {
  return (await allRows(admin.from(table).select(field).eq(filter, userId).order(field))).map(row => row[field]);
}

type RelatedIds = { field: string; values: string[] } | null;

async function authorizedIds(admin: UntypedAdmin, section: ExportSection, userId: string): Promise<RelatedIds> {
  switch (section.key) {
    case "order_snapshot_images": {
      const orderIds = await ids(admin, "orders", "id", "buyer_id", userId);
      const soldOrderIds = await ids(admin, "orders", "id", "seller_id", userId);
      const access = [...new Set([...orderIds, ...soldOrderIds])];
      if (!access.length) return { field: "order_item_id", values: [] as string[] };
      const rows = await allRows(admin.from("order_items").select("id").in("order_id", access).order("id"));
      return { field: "order_item_id", values: rows.map(row => row.id) };
    }
    case "refund_adjustments": {
      const orderIds = [...new Set([...await ids(admin, "orders", "id", "buyer_id", userId), ...await ids(admin, "orders", "id", "seller_id", userId)])];
      if (!orderIds.length) return { field: "refund_operation_id", values: [] as string[] };
      const rows = await allRows(admin.from("refund_operations").select("id").in("order_id", orderIds).order("id"));
      return { field: "refund_operation_id", values: rows.map(row => row.id) };
    }
    case "refund_recredit_proofs": {
      const orderIds = [...new Set([...await ids(admin, "orders", "id", "buyer_id", userId), ...await ids(admin, "orders", "id", "seller_id", userId)])];
      if (!orderIds.length) return { field: "adjustment_id", values: [] as string[] };
      const operations = await allRows(admin.from("refund_operations").select("id").in("order_id", orderIds).order("id"));
      if (!operations.length) return { field: "adjustment_id", values: [] as string[] };
      const adjustments = await allRows(admin.from("refund_lifecycle_adjustments").select("id").in("refund_operation_id", operations.map(row => row.id)).order("id"));
      return { field: "adjustment_id", values: adjustments.map(row => row.id) };
    }
    case "return_items": {
      const orderIds = [...new Set([...await ids(admin, "orders", "id", "buyer_id", userId), ...await ids(admin, "orders", "id", "seller_id", userId)])];
      if (!orderIds.length) return { field: "return_id", values: [] as string[] };
      const rows = await allRows(admin.from("returns").select("id").in("order_id", orderIds).order("id"));
      return { field: "return_id", values: rows.map(row => row.id) };
    }
    case "shipment_items": case "shipment_events": {
      const orderIds = [...new Set([...await ids(admin, "orders", "id", "buyer_id", userId), ...await ids(admin, "orders", "id", "seller_id", userId)])];
      if (!orderIds.length) return { field: "shipment_id", values: [] as string[] };
      const rows = await allRows(admin.from("shipments").select("id").in("order_id", orderIds).order("id"));
      return { field: "shipment_id", values: rows.map(row => row.id) };
    }
    default:
      return null;
  }
}

async function readPage(admin: UntypedAdmin, request: ExportRequest, section: ExportSection) {
  let query = admin.from(section.table).select(section.sourceProjection ?? section.projection);
  const related = await authorizedIds(admin, section, request.user_id);
  if (related) {
    if (!related.values.length) return [];
    query = query.in(related.field, related.values);
  } else if (["car_images", "car_hotspots", "mod_items"].includes(section.key)) {
    query = query.eq("cars.owner_id", request.user_id);
  } else if (section.key === "activity_images") {
    query = query.eq("activity_posts.author_id", request.user_id);
  } else if (["listing_images", "listing_fitments", "listing_part_numbers", "offers_received"].includes(section.key)) {
    query = query.eq("listings.seller_id", request.user_id);
  } else if (["order_items", "payments", "refunds", "returns", "dispute_evidence", "shipments", "pickup_confirmations"].includes(section.key)) {
    query = query.or(`buyer_id.eq.${request.user_id},seller_id.eq.${request.user_id}`, { referencedTable: "orders" });
  } else if (section.filter.includes("|")) {
    const [left, right] = section.filter.split("|");
    query = query.or(`${left}.eq.${request.user_id},${right}.eq.${request.user_id}`);
  } else {
    query = query.eq(section.filter, request.user_id);
  }
  if (isMessagePhotoSection(section)) query = query.neq("attachments", "{}");
  if (section.cutoffColumn) query = query.lte(section.cutoffColumn, request.cutoff_at);
  const pageSize = exportPageSize(section);
  if (section.cursor) {
    const cursorFields = section.cursor.split(",");
    for (const field of cursorFields) query = query.order(field);
    if (request.current_cursor) query = query.or(exportCursorFilter(cursorFields, request.current_cursor));
    query = query.limit(pageSize);
  } else {
    query = query.order(section.cutoffColumn ?? section.filter.split("|")[0]);
    query = query.range(request.current_offset, request.current_offset + pageSize - 1);
  }
  const result = await query;
  if (result.error) throw new Error(`Export section ${section.key} failed: ${result.error.message}`);
  return ((result.data ?? []) as unknown as Record<string, unknown>[]).map((row) => {
    const output = { ...row };
    for (const field of section.excludedSourceFields ?? []) {
      output[`__cursor_${field}`] = output[field];
      delete output[field];
    }
    return output;
  });
}

async function persistPart(admin: UntypedAdmin, request: ExportRequest, sectionKey: string, page: number, body: Uint8Array, rowCount: number, contentType = "application/json") {
  // A stale lease must never delete a newer lease's identically hashed upload.
  const objectPath = `${request.user_id}/${request.id}/${sectionKey}/${String(page).padStart(8, "0")}-${request.job.lease_id}-${sha256(body)}`;
  const upload = await admin.storage.from(BUCKET).upload(objectPath, body, { contentType, upsert: true, cacheControl: "no-store" });
  if (upload.error) throw new Error(`Could not store export section ${sectionKey}`);
  const saved = await admin.rpc("write_account_export", {
    p_job: request.job.id, p_lease: request.job.lease_id, p_request: request.id,
    p_part: {section_key: sectionKey, page_number: page, object_path: objectPath,
      row_count: rowCount, byte_count: body.byteLength, sha256: sha256(body), content_type: contentType},
  });
  if (saved.error) {
    const registered = await admin.from("account_export_parts").select("request_id").eq("object_path", objectPath).maybeSingle();
    const exactLease = await admin.from("remediation_jobs").select("id").eq("id", request.job.id).eq("lease_id", request.job.lease_id).eq("status", "processing").maybeSingle();
    if (!registered.error && !registered.data && !exactLease.error && exactLease.data) await admin.storage.from(BUCKET).remove([objectPath]);
    throw new Error(`Could not checkpoint export section ${sectionKey}`);
  }
  return objectPath;
}

async function copyEvidenceAssets(admin: UntypedAdmin, request: ExportRequest, rows: Record<string, unknown>[]) {
  for (const row of rows) {
    const sourcePath = typeof row.storage_path === "string" ? row.storage_path : null;
    const evidenceId = typeof row.id === "string" ? row.id : null;
    if (!sourcePath || !evidenceId) throw new Error("Export evidence is missing a private storage path");
    const downloaded = await admin.storage.from("dispute-evidence").download(sourcePath);
    if (downloaded.error || !downloaded.data) throw new Error(`Could not copy private evidence ${evidenceId}`);
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    await persistPart(admin, request, `dispute_evidence_asset_${evidenceId}`, 0, bytes, 1, downloaded.data.type || "application/octet-stream");
  }
}

function isMessagePhotoSection(section: ExportSection) {
  return (MESSAGE_PHOTO_SECTIONS as readonly string[]).includes(section.key);
}

/**
 * Copies a page of messages' photos into the package and returns the rows
 * with, for each, where every photo went: `photos[i]` is the package part
 * (`asset`) holding `attachments[i]`, or `missing` when the object no longer
 * exists in storage. A missing photo is reported in the export, not treated
 * as a failure: the message row outlives its photo when storage has been
 * cleaned up, and failing would stop that member's export for good. Any other
 * storage error fails the page, which is retried.
 */
async function copyMessagePhotos(admin: UntypedAdmin, request: ExportRequest, rows: Record<string, unknown>[], heartbeat: () => Promise<void>) {
  const listed: Record<string, unknown>[] = [];
  for (const row of rows) {
    const messageId = typeof row.id === "string" ? row.id : null;
    const paths = Array.isArray(row.attachments) ? row.attachments.filter((path): path is string => typeof path === "string") : [];
    if (!messageId) throw new Error("Export message is missing its id");
    const photos: Array<{ path: string; asset?: string; missing?: true }> = [];
    for (const [index, path] of paths.entries()) {
      await heartbeat();
      const downloaded = await admin.storage.from("message-photos").download(path);
      if (downloaded.error || !downloaded.data) {
        if (storageObjectMissing(downloaded.error)) { photos.push({ path, missing: true }); continue; }
        throw new Error(`Could not copy message photo ${messageId}/${index}`);
      }
      const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
      const asset = `message_photo_asset_${messageId}_${index}`;
      await persistPart(admin, request, asset, 0, bytes, 1, downloaded.data.type || "application/octet-stream");
      photos.push({ path, asset });
    }
    listed.push({ ...row, photos });
  }
  return listed;
}

async function completeExport(admin: UntypedAdmin, request: ExportRequest) {
  const parts = await allRows<{section_key: string; page_number: number; object_path: string; row_count: number; byte_count: number; sha256: string; content_type: string}>(admin.from("account_export_parts").select("section_key,page_number,object_path,row_count,byte_count,sha256,content_type").eq("request_id", request.id).order("section_key").order("page_number"));
  const counts = Object.fromEntries(ACCOUNT_EXPORT_SECTIONS.map(section => [section.key,
    parts.filter((part: { section_key: string; content_type: string }) => part.section_key === section.key && part.content_type === "application/json")
      .reduce((sum: number, part: { row_count: number }) => sum + part.row_count, 0),
  ]));
  const auth = await admin.auth.admin.getUserById(request.user_id);
  if (auth.error || !auth.data.user) throw new Error("Requester eligibility changed before export delivery");
  const manifest = {
    format: "drvn-account-export-package",
    contract_version: ACCOUNT_EXPORT_CONTRACT_VERSION,
    request_id: request.id,
    requester: { id: request.user_id, email: auth.data.user.email, created_at: auth.data.user.created_at },
    cutoff_at: request.cutoff_at,
    completed_at: new Date().toISOString(),
    consistency: "Sections with creation timestamps exclude rows created after cutoff_at. Other sections and updates reflect their page-read time. This is a resumable export, not a single database snapshot. Published parts are content-hashed.",
    counts,
    exclusions: ACCOUNT_EXPORT_EXCLUSIONS,
    policy_decisions_pending: ["external analytics event retention/erasure", "audit and operational-log subject access", "backup expiry"],
    parts,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  await persistPart(admin, request, "manifest", 0, bytes, 1);
  const updated = await admin.rpc("write_account_export", {p_job:request.job.id,p_lease:request.job.lease_id,p_request:request.id,p_manifest:manifest});
  if (updated.error) throw new Error("Could not publish export manifest");
}

async function purgeExportRequest(admin: UntypedAdmin, requestId: string) {
  const request = await admin.from("account_export_requests").select("user_id,status").eq("id",requestId).single().throwOnError();
  const attemptedAt = new Date().toISOString();
  const purgeState: Record<string, unknown> = {
    status: "expired",
    manifest: null,
    manifest_path: null,
    last_purge_attempt_at: attemptedAt,
    purged_at: null,
  };
  if (request.data.status !== "expired") purgeState.expires_at = attemptedAt;
  await admin.from("account_export_requests").update(purgeState).eq("id", requestId).throwOnError();
  // Inventory the complete private prefix, including bytes uploaded before a
  // worker crash that never reached the parts register. Delete after listing.
  const paths: string[] = [];
  const folders = [`${request.data.user_id}/${requestId}`];
  for (let folder = 0; folder < folders.length; folder++) {
    for (let offset = 0; ; offset += 100) {
      const listed = await admin.storage.from(BUCKET).list(folders[folder],{limit:100,offset,sortBy:{column:"name",order:"asc"}});
      if(listed.error) throw new Error("Could not inventory export package storage");
      for(const item of listed.data) {
        const path = `${folders[folder]}/${item.name}`;
        if(item.id) paths.push(path); else folders.push(path);
      }
      if(paths.length+folders.length>100_000) throw new Error("Export cleanup requires operator-assisted partitioning");
      if(listed.data.length<100) break;
    }
  }
  for (let offset = 0; offset < paths.length; offset += 100) {
    const removed = await admin.storage.from(BUCKET).remove(paths.slice(offset, offset + 100));
    if (removed.error) throw new Error("Could not purge account export package");
  }
  await admin.from("account_export_requests").update({ purged_at: new Date().toISOString() }).eq("id", requestId).throwOnError();
}
export async function purgeAccountExportsForUser(userId: string) {
  const admin = createAdminClient() as unknown as UntypedAdmin;
  const requests = await allRows(admin.from("account_export_requests").select("id").eq("user_id", userId).order("id"));
  const failures: string[] = [];
  for (const request of requests) {
    try { await purgeExportRequest(admin, request.id); }
    catch { failures.push(request.id); }
  }
  if (failures.length) throw new Error(`Could not purge ${failures.length} account export package(s)`);
}

export async function purgeExpiredAccountExports() {
  const admin = createAdminClient() as unknown as UntypedAdmin;
  const now = Date.now();
  const retryBefore = new Date(now - PURGE_RETRY_AFTER_MS).toISOString();
  const resweepBefore = new Date(now - PURGE_RESWEEP_AFTER_MS).toISOString();
  const projection = "id,expires_at,last_purge_attempt_at,purged_at";
  const [newlyExpired, retries, resweeps] = await Promise.all([
    admin.from("account_export_requests").select(projection).neq("status", "expired").lte("expires_at", new Date(now).toISOString()).order("expires_at").limit(20),
    admin.from("account_export_requests").select(projection).eq("status", "expired").is("purged_at", null).or(`last_purge_attempt_at.is.null,last_purge_attempt_at.lt.${retryBefore}`).order("last_purge_attempt_at", { nullsFirst: true }).limit(20),
    admin.from("account_export_requests").select(projection).eq("status", "expired").lt("purged_at", resweepBefore).order("purged_at").limit(20),
  ]);
  if (newlyExpired.error || retries.error || resweeps.error) throw new Error("Could not read expired account exports");
  type Candidate = { id: string; expires_at: string; last_purge_attempt_at: string | null; purged_at: string | null };
  const candidates = [...new Map(
    [...(newlyExpired.data ?? []), ...(retries.data ?? []), ...(resweeps.data ?? [])]
      .map((row) => [row.id, row as Candidate]),
  ).values()].sort((left, right) => {
    const leftDue = Date.parse(left.last_purge_attempt_at ?? left.purged_at ?? left.expires_at);
    const rightDue = Date.parse(right.last_purge_attempt_at ?? right.purged_at ?? right.expires_at);
    return leftDue - rightDue;
  }).slice(0, 20);
  let purged = 0;
  const failures: string[] = [];
  // Expire only the selected package: newer packages for the owner remain valid.
  for (const request of candidates) {
    try { await purgeExportRequest(admin, request.id); purged++; }
    catch (error) {
      failures.push(request.id);
      reportError("[account-export] purge retry required", { requestId: request.id, error: error instanceof Error ? error.message : "Export purge failed" });
    }
  }
  if (failures.length) throw new Error(`Could not purge ${failures.length} expired account export package(s)`);
  return { expired: purged, failed: failures.length };
}

/** Job-family API: root orchestration should invoke this on a bounded cadence. */
export async function processAccountExports() {
  const admin = createAdminClient() as unknown as UntypedAdmin;
  const claimed = await admin.rpc("claim_remediation_jobs", { p_kind: "account_export", p_limit: 1 });
  if (claimed.error) throw new Error("Account export queue unavailable");
  let completed = 0;
  let continued = 0;
  for (const job of (claimed.data ?? []) as unknown as ExportJob[]) {
    let failure: string | undefined;
    try {
      const heartbeat = jobHeartbeat(admin, job);
      const requestResult = await admin.from("account_export_requests").select("*").eq("id", job.payload.request_id).eq("user_id", job.payload.user_id).single();
      if (requestResult.error) throw new Error("Account export request is missing");
      const request = {...requestResult.data, job} as ExportRequest;
      if (request.contract_version !== ACCOUNT_EXPORT_CONTRACT_VERSION && request.status !== "completed") {
        await purgeExportRequest(admin, request.id);
        await admin.rpc("finish_remediation_job", {p_id:job.id,p_lease:job.lease_id}).throwOnError();
        continue;
      }
      if (request.status === "completed") {
        await admin.rpc("finish_remediation_job", {p_id:job.id,p_lease:job.lease_id}).throwOnError();
        continue;
      }
      if (request.status === "expired" || new Date(request.expires_at).getTime() <= Date.now()) {
        await purgeExportRequest(admin, request.id);
        await admin.rpc("finish_remediation_job", {p_id:job.id,p_lease:job.lease_id}).throwOnError();
        continue;
      }
      await admin.rpc("write_account_export", {p_job:job.id,p_lease:job.lease_id,p_request:request.id,p_checkpoint:{section:request.current_section,offset:request.current_offset,cursor:request.current_cursor}}).throwOnError();
      const deadline = Date.now() + 25_000;
      let pages = 0;
      while (request.current_section < ACCOUNT_EXPORT_SECTIONS.length && pages < 8 && Date.now() < deadline) {
        await heartbeat();
        const section = ACCOUNT_EXPORT_SECTIONS[request.current_section];
        const rows = await readPage(admin, request, section);
        const page = Math.floor(request.current_offset / exportPageSize(section));
        // Photos are copied before their listing is written, so a published
        // listing never names a part that isn't in the package.
        const listedRows = isMessagePhotoSection(section) ? await copyMessagePhotos(admin, request, rows, heartbeat) : rows;
        const exportedRows = listedRows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith("__cursor_"))));
        const bytes = new TextEncoder().encode(JSON.stringify({ section: section.key, page, rows: exportedRows }));
        await persistPart(admin, request, section.key, page, bytes, rows.length);
        if (section.key === "dispute_evidence") await copyEvidenceAssets(admin, request, rows);
        const next = nextExportCheckpoint(section, { section: request.current_section, offset: request.current_offset, cursor: request.current_cursor }, rows);
        request.current_section = next.section;
        request.current_offset = next.offset;
        request.current_cursor = next.cursor;
        const checkpoint = await admin.rpc("write_account_export", {p_job:job.id,p_lease:job.lease_id,p_request:request.id,p_checkpoint:next});
        if (checkpoint.error) throw new Error("Could not advance export checkpoint");
        pages++;
      }
      if (request.current_section < ACCOUNT_EXPORT_SECTIONS.length) {
        await admin.rpc("continue_account_export", { p_job: job.id, p_lease: job.lease_id }).throwOnError();
        continued++;
        continue;
      }
      await completeExport(admin, request);
      completed++;
    } catch (error) {
      failure = error instanceof Error ? error.message : "Account export failed";
      await admin.rpc("write_account_export", {p_job:job.id,p_lease:job.lease_id,p_request:job.payload.request_id,p_error:failure.slice(0,500)});
      reportError("[account-export] retry required", { requestId: job.payload.request_id, error: failure });
    }
    const done = await admin.rpc("finish_remediation_job", { p_id: job.id, p_lease: job.lease_id, p_error: failure });
    if (done.error) throw new Error("Account export acknowledgement failed");
    if (failure) throw new Error(failure);
  }
  return { completed, continued };
}
