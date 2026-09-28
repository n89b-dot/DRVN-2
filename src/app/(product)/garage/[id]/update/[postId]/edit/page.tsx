import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot } from "@/components/ui";
import { normalizeBlocks } from "@/lib/activity-blocks";
import { getPageClient, getViewer } from "@/lib/supabase/page-context";

import { PostEditor } from "./post-editor";
import { updateActivityPost } from "../../../../actions";
import { reportError } from "@/lib/monitoring";

export const metadata = { title: "Edit update - DRVN" };

/**
 * Editing a filed build entry. Posts were create-only: a typo in a title was
 * permanent, and there was no way to remove one.
 */
/** The URL segment that stands where a car id would, for a carless post. */
const NO_CAR = "no-car";

export default async function EditActivityPostPage({
  params,
}: {
  params: Promise<{ id: string; postId: string }>;
}) {
  const { id: carId, postId } = await params;
  // W-5: a post about a part has no car, and this editor is addressed by
  // car. `no-car` stands in the car's place in the URL — the same word the
  // quick post already uses for such a post's photo folder — so a carless
  // post can be corrected without a second copy of this page.
  const carless = carId === NO_CAR;

  const supabase = await getPageClient();
  const user = await getViewer();
  if (!user) redirect("/login");

  const { data: post, error } = await supabase
    .from("activity_posts")
    .select("id, car_id, author_id, title, intro, body, video_url, published_at")
    .eq("id", postId)
    .maybeSingle();

  if (error) {
    reportError("[activity/edit] failed to load post", { postId, error });
    throw new Error("Could not load this update");
  }
  if (!post || post.author_id !== user.id) notFound();
  if (carless ? post.car_id !== null : post.car_id !== carId) notFound();

  const { data: car } = carless
    ? { data: null }
    : await supabase.from("cars").select("name, slug").eq("id", carId).maybeSingle();

  // A post from the rich composer holds image and/or multiple blocks. Those
  const bodyBlocks = normalizeBlocks(post.body);
  // A quick post's photos live only in the gallery, never in a block, so the
  // editor couldn't show them — or remove a wrong one. They open as a photos
  // block at the top; saving writes back whatever the member leaves there.
  const { data: gallery } = await supabase
    .from("activity_images")
    .select("url")
    .eq("post_id", post.id)
    .order("position");
  const inBlocks = new Set(bodyBlocks.flatMap((b) => (b.type === "images" ? b.urls : [])));
  const loosePhotos = (gallery ?? []).map((image) => image.url).filter((url) => !inBlocks.has(url));
  const blocks = loosePhotos.length
    ? [{ type: "images" as const, urls: loosePhotos }, ...bodyBlocks]
    : bodyBlocks;

  const { data: modRows } = carless
    ? { data: [] }
    : await supabase
        .from("mod_items")
        .select("id, brand, product, raw_text, status")
        .eq("car_id", carId)
        .order("position");
  const mods = (modRows ?? []).map((mod) => ({
    id: mod.id,
    // Parts that came off stay pickable and say so: an update is very often
    // *about* the part that just left the car.
    label:
      ([mod.brand, mod.product].filter(Boolean).join(" ") || mod.raw_text || "Build entry") +
      (mod.status === "removed" ? " — off the car" : ""),
  }));

  return (
    <div className="mx-auto w-full max-w-[720px] px-5 pb-10">
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          Editing an update{car ? ` on ${car.name}` : ""} ·{" "}
          {post.published_at
            ? new Date(post.published_at).toLocaleDateString()
            : "unpublished"}
        </span>
        <h1>
          Correct the <span className="live-word">record.</span>
        </h1>
      </Rv>

      <PostEditor
        carId={carId}
        userId={user.id}
        postId={post.id}
        title={post.title ?? ""}
        intro={post.intro ?? ""}
        videoUrl={post.video_url ?? ""}
        initialBlocks={blocks}
        publicHref={car ? `/cars/${car.slug}/activity/${post.id}` : carless ? `/posts/${post.id}` : null}
        mods={mods}
        publishAction={updateActivityPost}
      />

      <Foot
        left={carless ? "DRVN — edits show on the post" : "DRVN — edits show on the car's build page"}
        right={
          carless ? (
            <Link href={`/posts/${post.id}`}>← Back to the post</Link>
          ) : (
            <Link href={`/garage/${carId}/edit`}>← Back to the car</Link>
          )
        }
      />
    </div>
  );
}
