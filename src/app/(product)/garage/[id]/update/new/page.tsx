import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { normalizeBlocks } from "@/lib/activity-blocks";
import { createClient } from "@/lib/supabase/server";
import { BuildStoryComposer } from "@/features/composer/composer";

import { createRichActivityPost, saveActivityDraft } from "../../../actions";

export const metadata = { title: "New update - DRVN" };

export default async function NewUpdatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
  const [{ data: draft }, { data: modRows }] = await Promise.all([
    supabase
      .from("activity_posts")
      .select("title, body, updated_at")
      .eq("car_id", car.id)
      .eq("author_id", user.id)
      .is("published_at", null)
      .maybeSingle(),
    supabase
      .from("mod_items")
      .select("id, brand, product, raw_text")
      .eq("car_id", car.id)
      .order("position"),
  ]);
  const draftBlocks = draft ? normalizeBlocks(draft.body) : null;
  const mods = (modRows ?? []).map((mod) => ({
    id: mod.id,
    label: [mod.brand, mod.product].filter(Boolean).join(" ") || mod.raw_text || "Build entry",
  }));

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
        initialTitle={draft?.title ?? ""}
        initialBlocks={draftBlocks && draftBlocks.length ? draftBlocks : []}
        draftSavedAt={draft?.updated_at ?? null}
        publishAction={createRichActivityPost}
        draftAction={saveActivityDraft}
      />
    </div>
  );
}
