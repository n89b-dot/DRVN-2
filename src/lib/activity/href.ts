/**
 * Where a post lives (W-5).
 *
 * Until now a post's URL was always `/cars/{slug}/activity/{id}`, hand-built
 * in thirteen places. With `car_id` optional, a carless post has no car slug
 * to build that from — and thirteen call sites is thirteen chances to
 * produce a broken link on the day somebody posts without a car.
 *
 * One function. A post with a car keeps the URL it has always had, so every
 * link already in the world still resolves; one without falls back to
 * `/posts/{id}`.
 */
export function postHref(post: {
  id: string;
  carSlug?: string | null;
  car?: { slug?: string | null } | null;
}): string {
  const slug = post.carSlug ?? post.car?.slug ?? null;
  return slug ? `/cars/${slug}/activity/${post.id}` : `/posts/${post.id}`;
}
