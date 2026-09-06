import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";

import type { Database } from "@/lib/database.types";
import { admin } from "./environment";

it("persists own read receipts and keeps mark-all scoped to the signed-in member", async () => {
  const password = `Notice-${crypto.randomUUID()}!`;
  const ownerResult = await admin.auth.admin.createUser({ email: `notice-owner-${crypto.randomUUID()}@drvn.test`, password, email_confirm: true });
  const otherResult = await admin.auth.admin.createUser({ email: `notice-other-${crypto.randomUUID()}@drvn.test`, password, email_confirm: true });
  if (ownerResult.error || otherResult.error) throw ownerResult.error ?? otherResult.error;
  const ownerId = ownerResult.data.user.id;
  const otherId = otherResult.data.user.id;
  try {
    const inserted = await admin.from("notifications").insert([
      { user_id: ownerId, kind: "follow", section: "engagement", title: "Owner one" },
      { user_id: ownerId, kind: "save", section: "engagement", title: "Owner two" },
      { user_id: otherId, kind: "follow", section: "engagement", title: "Other" },
    ]).select("id,user_id").throwOnError();
    const ownerNotice = inserted.data.find((row) => row.user_id === ownerId)!.id;
    const otherNotice = inserted.data.find((row) => row.user_id === otherId)!.id;
    const owner = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const stranger = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    await owner.auth.signInWithPassword({ email: ownerResult.data.user.email!, password }).then(({ error }) => { if (error) throw error; });
    await stranger.auth.signInWithPassword({ email: otherResult.data.user.email!, password }).then(({ error }) => { if (error) throw error; });

    const marked = await owner.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", ownerNotice).eq("user_id", ownerId).select("id").maybeSingle();
    expect(marked.error).toBeNull();
    expect(marked.data?.id).toBe(ownerNotice);
    expect((await admin.from("notifications").select("read_at").eq("id", ownerNotice).single().throwOnError()).data.read_at).not.toBeNull();

    const foreign = await stranger.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", ownerNotice).select("id");
    expect(foreign.error).toBeNull();
    expect(foreign.data).toEqual([]);

    await owner.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", ownerId).is("read_at", null).select("id").throwOnError();
    expect((await admin.from("notifications").select("id").eq("user_id", ownerId).is("read_at", null)).data).toEqual([]);
    expect((await admin.from("notifications").select("read_at").eq("id", otherNotice).single().throwOnError()).data.read_at).toBeNull();
  } finally {
    await admin.auth.admin.deleteUser(ownerId);
    await admin.auth.admin.deleteUser(otherId);
  }
}, 30_000);
