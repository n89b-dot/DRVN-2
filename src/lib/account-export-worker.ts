import { allRows } from "./account-export-pagination";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import "server-only";

import {
  ACCOUNT_EXPORT_CONTRACT_VERSION,
  ACCOUNT_EXPORT_EXCLUSIONS,
  ACCOUNT_EXPORT_PAGE_SIZE,
  ACCOUNT_EXPORT_SECTIONS,
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
};
type UntypedAdmin = SupabaseClient;

const BUCKET = "account-exports";

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function ids(admin: UntypedAdmin, table: string, field: string, filter: string, userId: string) {
  return (await allRows(admin.from(table).select(field).eq(filter, userId).order(field))).map(row => row[field]);
}

type RelatedIds = { field: string; values: string[] } | null;

async function authorizedIds(admin: UntypedAdmin, section: ExportSection, userId: string): Promise<RelatedIds> {
  switch (section.key) {
    case "car_images": case "car_hotspots": case "mod_items":
      return { field: "car_id", values: await ids(admin, "cars", "id", "owner_id", userId) };
    case "activity_images":
      return { field: "post_id", values: await ids(admin, "activity_posts", "id", "author_id", userId) };
    case "listing_images": case "listing_fitments": case "listing_part_numbers": case "offers_received":
      return { field: "listing_id", values: await ids(admin, "listings", "id", "seller_id", userId) };
    case "order_items": case "payments": case "refunds": case "returns": case "dispute_evidence": case "shipments": case "pickup_confirmations": {
      const rows = await allRows(admin.from("orders").select("id").or(`buyer_id.eq.${userId},seller_id.eq.${userId}`).order("id"));
      return { field: "order_id", values: rows.map(row => row.id) };
    }
    case "order_snapshot_images": {
      const orderAccess: RelatedIds = await authorizedIds(admin, { ...section, key: "order_items" }, userId);
      if (!orderAccess?.values.length) return { field: "order_item_id", values: [] as string[] };
      const rows = await allRows(admin.from("order_items").select("id").in("order_id", orderAccess.values).order("id"));
      return { field: "order_item_id", values: rows.map(row => row.id) };
    }
    case "refund_adjustments": {
      const orderAccess: RelatedIds = await authorizedIds(admin, { ...section, key: "order_items" }, userId);
      if (!orderAccess?.values.length) return { field: "refund_operation_id", values: [] as string[] };
      const rows = await allRows(admin.from("refund_operations").select("id").in("order_id", orderAccess.values).order("id"));
      return { field: "refund_operation_id", values: rows.map(row => row.id) };
    }
    case "return_items": {
      const orderAccess: RelatedIds = await authorizedIds(admin, { ...section, key: "order_items" }, userId);
      if (!orderAccess?.values.length) return { field: "return_id", values: [] as string[] };
      const rows = await allRows(admin.from("returns").select("id").in("order_id", orderAccess.values).order("id"));
      return { field: "return_id", values: rows.map(row => row.id) };
    }
    case "shipment_items": case "shipment_events": {
      const orderAccess: RelatedIds = await authorizedIds(admin, { ...section, key: "order_items" }, userId);
      if (!orderAccess?.values.length) return { field: "shipment_id", values: [] as string[] };
      const rows = await allRows(admin.from("shipments").select("id").in("order_id", orderAccess.values).order("id"));
      return { field: "shipment_id", values: rows.map(row => row.id) };
    }
    default:
      return null;
  }
}

async function readPage(admin: UntypedAdmin, request: ExportRequest, section: ExportSection) {
  let query = admin.from(section.table).select(section.projection);
  const related = await authorizedIds(admin, section, request.user_id);
  if (related) {
    if (!related.values.length) return [];
    query = query.in(related.field, related.values);
  } else if (section.filter.includes("|")) {
    const [left, right] = section.filter.split("|");
    query = query.or(`${left}.eq.${request.user_id},${right}.eq.${request.user_id}`);
  } else {
    query = query.eq(section.filter, request.user_id);
  }
  if (section.cutoffColumn) query = query.lte(section.cutoffColumn, request.cutoff_at);
  if (section.cursor) {
    query = query.order(section.cursor);
    if (request.current_cursor) query = query.gt(section.cursor, request.current_cursor);
    query = query.limit(ACCOUNT_EXPORT_PAGE_SIZE);
  } else {
    query = query.order(section.cutoffColumn ?? section.filter.split("|")[0]);
    query = query.range(request.current_offset, request.current_offset + ACCOUNT_EXPORT_PAGE_SIZE - 1);
  }
  const result = await query;
  if (result.error) throw new Error(`Export section ${section.key} failed: ${result.error.message}`);
  return (result.data ?? []) as unknown as Record<string, unknown>[];
}

async function persistPart(admin: UntypedAdmin, request: ExportRequest, sectionKey: string, page: number, body: Uint8Array, rowCount: number, contentType = "application/json") {
  const objectPath = `${request.user_id}/${request.id}/${sectionKey}/${String(page).padStart(8, "0")}-${sha256(body)}`;
  const upload = await admin.storage.from(BUCKET).upload(objectPath, body, { contentType, upsert: true, cacheControl: "no-store" });
  if (upload.error) throw new Error(`Could not store export section ${sectionKey}`);
  const saved = await admin.rpc("write_account_export", {
    p_job: request.job.id, p_lease: request.job.lease_id, p_request: request.id,
    p_part: {section_key: sectionKey, page_number: page, object_path: objectPath,
      row_count: rowCount, byte_count: body.byteLength, sha256: sha256(body), content_type: contentType},
  });
  if (saved.error) throw new Error(`Could not checkpoint export section ${sectionKey}`);
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
    consistency: "Rows created after cutoff_at are excluded. Each deterministic section page is immutable once checkpointed; updates may reflect the section checkpoint time.",
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
  const request = await admin.from("account_export_requests").select("user_id").eq("id",requestId).single().throwOnError();
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
  await admin.from("account_export_requests").update({status:"expired", manifest:null, manifest_path:null}).eq("id", requestId).throwOnError();
}
export async function purgeAccountExportsForUser(userId: string) {
  const admin = createAdminClient() as unknown as UntypedAdmin;
  const requests = await allRows(admin.from("account_export_requests").select("id").eq("user_id", userId).order("id"));
  for (const request of requests) await purgeExportRequest(admin, request.id);
}

export async function purgeExpiredAccountExports() {
  const admin = createAdminClient() as unknown as UntypedAdmin;
  const expired = await admin.from("account_export_requests").select("id").neq("status", "expired").lte("expires_at", new Date().toISOString()).order("expires_at").limit(20);
  if (expired.error) throw new Error("Could not read expired account exports");
  // Expire only this package: a newer package for the same owner remains valid.
  for (const request of expired.data ?? []) await purgeExportRequest(admin, request.id);
  return { expired: expired.data?.length ?? 0 };
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
      if (request.status === "completed" || request.status === "expired") {
        await admin.rpc("finish_remediation_job", {p_id:job.id,p_lease:job.lease_id}).throwOnError();
        continue;
      }
      if (new Date(request.expires_at).getTime() <= Date.now()) throw new Error("Account export request expired before completion");
      await admin.rpc("write_account_export", {p_job:job.id,p_lease:job.lease_id,p_request:request.id,p_checkpoint:{section:request.current_section,offset:request.current_offset,cursor:request.current_cursor}}).throwOnError();
      const deadline = Date.now() + 25_000;
      let pages = 0;
      while (request.current_section < ACCOUNT_EXPORT_SECTIONS.length && pages < 8 && Date.now() < deadline) {
        await heartbeat();
        const section = ACCOUNT_EXPORT_SECTIONS[request.current_section];
        const rows = await readPage(admin, request, section);
        const page = Math.floor(request.current_offset / ACCOUNT_EXPORT_PAGE_SIZE);
        const bytes = new TextEncoder().encode(JSON.stringify({ section: section.key, page, rows }));
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
        await admin.rpc("continue_account_export" as never, { p_job: job.id, p_lease: job.lease_id } as never).throwOnError();
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
