import { admin } from "./environment";
import { expect, it } from "vitest";
import { processAccountDeletions } from "@/lib/account-deletion-worker";
import { mapBounded } from "@/lib/map-bounded";
it("checkpoints a nested account across bounded deletion runs before removing Auth", async () => {
  const created = await admin.auth.admin.createUser({ email: `deletion-${crypto.randomUUID()}@example.test`, email_confirm: true });
  if (created.error) throw created.error;
  const uid = created.data.user.id;
  const paths = Array.from({ length: 160 }, (_, i) => `${uid}/nested/${String(i).padStart(4, "0")}.png`);
  let jobId = "";
  try {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    await mapBounded(paths, 4, async path => { const uploaded = await admin.storage.from("avatars").upload(path, png, { contentType: "image/png" }); if (uploaded.error) throw uploaded.error; });
    const job = await admin.from("remediation_jobs").insert({ kind: "delete_account", dedup_key: `delete:${uid}`, payload: { user_id: uid }, next_attempt_at: "2000-01-01" }).select("id").single().throwOnError(); jobId = job.data.id;
    await admin.from("account_deletion_requests").insert({user_id:uid,job_id:jobId,outcome:"cleanup_pending",next_action:"Automated cleanup is in progress."}).throwOnError();
    const first = await processAccountDeletions(); expect(first).toHaveProperty("continued", 1);
    expect((await admin.auth.admin.getUserById(uid)).data.user).not.toBeNull();
    const checkpoint = await admin.from("deletion_storage_tasks").select("path", { count: "exact" }).eq("job_id", jobId).eq("status", "deleted").throwOnError(); expect(checkpoint.count).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) {
      const next = await processAccountDeletions(); if (next.completed) break;
    }
    expect((await admin.auth.admin.getUserById(uid)).error?.status).toBe(404);
    const completed = await admin.from("remediation_jobs").select("status").eq("id", jobId).single().throwOnError(); expect(completed.data.status).toBe("completed");
    const storage = await admin.storage.from("avatars").list(`${uid}/nested`); if (storage.error) throw storage.error; expect(storage.data).toHaveLength(0);
  } finally {
    const removed = await admin.storage.from("avatars").remove(paths); if (removed.error) throw removed.error;
    if (jobId) await admin.from("remediation_jobs").delete().eq("id", jobId).throwOnError();
    const deleted = await admin.auth.admin.deleteUser(uid); if (deleted.error && deleted.error.status !== 404) throw deleted.error;
    await admin.from("remediation_jobs").delete().eq("kind", "search").eq("payload->>id", uid).throwOnError();
  }
});
