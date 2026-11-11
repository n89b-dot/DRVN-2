begin;

-- Set the requested state instead of deriving a toggle from a separate read.
-- Repeated controls, retries, and stale tabs therefore converge on the state
-- the member clicked without unique-key races or accidental double toggles.
create or replace function public.set_social_relationship(
  p_kind text,
  p_target_type text,
  p_target_id uuid,
  p_active boolean
) returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_target_id is null or p_active is null then
    raise exception 'Target and desired state are required' using errcode = '22023';
  end if;

  if p_kind = 'save' and p_target_type in ('listing', 'car', 'profile', 'post') then
    if p_active then
      insert into public.saves(user_id, target_type, target_id)
      values(uid, p_target_type, p_target_id)
      on conflict(user_id, target_type, target_id) do nothing;
    else
      delete from public.saves
      where user_id = uid and target_type = p_target_type and target_id = p_target_id;
    end if;
  elsif p_kind = 'like' and p_target_type in ('listing', 'car') then
    if p_active then
      insert into public.likes(user_id, target_type, target_id)
      values(uid, p_target_type, p_target_id)
      on conflict(user_id, target_type, target_id) do nothing;
    else
      delete from public.likes
      where user_id = uid and target_type = p_target_type and target_id = p_target_id;
    end if;
  elsif p_kind = 'follow' and p_target_type in ('car', 'profile') then
    if p_active then
      insert into public.follows(follower_id, target_type, target_id)
      values(uid, p_target_type, p_target_id)
      on conflict(follower_id, target_type, target_id) do nothing;
    else
      delete from public.follows
      where follower_id = uid and target_type = p_target_type and target_id = p_target_id;
    end if;
  else
    raise exception 'Unsupported social relationship' using errcode = '22023';
  end if;

  return p_active;
end;
$$;

revoke all on function public.set_social_relationship(text,text,uuid,boolean) from public, anon;
grant execute on function public.set_social_relationship(text,text,uuid,boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
