import { AnalyticsConsent } from "./analytics-consent";
import { loadFulfillmentProfile } from "@/features/commerce/fulfillment";
import { COUNTRIES } from "@/lib/geo/countries";
import { getConnectAccountId } from "@/lib/payments/connect";
import { listSavedCards } from "@/lib/payments/customers";
import { getPaymentProvider, paymentsAreLive } from "@/lib/payments/provider";
import { integratedShippingEnabled } from "@/lib/shipping/provider";
import { createClient } from "@/lib/supabase/server";

import { logout } from "@/app/(auth)/actions";

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
      "username, display_name, headline, bio, location, country, region, store_note, links, notification_prefs, payouts_enabled, profile_type"
    )
    .eq("id", user!.id)
    .single();
  // `stripe_account_id` has no client select grant; asking for it in the
  // query above made the whole row come back null (blank profile form that
  // would save empty strings over the member's public profile). The pointer
  // is read server-side instead, like every other Connect check.
  const connectAccountId = await getConnectAccountId(user!.id).catch(() => null);
  // Never render the profile form over a row that failed to load: its
  // fields would seed as empty strings and Save would blank the profile.
  if (!profile) throw new Error("Settings could not load your profile.");
  // P-9: the floor has no client select grant — a buyer who could read it
  // would bid exactly it — so the owner asks through a function that can
  // only answer about themselves.
  const { data: offerFloorPct } = await supabase.rpc("my_default_offer_floor");

  const { data: shopProfile } = await supabase
    .from("shop_profiles")
    .select("verification_status, returns_accepted, return_window_days")
    .eq("profile_id", user!.id)
    .maybeSingle();

  const links = (Array.isArray(profile?.links) ? profile!.links : []) as ProfileLink[];
  const [savedCards, fulfillment] = await Promise.all([
    listSavedCards(user!.id).catch(() => []),
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
          hasAccount: Boolean(connectAccountId),
          payoutsEnabled: profile?.payouts_enabled ?? false,
        }}
        profile={{
          email: user?.email ?? "",
          username: profile?.username ?? "",
          display_name: profile?.display_name ?? "",
          headline: profile?.headline ?? "",
          bio: profile?.bio ?? "",
          location: profile?.location ?? "",
          country: profile?.country ?? null,
          region: profile?.region ?? null,
          default_offer_floor_pct: offerFloorPct ?? null,
          store_note: profile?.store_note ?? null,
          links,
          notification_prefs: profile?.notification_prefs ?? {},
        }}
        logout={logout}
        privacySection={<AnalyticsConsent />}
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
