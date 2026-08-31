import { loadFulfillmentProfile } from "@/features/commerce/fulfillment";
import { COUNTRIES } from "@/lib/geo/countries";
import { listSavedCards } from "@/lib/payments/customers";
import { getSellerLedger } from "@/lib/payments/ledger";
import { getPaymentProvider, paymentsAreLive } from "@/lib/payments/provider";
import { integratedShippingEnabled } from "@/lib/shipping/provider";
import { createClient } from "@/lib/supabase/server";

import { logout } from "@/app/(auth)/actions";

import { PayoutsSection } from "./payouts-section";
import { SettingsPanel } from "./settings-panel";
import { ShippingSection } from "./shipping-section";
import { ShopSection } from "./shop-section";

export const metadata = { title: "Settings - DRVN" };

type ProfileLink = { label: string; url: string };

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "username, display_name, headline, bio, location, links, notification_prefs, stripe_account_id, payouts_enabled, profile_type"
    )
    .eq("id", user!.id)
    .single();

  const { data: shopProfile } = await supabase
    .from("shop_profiles")
    .select("verification_status, returns_accepted, return_window_days")
    .eq("profile_id", user!.id)
    .maybeSingle();

  const links = (Array.isArray(profile?.links) ? profile!.links : []) as ProfileLink[];
  const [savedCards, ledger, fulfillment] = await Promise.all([
    listSavedCards(user!.id).catch(() => []),
    getSellerLedger(supabase, user!.id),
    loadFulfillmentProfile(user!.id),
  ]);

  return (
    // `--gutter` is the variable `.wrap` publishes so a full-bleed child can
    // cancel exactly the page padding rather than guessing at it. This column
    // is a hand-rolled wrapper rather than a `.wrap`, so it has to declare its
    // own — without it the section register scrolls with no bleed and stops
    // dead at the column edge, saying nothing about the sections to its right.
    <div className="mx-auto w-full max-w-[900px] px-6 pb-10 [--gutter:24px]">
      <SettingsPanel
        paymentsLive={paymentsAreLive()}
        savedCards={savedCards}
        connect={{
          stripeConfigured: getPaymentProvider().name === "stripe",
          hasAccount: Boolean(profile?.stripe_account_id),
          payoutsEnabled: profile?.payouts_enabled ?? false,
        }}
        profile={{
          email: user?.email ?? "",
          username: profile?.username ?? "",
          display_name: profile?.display_name ?? "",
          headline: profile?.headline ?? "",
          bio: profile?.bio ?? "",
          location: profile?.location ?? "",
          links,
          notification_prefs: profile?.notification_prefs ?? {},
        }}
        logout={logout}
        payoutsSection={<PayoutsSection ledger={ledger} paymentsLive={paymentsAreLive()} />}
        shippingSection={
          <ShippingSection
            countries={COUNTRIES}
            integratedShipping={integratedShippingEnabled()}
            initial={
              fulfillment
                ? {
                    ship_from_name: fulfillment.ship_from_name,
                    company: fulfillment.company ?? "",
                    street1: fulfillment.street1,
                    street2: fulfillment.street2 ?? "",
                    city: fulfillment.city,
                    state: fulfillment.state ?? "",
                    postal_code: fulfillment.postal_code,
                    country: fulfillment.country,
                    phone: fulfillment.phone ?? "",
                    default_handling_days: fulfillment.default_handling_days,
                    verified: Boolean(fulfillment.address_verified_at),
                  }
                : null
            }
          />
        }
        shopSection={
          <ShopSection
            shop={{
              isShop: profile?.profile_type === "shop",
              verified: shopProfile?.verification_status === "verified",
              returnsAccepted: shopProfile?.returns_accepted ?? false,
              returnWindowDays: shopProfile?.return_window_days ?? 30,
            }}
          />
        }
      />
    </div>
  );
}
