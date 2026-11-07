-- One page of the posts sitemap, filtered in SQL (OS-W26, N63).
--
-- The first version read a page of posts, then asked suspended_profile_ids()
-- over the Data API and dropped suspended authors in the app. That RPC is
-- `setof uuid`, so PostgREST caps its answer at max_rows (1,000,
-- supabase/config.toml): past 1,000 suspended members the list came back
-- short, and a carless post by one of the members left off it went into the
-- sitemap. Asked inside the query, the suspended set has no row cap.
--
-- WHO MAY SEE WHAT DOES NOT CHANGE. The function runs with the caller's
-- rights, so activity_posts and cars row security still decide what comes
-- back: a draft, a post on a private car, a post on a suspended member's car
-- are already invisible to a visitor. It narrows that further and never
-- widens it:
--   * only published posts;
--   * a post on a car only when that car is readable, public and has a slug
--     (otherwise there is no address to list, and the page would 404);
--   * never a post whose author is suspended, car or no car. The post read
--     rule doesn't hide a suspended member's carless post; the sitemap
--     shouldn't advertise it.
-- Executable by signed-out and signed-in callers only. service_role bypasses
-- row security, so it is deliberately not granted.
--
-- Pages are a stable id order, at most 1,000 rows (the sitemap page size and
-- the Data API row cap), so a page is never silently cut.

create or replace function public.sitemap_post_page(p_start integer, p_count integer)
returns table(id uuid, car_slug text, updated_at timestamptz)
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $function$
  select p.id, c.slug, p.updated_at
  from public.activity_posts p
  left join public.cars c on c.id = p.car_id
  where p.published_at is not null
    and (p.car_id is null or (c.is_public and c.slug is not null))
    and p.author_id not in (select public.suspended_profile_ids())
  order by p.id
  offset greatest(coalesce(p_start, 0), 0)
  limit least(greatest(coalesce(p_count, 0), 0), 1000);
$function$;

revoke all on function public.sitemap_post_page(integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.sitemap_post_page(integer, integer) to anon, authenticated;
