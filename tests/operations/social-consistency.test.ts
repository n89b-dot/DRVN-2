import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";

import type { Database } from "@/lib/database.types";
import { admin } from "./environment";

it("makes repeated save, like, and follow requests converge and survive a fresh client", async () => {
  const password = `Social-${crypto.randomUUID()}!`;
  const memberResult = await admin.auth.admin.createUser({ email: `social-member-${crypto.randomUUID()}@drvn.test`, password, email_confirm: true });
  const targetResult = await admin.auth.admin.createUser({ email: `social-target-${crypto.randomUUID()}@drvn.test`, password, email_confirm: true });
  if (memberResult.error || targetResult.error) throw memberResult.error ?? targetResult.error;
  const memberId = memberResult.data.user.id;
  const targetId = targetResult.data.user.id;
  const member = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const car = await admin.from("cars").insert({ owner_id: targetId, slug: `social-${crypto.randomUUID()}`, name: "Social target", is_public: true }).select("id").single().throwOnError();
    await member.auth.signInWithPassword({ email: memberResult.data.user.email!, password }).then(({ error }) => { if (error) throw error; });
    for (const kind of ["save", "like", "follow"] as const) {
      const writes = await Promise.all([
        member.rpc("set_social_relationship", { p_kind: kind, p_target_type: "car", p_target_id: car.data.id, p_active: true }),
        member.rpc("set_social_relationship", { p_kind: kind, p_target_type: "car", p_target_id: car.data.id, p_active: true }),
      ]);
      expect(writes.every((result) => !result.error && result.data === true)).toBe(true);
    }

    const fresh = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    await fresh.auth.signInWithPassword({ email: memberResult.data.user.email!, password }).then(({ error }) => { if (error) throw error; });
    expect((await fresh.from("saves").select("target_id").eq("user_id", memberId).eq("target_type", "car").eq("target_id", car.data.id)).data).toHaveLength(1);
    expect((await fresh.from("likes").select("target_id").eq("user_id", memberId).eq("target_type", "car").eq("target_id", car.data.id)).data).toHaveLength(1);
    expect((await fresh.from("follows").select("target_id").eq("follower_id", memberId).eq("target_type", "car").eq("target_id", car.data.id)).data).toHaveLength(1);

    for (const kind of ["save", "like", "follow"] as const) {
      const removals = await Promise.all([
        member.rpc("set_social_relationship", { p_kind: kind, p_target_type: "car", p_target_id: car.data.id, p_active: false }),
        member.rpc("set_social_relationship", { p_kind: kind, p_target_type: "car", p_target_id: car.data.id, p_active: false }),
      ]);
      expect(removals.every((result) => !result.error && result.data === false)).toBe(true);
    }
    expect((await fresh.from("saves").select("target_id").eq("user_id", memberId).eq("target_id", car.data.id)).data).toEqual([]);
    expect((await fresh.from("likes").select("target_id").eq("user_id", memberId).eq("target_id", car.data.id)).data).toEqual([]);
    expect((await fresh.from("follows").select("target_id").eq("follower_id", memberId).eq("target_id", car.data.id)).data).toEqual([]);

    const invalid = await member.rpc("set_social_relationship", { p_kind: "follow", p_target_type: "listing", p_target_id: car.data.id, p_active: true });
    expect(invalid.error).not.toBeNull();
  } finally {
    await admin.auth.admin.deleteUser(memberId);
    await admin.auth.admin.deleteUser(targetId);
  }
}, 60_000);
