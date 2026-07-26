import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

import { PostEditor } from "./post-editor";

export const metadata = { title: "Edit update - DRVN" };

/**
 * Editing a filed build entry. Posts were create-only: a typo in a title was
 * permanent, and there was no way to remove one.
 */
export default async function EditActivityPostPage({
  params,
}: {
  params: Promise<{ id: string; postId: string }>;
}) {
  const { id: carId, postId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: post, error } = await supabase
    .from("activity_posts")
    .select("id, car_id, author_id, title, intro, body, video_url, published_at")
    .eq("id", postId)
    .maybeSingle();

  if (error) {
    console.error("[activity/edit] failed to load post", { postId, error });
    throw new Error("Could not load this update");
  }
  if (!post || post.author_id !== user.id || post.car_id !== carId) notFound();

  const { data: car } = await supabase
    .from("cars")
    .select("name, slug")
    .eq("id", carId)
    .maybeSingle();

  // A post from the rich composer holds image and text blocks. The simple
  // editor deliberately leaves the body alone in that case rather than
  // flattening it — content edits belong in the full editor.
  const blocks = Array.isArray(post.body) ? (post.body as { type?: string }[]) : [];
  const isRich = blocks.some((b) => b?.type === "images" || blocks.length > 1);
  const plainText = !isRich
    ? ((post.body as { text?: string }[] | null)?.[0]?.text ?? "")
    : "";

  return (
    <div className="mx-auto w-full max-w-[720px] px-5 pb-10">
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          Editing an entry{car ? ` on ${car.name}` : ""} ·{" "}
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
        postId={post.id}
        title={post.title}
        intro={post.intro ?? ""}
        videoUrl={post.video_url ?? ""}
        plainText={plainText}
        isRich={isRich}
        publicHref={car ? `/cars/${car.slug}/activity/${post.id}` : null}
      />

      <Foot
        left="DRVN / Livesheet — the sheet stays honest"
        right={<Link href={`/garage/${carId}/edit`}>← Back to the car</Link>}
      />
    </div>
  );
}
