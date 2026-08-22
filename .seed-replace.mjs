/**
 * Replace seeded photos in place. The seed scripts upload to deterministic
 * storage paths, so re-uploading to the same path (upsert) swaps the image
 * without touching any row. Service key, because some rows belong to
 * accounts we can't sign in as.
 *
 * Usage: node .seed-replace.mjs <replacements.json>
 * JSON: [{ "bucket": "...", "path": "...", "file": "/abs/path.jpg" }, ...]
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync("./.env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

const items = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const { bucket, path, file } of items) {
  const { error } = await sb.storage
    .from(bucket)
    .upload(path, readFileSync(file), { contentType: "image/jpeg", upsert: true });
  console.log(error ? `FAIL ${bucket}/${path}: ${error.message}` : `ok   ${bucket}/${path}`);
}
