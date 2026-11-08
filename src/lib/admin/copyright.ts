import "server-only";

import type { Database } from "@/lib/database.generated";
import { createAdminClient } from "@/lib/supabase/admin";

export type CopyrightNoticeRow = Database["public"]["Tables"]["copyright_notices"]["Row"];

export const COPYRIGHT_PAGE_SIZE = 25;

/**
 * Copyright notices for Admin → Copyright (R69-dmca): open ones oldest first
 * (each is a rights holder waiting), closed ones newest first.
 */
export async function getCopyrightNotices(
  scope: "open" | "closed",
  page = 0
): Promise<{ rows: CopyrightNoticeRow[]; total: number; hasMore: boolean }> {
  const from = Math.max(0, page) * COPYRIGHT_PAGE_SIZE;
  let query = createAdminClient()
    .from("copyright_notices")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: scope === "open" })
    .range(from, from + COPYRIGHT_PAGE_SIZE - 1);
  query = scope === "open" ? query.eq("status", "received") : query.neq("status", "received");
  const { data, count, error } = await query;
  if (error) throw new Error("Copyright notices unavailable");
  const total = count ?? 0;
  return { rows: data ?? [], total, hasMore: from + (data?.length ?? 0) < total };
}
