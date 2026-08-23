import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { UpdateComposer } from "./update-composer";

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
  // off. One draft per car: saving again overwrites, publishing converts.
  const { data: draft } = await supabase
    .from("activity_posts")
    .select("title, body, updated_at")
    .eq("car_id", car.id)
    .eq("author_id", user.id)
    .is("published_at", null)
    .maybeSingle();
  const { normalizeBlocks } = await import("@/lib/activity-blocks");
  const draftBlocks = draft ? normalizeBlocks(draft.body) : null;

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
        {/* The mild instructions read.cv puts under its section heading —
            one line that names the moves, then stays out of the way. */}
        <p className="sub">
          Title it, write it up, and add photos or a video with &ldquo;Add a
          block&rdquo;. Nothing is public until you publish.
        </p>
      </header>
      <UpdateComposer
        carId={car.id}
        userId={user.id}
        initialTitle={draft?.title}
        initialBlocks={draftBlocks && draftBlocks.length ? draftBlocks : undefined}
        draftSavedAt={draft?.updated_at}
      />
    </div>
  );
}
