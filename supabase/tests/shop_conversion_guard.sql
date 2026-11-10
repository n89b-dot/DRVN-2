begin;

create function pg_temp.impersonate(uid uuid) returns void language sql as $$
  select set_config('role','authenticated',true);
  select set_config('request.jwt.claims',json_build_object('sub',uid::text,'role','authenticated')::text,true);
$$;
create function pg_temp.back_to_admin() returns void language sql as $$
  select set_config('role','none',true);
  select set_config('request.jwt.claims','',true);
$$;

-- This guard's own helpers are called while acting as other roles. A new
-- function is closed by default (architecture plan 2, item A3), so they are opened here.
grant execute on all routines in schema pg_temp to public;

create function public.reject_shop_guard_fixture() returns trigger language plpgsql as $$
begin
  if new.profile_id='00000000-0000-0000-0000-00000000f001'::uuid then
    raise exception 'fixture rejects shop row';
  end if;
  return new;
end $$;
create trigger reject_shop_guard_fixture before insert on public.shop_profiles
for each row execute function public.reject_shop_guard_fixture();

do $$
declare
  actor uuid:='00000000-0000-0000-0000-00000000f000';
  failing uuid:='00000000-0000-0000-0000-00000000f001';
  other_user uuid:='00000000-0000-0000-0000-00000000f002';
  result jsonb;
  rejected boolean;
begin
  insert into auth.users(id,email) values
    (actor,'shop-conversion-actor@drvn.test'),
    (failing,'shop-conversion-failure@drvn.test'),
    (other_user,'shop-conversion-other@drvn.test');

  perform pg_temp.impersonate(failing);
  rejected:=false;
  begin perform public.become_shop(); exception when others then rejected:=true; end;
  perform pg_temp.back_to_admin();
  if not rejected
     or (select profile_type from public.profiles where id=failing)<>'user'
     or exists(select 1 from public.shop_profiles where profile_id=failing) then
    raise exception 'Failed shop-row write left a partial profile conversion';
  end if;

  drop trigger reject_shop_guard_fixture on public.shop_profiles;
  perform pg_temp.impersonate(actor);
  result:=public.become_shop();
  perform pg_temp.back_to_admin();
  if coalesce((result->>'applied')::boolean,false) is not true
     or (select profile_type from public.profiles where id=actor)<>'shop'
     or not exists(select 1 from public.shop_profiles where profile_id=actor) then
    raise exception 'Atomic shop conversion did not persist both rows';
  end if;
  if (select profile_type from public.profiles where id=other_user)<>'user' then
    raise exception 'Shop conversion changed a different account';
  end if;

  update public.shop_profiles set verification_status='verified',returns_accepted=true,return_window_days=60
  where profile_id=actor;
  perform pg_temp.impersonate(actor);
  result:=public.become_shop();
  perform pg_temp.back_to_admin();
  if coalesce((result->>'replayed')::boolean,false) is not true
     or not exists(
       select 1 from public.shop_profiles where profile_id=actor
       and verification_status='verified' and returns_accepted and return_window_days=60
     ) then raise exception 'Shop conversion replay overwrote existing policy or verification'; end if;

  delete from public.shop_profiles where profile_id=actor;
  perform pg_temp.impersonate(actor);
  result:=public.become_shop();
  perform pg_temp.back_to_admin();
  if coalesce((result->>'repaired')::boolean,false) is not true
     or not exists(select 1 from public.shop_profiles where profile_id=actor) then
    raise exception 'Legacy partial shop conversion was not repaired';
  end if;

  -- OS-W31: the invite-only beta is gone, so any member may become a shop.
  perform pg_temp.impersonate(other_user);
  perform public.become_shop();
  perform pg_temp.back_to_admin();
  if (select profile_type from public.profiles where id=other_user)<>'shop' then
    raise exception 'A member without an invitation could not become a shop';
  end if;

  if has_function_privilege('anon','public.become_shop()','execute') then
    raise exception 'Anonymous role can invoke shop conversion';
  end if;
  raise notice 'all atomic shop conversion checks passed';
end $$;

rollback;
