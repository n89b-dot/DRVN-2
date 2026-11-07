import { redirect } from "next/navigation";

import { AgentChatPrivacy } from "./agent-chat-privacy";
import { AgentSection } from "./agent-section";
import { loadAnalyticsConsent } from "./analytics-consent";
import { AnalyticsConsentForm } from "./analytics-consent-form";
import { agentTabOpen } from "@/lib/agent/beta";
import { loadAgentMode } from "@/lib/agent/member-mode";
import { loadFulfillmentProfile } from "@/features/commerce/fulfillment";
import { COUNTRIES } from "@/lib/geo/countries";
import { getConnectAccountId } from "@/lib/payments/connect";
import { listSavedCards } from "@/lib/payments/customers";
import { getPaymentProvider, paymentsAreLive } from "@/lib/payments/provider";
import { integratedShippingEnabled } from "@/lib/shipping/provider";
import { getPageClient, getViewer } from "@/lib/supabase/page-context";
import { Alert } from "@/components/ui";

import { logout } from "@/app/(auth)/actions";

import { SettingsPanel } from "./settings-panel";
import { ShippingSection } from "./shipping-section";
import { ShopSection } from "./shop-section";

export const metadata = { title: "Settings - DRVN" };

type ProfileLink = { label: string; url: string };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ changed?: string }>;
}) {
  const supabase = await getPageClient();
  const user = await getViewer();
  if (!user) redirect("/login");
  const { changed } = await searchParams;

  // One parallel round. These used to run one after another (profile →
  // Connect → floor → shop → cards/fulfilment → consent), seven trips deep.
  const [
    { data: profile },
    connectAccountId,
    { data: offerFloorPct },
    { data: shopProfile },
    savedCards,
    fulfillment,
    analyticsEnabled,
    agentOpen,
    { count: agentChatMessages },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "username, display_name, headline, bio, location, country, region, store_note, links, notification_prefs, payouts_enabled, profile_type"
      )
      .eq("id", user.id)
      .single(),
    // `stripe_account_id` has no client select grant; asking for it in the
    // query above made the whole row come back null (blank profile form that
    // would save empty strings over the member's public profile). The pointer
    // is read server-side instead, like every other Connect check.
    // A failed read is "unavailable", not "no account" (R2-05).
    getConnectAccountId(user.id).catch(() => undefined),
    // P-9: the floor has no client select grant — a buyer who could read it
    // would bid exactly it — so the owner asks through a function that can
    // only answer about themselves.
    supabase.rpc("my_default_offer_floor"),
    supabase
      .from("shop_profiles")
      .select("verification_status, returns_accepted, return_window_days")
      .eq("profile_id", user.id)
      .maybeSingle(),
    listSavedCards(user.id).catch(() => []),
    loadFulfillmentProfile(user.id),
    loadAnalyticsConsent(supabase, user.id),
    agentTabOpen(),
    // N125: the stored agent chat, read as the member, for Clear chat under
    // Privacy — whatever the agent's mode or beta steps say.
    supabase.from("agent_messages").select("id", { count: "exact", head: true }).eq("owner_id", user.id),
  ]);
  // AG-7: the agent's mode and how many mandates are live, for the Agent
  // section — only while the Agent tab exists for members at all.
  const [agentMode, { count: agentRunning }] = agentOpen
    ? await Promise.all([
        loadAgentMode(user.id),
        supabase.from("agent_mandates").select("id", { count: "exact", head: true }).eq("owner_id", user.id).in("status", ["active", "paused"]),
      ])
    : ["act" as const, { count: 0 }];
  // Never render the profile form over a row that failed to load: its
  // fields would seed as empty strings and Save would blank the profile.
  if (!profile) throw new Error("Settings could not load your profile.");

  // Landing from an email-change link (/confirm, readiness 53). Both addresses
  // must confirm, so the notice says whether the change is done or still
  // waiting on the other link; the auth user is read only on this landing.
  const emailNotice = changed === "email" ? await emailChangeNotice(supabase) : null;

  const links = (Array.isArray(profile?.links) ? profile!.links : []) as ProfileLink[];

  return (
    // `--gutter` is the variable `.wrap` publishes so a full-bleed child can
    // cancel exactly the page padding rather than guessing at it. This column
    // is a hand-rolled wrapper rather than a `.wrap`, so it has to declare its
    // own — without it the section register scrolls with no bleed and stops
    // dead at the column edge, saying nothing about the sections to its right.
    <div className="mx-auto w-full max-w-[900px] px-6 pb-10 [--gutter:24px]">
      {emailNotice && (
        <Alert tone={emailNotice.done ? "ok" : "default"} title={emailNotice.title} role="status" className="mb-6">
          {emailNotice.body}
        </Alert>
      )}
      <SettingsPanel
        paymentsLive={paymentsAreLive()}
        savedCards={savedCards}
        connect={
          connectAccountId === undefined
            ? { stripeConfigured: getPaymentProvider().name === "stripe", unavailable: true }
            : {
                stripeConfigured: getPaymentProvider().name === "stripe",
                hasAccount: Boolean(connectAccountId),
                payoutsEnabled: profile?.payouts_enabled ?? false,
              }
        }
        profile={{
          email: user.email ?? "",
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
        privacySection={
          <div className="grid gap-6">
            <AnalyticsConsentForm initialEnabled={analyticsEnabled} />
            {agentChatMessages ? <AgentChatPrivacy messages={agentChatMessages} /> : null}
          </div>
        }
        agentSection={agentOpen ? <AgentSection initialMode={agentMode} running={agentRunning ?? 0} /> : undefined}
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

async function emailChangeNotice(
  supabase: Awaited<ReturnType<typeof getPageClient>>,
): Promise<{ done: boolean; title: string; body: string } | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  if (user.new_email) {
    return {
      done: false,
      title: "One link confirmed",
      body: `The change to ${user.new_email} completes once the link sent to the other address has been opened too.`,
    };
  }
  return {
    done: true,
    title: "Sign-in email updated",
    body: `You now sign in with ${user.email ?? "your new address"}.`,
  };
}
