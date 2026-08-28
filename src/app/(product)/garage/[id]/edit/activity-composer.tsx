import Link from "next/link";

import { ButtonLink } from "@/components/ui";

/**
 * Build-updates section of the car editor. The old inline quick form and the
 * separate "full editor" are one composer now (brief §M3): "Post an update"
 * opens the Build Story Composer, which is exactly as fast for a one-liner —
 * title, type, publish — and everything more when wanted. This section keeps
 * the filed list.
 */
export function ActivityComposer({
  carId,
  posts,
}: {
  carId: string;
  posts: { id: string; title: string; published_at: string | null }[];
}) {
  return (
    <section className="tile">
      <div className="tile__head">
        <span className="microlabel microlabel--ink">Build updates</span>
        <ButtonLink href={`/garage/${carId}/update/new`} variant="ghost">
          Post an update
        </ButtonLink>
      </div>

      {posts.length > 0 ? (
        <ul className="feed mt-2">
          {posts.map((post) => (
            <li key={post.id}>
              <Link
                href={`/garage/${carId}/update/${post.id}/edit`}
                className="min-w-0 flex-1 truncate transition-colors hover:text-live"
              >
                {post.title}
              </Link>
              <span className="amt">
                {post.published_at ? new Date(post.published_at).toLocaleDateString() : "Draft"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="field__hint mt-1">
          Nothing posted yet — updates appear on the car&apos;s public build page as soon as you
          publish them.
        </p>
      )}
    </section>
  );
}
