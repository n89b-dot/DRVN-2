import { admin } from "./environment";
import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
it("normalizes historical metadata, remaps a reference and safely resumes its manifest", async () => {
  const created = await admin.auth.admin.createUser({ email: `media-${crypto.randomUUID()}@example.test`, email_confirm: true });
  if (created.error) throw created.error;
  const uid = created.data.user.id, path = `${uid}/historical.jpg`;
  const folder = mkdtempSync(join(tmpdir(), "drvn-media-")), manifest = join(folder, "manifest.json");
  let derivative = "";
  try {
    const original = await sharp({ create: { width: 40, height: 20, channels: 3, background: "red" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const uploaded = await admin.storage.from("avatars").upload(path, original, { contentType: "image/jpeg" }); if (uploaded.error) throw uploaded.error;
    const url = admin.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    await admin.from("profiles").update({ avatar_url: url }).eq("id", uid).throwOnError();
    writeFileSync(manifest, JSON.stringify({ project: process.env.NEXT_PUBLIC_SUPABASE_URL, objects: [{ bucket: "avatars", path, status: "pending" }] }), { mode: 0o600 });
    const env = { ...process.env, DRVN_MEDIA_PROJECT_URL: process.env.NEXT_PUBLIC_SUPABASE_URL };
    execFileSync(process.execPath, ["scripts/public-media-backfill.mjs", "apply", manifest], { env, stdio: "pipe" });
    const result = JSON.parse(readFileSync(manifest, "utf8"));
    expect(result.objects[0].status).toBe("remapped"); derivative = result.objects[0].derivative;
    const downloaded = await admin.storage.from("avatars").download(derivative); if (downloaded.error) throw downloaded.error;
    const metadata = await sharp(Buffer.from(await downloaded.data.arrayBuffer())).metadata();
    expect(metadata.exif).toBeUndefined(); expect(metadata.icc).toBeUndefined(); expect(metadata.width).toBe(20); expect(metadata.height).toBe(40);
    const profile = await admin.from("profiles").select("avatar_url").eq("id", uid).single().throwOnError(); expect(profile.data.avatar_url).toContain(derivative);
    const before = readFileSync(manifest, "utf8");
    execFileSync(process.execPath, ["scripts/public-media-backfill.mjs", "apply", manifest], { env, stdio: "pipe" });
    expect(readFileSync(manifest, "utf8")).toBe(before);
    expect((await admin.storage.from("avatars").download(path)).error).toBeNull();
  } finally {
    await admin.from("profiles").update({ avatar_url: null }).eq("id", uid).throwOnError();
    const removed = await admin.storage.from("avatars").remove([path, derivative].filter(Boolean)); if (removed.error) throw removed.error;
    const deleted = await admin.auth.admin.deleteUser(uid); if (deleted.error) throw deleted.error;
    rmSync(folder, { recursive: true, force: true });
  }
});
