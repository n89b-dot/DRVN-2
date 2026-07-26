import Link from "next/link";

import { SectionLabel } from "@/components/ui";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { createClient } from "@/lib/supabase/server";

import { SellForm } from "./sell-form";
import { setListingStatus } from "./actions";

export const metadata = { title: "Sell a part - DRVN" };

export default async function SellPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: cars }, { data: myListings }] = await Promise.all([
    supabase.from("cars").select("id, name").eq("owner_id", user!.id).order("created_at"),
    supabase
      .from("listings")
      .select("id, title, price_cents, status")
      .eq("seller_id", user!.id)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="mx-auto w-full max-w-[720px] px-5 py-10 md:py-14">
      <SectionLabel>Sell</SectionLabel>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">List a part</h1>
      <p className="mt-2 text-sm text-text-muted">
        One form, under three minutes. Photos sell parts — add good ones.
      </p>

      <div className="mt-8">
        <SellForm cars={cars ?? []} userId={user!.id} />
      </div>

      {(myListings ?? []).length > 0 && (
        <div className="mt-12">
          <SectionLabel>Your listings</SectionLabel>
          <div className="mt-3 flex flex-col gap-2">
            {(myListings ?? []).map((listing) => (
              <div
                key={listing.id}
                className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-3"
              >
                <Link
                  href={`/listings/${listing.id}`}
                  className="min-w-0 flex-1 truncate text-sm text-text-primary transition hover:text-accent"
                >
                  {listing.title}
                </Link>
                <span className="text-sm font-semibold text-text-primary">
                  {formatPrice(listing.price_cents)}
                </span>
                <span
                  className={`rounded-pill px-2.5 py-0.5 text-[11px] font-semibold ${
                    listing.status === "active"
                      ? "bg-success/15 text-success"
                      : "bg-raised text-text-muted"
                  }`}
                >
                  {listing.status}
                </span>
                <form action={setListingStatus}>
                  <input type="hidden" name="id" value={listing.id} />
                  <input
                    type="hidden"
                    name="status"
                    value={listing.status === "active" ? "sold" : "active"}
                  />
                  <button
                    type="submit"
                    className="text-xs text-text-muted transition hover:text-text-primary"
                  >
                    {listing.status === "active" ? "Mark sold" : "Relist"}
                  </button>
                </form>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
