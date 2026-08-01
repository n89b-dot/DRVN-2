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

  const take = async <T>(query: PromiseLike<{ data: T; error: unknown }>, label: string) => {
    const { data, error } = await query;
    if (error) reportError("[export] section failed", { label, error });
    return data ?? null;
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
    take(supabase.from("cars").select("*").eq("owner_id", user.id), "cars"),
    take(supabase.from("listings").select("*").eq("seller_id", user.id), "listings"),
    take(supabase.from("orders").select("*").eq("buyer_id", user.id), "orders bought"),
    take(supabase.from("orders").select("*").eq("seller_id", user.id), "orders sold"),
    take(supabase.from("offers").select("*").eq("buyer_id", user.id), "offers"),
    take(supabase.from("messages").select("*").eq("sender_id", user.id), "messages"),
    take(supabase.from("saves").select("*").eq("user_id", user.id), "saved"),
    take(supabase.from("follows").select("*").eq("follower_id", user.id), "follows"),
    take(supabase.from("notifications").select("*").eq("user_id", user.id), "notifications"),
    take(supabase.from("reviews").select("*").eq("reviewer_id", user.id), "reviews"),
    take(supabase.from("activity_posts").select("*").eq("author_id", user.id), "activity posts"),
    take(
      supabase.from("mod_items").select("*, cars!inner(owner_id)").eq("cars.owner_id", user.id),
      "mod items"
    ),
  ]);

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
