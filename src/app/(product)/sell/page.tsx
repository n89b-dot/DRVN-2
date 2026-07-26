import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { Foot } from "@/components/ui";
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
    <div className="mx-auto w-full max-w-[860px] px-5 pb-10">
      <Rv as="header" className="pagehead">
        <span className="microlabel">Part sheet — draft · not yet public</span>
        <h1>
          Draw a new <span className="live-word">line.</span>
        </h1>
        <p className="sub">
          Fill the sheet and the listing draws itself. Nothing reaches the market until you
          publish it.
        </p>
      </Rv>

      <SellForm cars={cars ?? []} userId={user!.id} />

      {(myListings ?? []).length > 0 && (
        <section className="deck mt-10">
          <div className="tile">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">Your lines on the market</span>
              <span className="chip">{(myListings ?? []).length}</span>
            </div>
            <div className="rowlist">
              {(myListings ?? []).map((listing) => (
                <div key={listing.id} className="order">
                  <span className="min-w-0">
                    <Link
                      href={`/listings/${listing.id}`}
                      className="order__name block truncate transition-colors hover:text-live"
                    >
                      {listing.title}
                    </Link>
                    <span className="order__meta block">{formatPrice(listing.price_cents)}</span>
                  </span>
                  <span className="order__actions">
                    <span className={`chip ${listing.status === "active" ? "chip--live" : "chip--spent"}`}>
                      {listing.status === "active" ? "Live" : listing.status}
                    </span>
                    <form action={setListingStatus}>
                      <input type="hidden" name="id" value={listing.id} />
                      <input
                        type="hidden"
                        name="status"
                        value={listing.status === "active" ? "sold" : "active"}
                      />
                      <button type="submit" className="relbtn !static">
                        {listing.status === "active" ? "Mark sold" : "Relist"}
                      </button>
                    </form>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <Foot
        left="DRVN / Livesheet — nothing public until you publish"
        right={<Link href="/marketplace">← Back to the market</Link>}
      />
    </div>
  );
}
