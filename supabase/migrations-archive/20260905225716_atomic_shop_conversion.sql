begin;

-- Authenticated capability: the caller can convert only their own profile.
-- The profile flag and its required extension row share one commit, and an
-- old partial conversion is repaired by the same replay-safe call.
create function public.become_shop()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  actor uuid:=auth.uid();
  profile_kind text;
  had_shop_row boolean;
  applied boolean:=false;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not private.beta_member_eligible(actor,'seller') then
    raise exception 'Selling is limited to invited beta members' using errcode='42501';
  end if;

  select profile_type into profile_kind from public.profiles where id=actor for update;
  if not found then raise exception 'Profile not found'; end if;
  if profile_kind not in ('user','shop') then raise exception 'Profile cannot become a shop'; end if;
  select exists(select 1 from public.shop_profiles where profile_id=actor) into had_shop_row;

  insert into public.shop_profiles(profile_id) values(actor) on conflict(profile_id) do nothing;
  if profile_kind='user' then
    update public.profiles set profile_type='shop' where id=actor;
    applied:=true;
  end if;

  if not exists(
    select 1 from public.profiles p join public.shop_profiles s on s.profile_id=p.id
    where p.id=actor and p.profile_type='shop'
  ) then raise exception 'Shop conversion did not persist'; end if;

  return jsonb_build_object(
    'ok',true,
    'applied',applied,
    'replayed',not applied and had_shop_row,
    'repaired',not applied and not had_shop_row
  );
end $$;

revoke all on function public.become_shop() from public,anon;
grant execute on function public.become_shop() to authenticated;

notify pgrst,'reload schema';
commit;
