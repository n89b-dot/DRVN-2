import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { normalizeBlocks } from "@/lib/activity-blocks";
import { getPageClient, getViewer } from "@/lib/supabase/page-context";
import { BuildStoryComposer } from "@/features/composer/composer";
import type { TurnCard } from "@/lib/ai/run";
import { publishChatPhotos } from "@/lib/agent/chat-photos";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOwnedStorageUrl } from "@/lib/media-url";
import { loadTaggableParts } from "@/features/composer/taggable-parts";

import { createRichActivityPost, discardActivityDraft, saveActivityDraft } from "../../../actions";

export const metadata = { title: "New update - DRVN" };

export default async function NewUpdatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** `agent`: a "Post an update" draft from the member's agent chat (A3d). */
  searchParams: Promise<{ added?: string; removed?: string; photos?: string; agent?: string }>;
}) {
  const { id } = await params;
  const seeds = await searchParams;
  const supabase = await getPageClient();
  const user = await getViewer();
  if (!user) redirect("/login");

  const { data: car } = await supabase
    .from("cars")
    .select("id, name")
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();
  if (!car) notFound();

  // The car's draft, if one exists — the composer reopens it where you left
  // off. One draft per car: autosave overwrites, publishing converts.
  const [{ data: draft }, { data: modRows }, parts] = await Promise.all([
    supabase
      .from("activity_posts")
      .select("id, title, body, updated_at")
      .eq("car_id", car.id)
      .eq("author_id", user.id)
      .is("published_at", null)
      .is("draft_archived_at", null)
      .maybeSingle(),
    supabase
      .from("mod_items")
      .select("id, brand, product, raw_text, status")
      .eq("car_id", car.id)
      .order("position"),
    loadTaggableParts(supabase, user.id),
  ]);
  const draftBlocks = draft ? normalizeBlocks(draft.body) : null;
  const mods = (modRows ?? []).map((mod) => ({
    id: mod.id,
    // Parts that came off stay pickable and say so: an update is very often
    // *about* the part that just left the car.
    label:
      ([mod.brand, mod.product].filter(Boolean).join(" ") || mod.raw_text || "Build entry") +
      (mod.status === "removed" ? " — off the car" : ""),
  }));

  // Passive-affordance seeds (§W): "Create an update from these changes" /
  // "Share these in an update" prepopulate the composer — visibly, as normal
  // editable blocks, and only when there's no draft already in flight.
  const seededBlocks: import("@/lib/activity-blocks").ActivityBlock[] = [];
  let seededTitle = "";
  // A3d "Post an update": the agent's draft, read from the member's own chat,
  // for this car only. Its photos are the member's own uploads (checked
  // again when the post saves); its parts must be on this car. A draft
  // already in flight wins, as with every other seed.
  if (!draftBlocks?.length && seeds.agent && /^[0-9a-f-]{36}$/i.test(seeds.agent)) {
    const { data: messages } = await supabase
      .from("agent_messages")
      .select("cards")
      .eq("owner_id", user.id)
      .contains("cards", JSON.stringify([{ id: seeds.agent }]))
      .limit(1);
    const card = ((messages?.[0]?.cards ?? []) as TurnCard[]).find(
      (c): c is Extract<TurnCard, { kind: "update_draft" }> => c.kind === "update_draft" && c.id === seeds.agent,
    );
    if (card && card.car === car.id) {
      seededTitle = card.title.slice(0, 140);
      const onCar = new Map(mods.map((mod) => [mod.id, mod.label]));
      for (const modId of card.mods) {
        const label = onCar.get(modId);
        if (label) seededBlocks.push({ type: "mod", action: "installed", modItemId: modId, label });
      }
      // R81: the chat's photos are private; the update gets public copies,
      // made now, in the member's activity-images folder.
      const urls = (await publishChatPhotos(createAdminClient(), user.id, card.images, "activity-images")).filter((url) => isOwnedStorageUrl(url, user.id));
      if (urls.length) seededBlocks.push({ type: "images", urls });
      seededBlocks.push({ type: "text", style: "normal", text: card.body });
    }
  }
  if (!draftBlocks?.length && !seededBlocks.length) {
    const parseLabels = (raw?: string) =>
      (raw ?? "")
        .split("|")
        .map((label) => label.trim().slice(0, 80))
        .filter(Boolean)
        .slice(0, 3);
    const byLabel = new Map(mods.map((mod) => [mod.label, mod.id]));
    for (const label of parseLabels(seeds.added)) {
      seededBlocks.push({
        type: "mod",
        action: "installed",
        modItemId: byLabel.get(label) ?? null,
        label,
      });
    }
    for (const label of parseLabels(seeds.removed)) {
      seededBlocks.push({ type: "mod", action: "removed", modItemId: null, label });
    }
    const photoCount = Math.min(Number(seeds.photos) || 0, 12);
    if (photoCount >= 1) {
      const { data: latest } = await supabase
        .from("car_images")
        .select("url, created_at")
        .eq("car_id", car.id)
        .order("created_at", { ascending: false })
        .limit(photoCount);
      const urls = (latest ?? []).map((image) => image.url);
      if (urls.length) seededBlocks.push({ type: "images", urls });
    }
    if (seededBlocks.length) seededBlocks.push({ type: "text", style: "normal", text: "" });
  }

  return (
    <div className="mx-auto w-full max-w-[720px] px-5 pb-10">
      <header className="pagehead">
        <span className="microlabel">
          <Link href={`/garage/${car.id}/edit`} className="hover:text-live">
            ← {car.name}
          </Link>{" "}
          · new build update
        </span>
        <h1>What happened on {car.name}?</h1>
        <p className="sub">
          Just type — or add photos, a before/after, a result. Nothing is public until you
          publish; drafts save themselves.
        </p>
      </header>
      <BuildStoryComposer
        carId={car.id}
        userId={user.id}
        mods={mods}
        initialTitle={draft?.title ?? seededTitle}
        initialBlocks={draftBlocks && draftBlocks.length ? draftBlocks : seededBlocks}
        initialOperationId={draft?.id ?? randomUUID()}
        draftSavedAt={draft?.updated_at ?? null}
        publishAction={createRichActivityPost}
        draftAction={saveActivityDraft}
        parts={parts}
        discardAction={discardActivityDraft}
      />
    </div>
  );
}
