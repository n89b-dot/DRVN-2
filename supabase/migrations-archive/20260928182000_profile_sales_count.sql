-- social-4: "N sold" on a profile's trust line, for everyone.
--
-- The count was read straight from `orders`, which only the buyer and seller
-- can see, so a visitor counted 0 sales for every seller. Like
-- profile_follow_counts (20260920090000), a definer function returns the
-- total and nothing else — never which orders — and only for a visible
-- profile.
--
-- Idempotent: create or replace.

begin;

create or replace function public.profile_sales_count(p_profile uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*) from public.orders o
   where o.seller_id = p_profile
     and o.status in ('paid', 'shipped', 'delivered', 'completed')
     and public.profile_is_visible(p_profile);
$$;

revoke all on function public.profile_sales_count(uuid) from public;
grant execute on function public.profile_sales_count(uuid) to anon, authenticated, service_role;

commit;
