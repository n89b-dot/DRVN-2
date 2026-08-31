import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { PageHead } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

import { RedeemPickupForm } from "../pickup-controls";

export const metadata = { title: "Confirm pickup - DRVN" };

/**
 * The QR landing (0054): the buyer's Pickup Pass encodes
 * /orders/<id>/pickup?token=… — the seller scans it with their phone, signs
 * in if needed, and confirms the handoff. The token is single-use and only
 * ever compared as a hash server-side; this page never validates it itself.
 */
export default async function PickupRedeemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ id }, { token }] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/orders/${id}/pickup${token ? `?token=${token}` : ""}`)}`);

  // RLS scopes orders to participants; only the seller confirms a handoff.
  const { data: order } = await supabase
    .from("orders")
    .select("id, seller_id, status, is_collection, pickup_ready_at")
    .eq("id", id)
    .maybeSingle();
  if (!order || order.seller_id !== user.id) notFound();

  return (
    <div className="mx-auto w-full max-w-[480px] px-5 pb-10">
      <PageHead
        className="pagehead--task"
        eyebrow={
          <>
            <Link href={`/orders/${id}`} className="jumplink">
              Order {id.slice(0, 8).toUpperCase()}
            </Link>{" "}
            / pickup
          </>
        }
        title={
          <>
            Hand it <span className="live-word">over.</span>
          </>
        }
      />

      <Rv className="tile">
        {order.status === "delivered" || order.status === "completed" ? (
          <p className="spec-note">This pickup is already confirmed — all done.</p>
        ) : !order.is_collection || order.status !== "paid" ? (
          <p className="spec-note">This order isn&apos;t waiting for a pickup handoff.</p>
        ) : (
          <RedeemPickupForm orderId={id} initialToken={token} />
        )}
      </Rv>
    </div>
  );
}
