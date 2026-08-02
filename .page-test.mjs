import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>[l.slice(0,l.indexOf("=")),l.slice(l.indexOf("=")+1).trim()]));
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const { data, error } = await supa.auth.signInWithPassword({ email: "console-admin@drvn.test", password: "console-admin-e2e-123" });
if (error) { console.error("signin failed", error.message); process.exit(1); }
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(data.session)).toString("base64url")}`;
const checks = [
  ["/admin/orders/67024ae4-3b67-4e45-8136-681d50a1ce0c", ["Add note", "Message parties", "← Orders"]],
  ["/admin/users/452d907b-2173-441a-bea6-49a4f1ac6434", ["Add note", "Admin actions on this user"]],
  ["/admin/listings", ["preview", "Export"]],
  ["/admin/reports", ["Reports"]],
  ["/admin/audit", ["Export CSV", "type=\"date\""]],
];
for (const [path, needles] of checks) {
  const res = await fetch(`http://localhost:3005${path}`, { headers: { cookie } });
  const html = await res.text();
  const found = needles.map(n => `${n}:${html.includes(n) ? "YES" : "NO"}`).join(" ");
  console.log(res.status, path, "→", found);
}
