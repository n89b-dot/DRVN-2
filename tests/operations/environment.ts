import { readFileSync } from "node:fs";
import type { Database } from "@/lib/database.types";
import { createClient } from "@supabase/supabase-js";
try {
  for (const line of readFileSync(".env.test.local", "utf8").split("\n")) {
    const match = /^([A-Z_0-9]+)=(.*)$/.exec(line);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
} catch { /* Explicit CI environment only. */ }
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:54321" || process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation") throw new Error("Operational drills require the isolated loopback stack");
export const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
export const anon = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
