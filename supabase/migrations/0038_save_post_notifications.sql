-- 0038: notify_on_save learns 'post' (0037 let saves bookmark updates).
--
-- The 0009 trigger's else-branch assumed anything that isn't a car/listing is
-- a profile, so saving a post fed the *post id* into notifications.user_id —
-- an FK violation that rolled back the save itself. Posts now notify their
-- author; the profile branch is explicit rather than a catch-all.
--
-- Idempotent: create or replace, re-running is safe.

begin;

create or replace function public.notify_on_save()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_href text;
  v_title text;
  v_kind text := 'save';
  -- A saved *part* is market interest, not someone admiring your build. The PRD
  -- keeps the two columns separate, and the two have different preferences.
  v_section text := 'engagement';
begin
  if new.target_type = 'car' then
    select c.owner_id, '/cars/' || c.slug into v_owner, v_href
    from public.cars c where c.id = new.target_id;
    v_title := public.actor_name(new.user_id) || ' saved your build';
  elsif new.target_type = 'listing' then
    select l.seller_id, '/listings/' || l.id into v_owner, v_href
    from public.listings l where l.id = new.target_id;
    v_title := public.actor_name(new.user_id) || ' saved your part';
    v_kind := 'listing_save';
    v_section := 'marketplace';
  elsif new.target_type = 'post' then
    select p.author_id, '/cars/' || c.slug || '/activity/' || p.id
      into v_owner, v_href
    from public.activity_posts p
    join public.cars c on c.id = p.car_id
    where p.id = new.target_id;
    v_title := public.actor_name(new.user_id) || ' saved your update';
  elsif new.target_type = 'profile' then
    v_owner := new.target_id;
    v_title := public.actor_name(new.user_id) || ' saved your profile';
    select '/u/' || username into v_href from public.profiles where id = new.user_id;
  end if;

  -- Unknown target or vanished owner: the save still stands, silently.
  if v_owner is not null then
    perform public.notify(v_owner, v_kind, v_section, v_title, null, v_href, new.user_id);
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'notify_on_save'
      and pg_get_functiondef(p.oid) like '%saved your update%'
  ) then
    raise exception 'notify_on_save not updated for post saves';
  end if;
  raise notice '0038 self-checks pass';
end $$;

commit;
