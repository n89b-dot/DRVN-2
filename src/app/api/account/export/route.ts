import { reportError } from "@/lib/monitoring";
import { createClient } from "@/lib/supabase/server";

/**
 * GDPR data export (Rev D R4) — the access/portability right the privacy
 * policy promises. One JSON download of everything the member can already
 * see about themselves.
 *
 * Deliberately runs on the RLS-enforcing client, not the admin client: the
 * export can only ever contain rows the signed-in user is permitted to read,
 * so a bug here cannot leak anyone else's data. Counterparty rows (orders,
 * messages) appear exactly as the product already shows them.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in to export your data.", { status: 401 });

  const failures: string[] = [];
  const take = async <T>(query: PromiseLike<{ data: T; error: unknown }>, label: string) => {
    const { data, error } = await query;
    if (error) { failures.push(label); reportError("[export] section failed", { label, error }); }
    return data ?? null;
  };

  const pages = async <T>(query: { range(from: number, to: number): PromiseLike<{ data: T[] | null; error: unknown }> }, label: string) => {
    const rows: T[] = [];
    for (let offset = 0; offset < 100_000; offset += 500) {
      const { data, error } = await query.range(offset, offset + 499);
      if (error) { failures.push(label); reportError("[export] section failed", { label, error }); return null; }
      rows.push(...(data ?? []));
      if (!data || data.length < 500) return rows;
    }
    failures.push(`${label}: export exceeds synchronous capacity`);
    return null;
  };

  const [
    profile,
    cars,
    listings,
    ordersBought,
    ordersSold,
    offers,
    messages,
    saved,
    follows,
    notifications,
    reviews,
    activityPosts,
    modItems,
  ] = await Promise.all([
    take(
      supabase
        .from("profiles")
        .select(
          "id, username, display_name, headline, bio, location, links, notification_prefs, profile_type, created_at, updated_at"
        )
        .eq("id", user.id)
        .maybeSingle(),
      "profile"
    ),
    pages(supabase.from("cars").select("*").order("id").eq("owner_id", user.id), "cars"),
    pages(supabase.from("listings").select("*").order("id").eq("seller_id", user.id), "listings"),
    pages(supabase.from("orders").select("*").order("id").eq("buyer_id", user.id), "orders bought"),
    pages(supabase.from("orders").select("*").order("id").eq("seller_id", user.id), "orders sold"),
    pages(supabase.from("offers").select("*").order("id").eq("buyer_id", user.id), "offers"),
    pages(supabase.from("messages").select("*").order("id").eq("sender_id", user.id), "messages"),
    pages(supabase.from("saves").select("*").order("target_type").order("target_id").eq("user_id", user.id), "saved"),
    pages(supabase.from("follows").select("*").order("target_type").order("target_id").eq("follower_id", user.id), "follows"),
    pages(supabase.from("notifications").select("*").order("id").eq("user_id", user.id), "notifications"),
    pages(supabase.from("reviews").select("*").order("id").eq("reviewer_id", user.id), "reviews"),
    pages(supabase.from("activity_posts").select("*").order("id").eq("author_id", user.id), "activity posts"),
    pages(
      supabase.from("mod_items").select("*, cars!inner(owner_id)").order("id").eq("cars.owner_id", user.id),
      "mod items"
    ),
  ]);

  if (failures.length) return Response.json({ error: "Your export could not be completed. Please retry or contact support.", failed_sections: failures }, { status: 503, headers: { "Cache-Control": "no-store" } });

  const body = JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      account: { id: user.id, email: user.email, created_at: user.created_at },
      profile,
      cars,
      listings,
      orders: { bought: ordersBought, sold: ordersSold },
      offers,
      messages_sent: messages,
      saved,
      follows,
      notifications,
      reviews,
      activity_posts: activityPosts,
      mod_items: modItems,
      note: "Rows involving another member appear exactly as the product shows them to you. Stripe holds payment credentials; DRVN stores only references.",
    },
    null,
    2
  );

  return new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="drvn-export-${user.id.slice(0, 8)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
