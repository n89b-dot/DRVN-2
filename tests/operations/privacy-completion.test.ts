import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";

import { processAccountDeletions } from "@/lib/account-deletion-worker";
import { processAccountExports, purgeAccountExportsForUser } from "@/lib/account-export-worker";
import { ACCOUNT_EXPORT_CONTRACT_VERSION } from "@/lib/account-export-contract";
import type { Database } from "@/lib/database.types";
import { admin } from "./environment";

it("exports paginated personal data without cross-account access and expires it before deletion", async () => {
  const password = `Privacy-${crypto.randomUUID()}!`;
  const owner = await admin.auth.admin.createUser({ email: `privacy-owner-${crypto.randomUUID()}@drvn.test`, password, email_confirm: true });
  const other = await admin.auth.admin.createUser({ email: `privacy-other-${crypto.randomUUID()}@drvn.test`, password, email_confirm: true });
  if (owner.error || other.error) throw owner.error ?? other.error;
  const ownerId = owner.data.user.id, otherId = other.data.user.id;
  const member = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const stranger = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const cars = await admin.from("cars").insert([
      { owner_id: ownerId, slug: `privacy-${crypto.randomUUID()}`, name: "Owner private car", is_public: false },
      { owner_id: otherId, slug: `privacy-${crypto.randomUUID()}`, name: "Other public car", is_public: true },
    ]).select("id,owner_id").throwOnError();
    const ownerCar = cars.data.find(car => car.owner_id === ownerId)!.id;
    const otherCar = cars.data.find(car => car.owner_id === otherId)!.id;
    await admin.from("car_images").insert([
      ...Array.from({ length: 501 }, (_, index) => ({ car_id: ownerCar, url: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/car-images/${ownerId}/${index}.webp`, position: index })),
      { car_id: otherCar, url: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/car-images/${otherId}/private.webp`, position: 0 },
    ]).throwOnError();

    await member.auth.signInWithPassword({ email: owner.data.user.email!, password }).then(({ error }) => { if (error) throw error; });
    await stranger.auth.signInWithPassword({ email: other.data.user.email!, password }).then(({ error }) => { if (error) throw error; });
    const requested = await member.rpc("request_account_export").throwOnError();
    const exportId = requested.data;
    expect((await admin.from("account_export_requests").select("contract_version").eq("id", exportId).single().throwOnError()).data.contract_version).toBe(ACCOUNT_EXPORT_CONTRACT_VERSION);
    await admin.from("remediation_jobs").update({ next_attempt_at: "1900-01-01" }).eq("dedup_key", `export:${exportId}`).throwOnError();
    let exportStatus = "pending";
    for (let run = 0; run < 12 && exportStatus !== "completed"; run++) {
      await processAccountExports();
      exportStatus = (await admin.from("account_export_requests").select("status").eq("id", exportId).single().throwOnError()).data.status;
    }
    expect(exportStatus).toBe("completed");
    const parts = await admin.from("account_export_parts").select("section_key,object_path,row_count").eq("request_id", exportId).order("page_number").throwOnError();
    const imageParts = parts.data.filter(part => part.section_key === "car_images");
    expect(imageParts.reduce((total, part) => total + part.row_count, 0)).toBe(501);
    const exportedRows: Array<{ car_id: string }> = [];
    for (const part of imageParts) {
      const object = await admin.storage.from("account-exports").download(part.object_path); if (object.error) throw object.error;
      exportedRows.push(...(JSON.parse(await object.data.text()) as { rows: Array<{ car_id: string }> }).rows);
    }
    expect(exportedRows).toHaveLength(501);
    expect(exportedRows.every(row => row.car_id === ownerCar)).toBe(true);
    expect(JSON.stringify(exportedRows)).not.toContain(otherId);

    const foreignRequest = await stranger.from("account_export_requests").select("id").eq("id", exportId);
    expect(foreignRequest.error).toBeNull(); expect(foreignRequest.data).toEqual([]);
    expect((await stranger.storage.from("account-exports").createSignedUrl(imageParts[0].object_path, 60)).error).not.toBeNull();

    const deletion = await member.rpc("request_account_deletion").throwOnError();
    expect((deletion.data as { outcome: string }).outcome).toBe("cleanup_pending");
    expect((await admin.from("account_export_requests").select("status").eq("id", exportId).single().throwOnError()).data.status).toBe("expired");
    const deletionJob = (deletion.data as { job_id: string }).job_id;
    const deletionRequestId = (await admin.from("account_deletion_requests").select("id").eq("job_id", deletionJob).single().throwOnError()).data.id;
    await admin.from("remediation_jobs").update({ next_attempt_at: "1900-01-01" }).eq("id", deletionJob).throwOnError();
    let outcome = "cleanup_pending";
    for (let run = 0; run < 12 && outcome !== "completed"; run++) {
      await processAccountDeletions();
      outcome = (await admin.from("account_deletion_requests").select("outcome").eq("id", deletionRequestId).single().throwOnError()).data.outcome;
    }
    expect(outcome).toBe("completed");
    expect((await admin.auth.admin.getUserById(ownerId)).data.user).toBeNull();
  } finally {
    await purgeAccountExportsForUser(ownerId).catch(() => undefined);
    await admin.auth.admin.deleteUser(ownerId);
    await admin.auth.admin.deleteUser(otherId);
  }
}, 120_000);

it("expires an unfinished v1 checkpoint instead of resuming it under the v2 section layout", async () => {
  const created = await admin.auth.admin.createUser({ email: `privacy-v1-${crypto.randomUUID()}@drvn.test`, email_confirm: true });
  if (created.error) throw created.error;
  const userId = created.data.user.id;
  try {
    const request = await admin.from("account_export_requests").insert({
      user_id: userId,
      contract_version: "2026-09-05.v1",
      status: "processing",
      current_section: 20,
      current_offset: 250,
      current_cursor: crypto.randomUUID(),
    }).select("id").single().throwOnError();
    const job = await admin.from("remediation_jobs").insert({
      kind: "account_export",
      dedup_key: `export:${request.data.id}`,
      payload: { request_id: request.data.id, user_id: userId },
      next_attempt_at: "1900-01-01",
    }).select("id").single().throwOnError();

    await processAccountExports();

    expect((await admin.from("account_export_requests").select("status").eq("id", request.data.id).single().throwOnError()).data.status).toBe("expired");
    expect((await admin.from("remediation_jobs").select("status").eq("id", job.data.id).single().throwOnError()).data.status).toBe("completed");
  } finally {
    await purgeAccountExportsForUser(userId).catch(() => undefined);
    await admin.auth.admin.deleteUser(userId);
  }
}, 30_000);
