-- 20261107180100: what was saved, followed, liked or notified about goes when
-- the thing itself goes (OS-W22: N61).
--
-- Deleting a post, part, car or member left everything that pointed at it
-- behind: a notification about a deleted update opened a 404, and a save of
-- a deleted part still counted on Saved. None of those tables can carry a
-- foreign key — a save's target is a post, a part, a car or a member — so
-- nothing cleaned them up.
--
-- 1. A notification names what it is about. It only ever carried a link, so
--    `target_id` is now read from that link when the row is written (a post,
--    a part, a car by its slug, a member by their username) and backfilled
--    for every existing row. It is never a foreign key: the thing may go.
-- 2. When a post, part, car or member is deleted, the saves, follows and
--    likes of it and the notifications about it go in the same transaction.
-- 3. What was already left behind is removed now. A car's slug never
--    changes once made, so a car link that no longer resolves is a deleted
--    car; a username can change, so a member link that no longer resolves is
--    left alone.
--
-- Saved's counts already ask only for what exists and the caller can see
-- (saved_counts, 20261107180000), so a part that is hidden rather than
-- deleted is listed as unavailable, not counted.

begin;

-- ── 1. Notifications name their subject ───────────────────────────────────

alter table public.notifications add column if not exists target_id uuid;
comment on column public.notifications.target_id is
  'What the notification is about (a post, part, car or member), read from href on insert. Not a foreign key; cleared with its subject (20261107180100).';

create index if not exists notifications_target_idx
  on public.notifications (target_id) where target_id is not null;

-- The subject of a notification's link, or null when it names none.
-- Owner's rights so a private car's slug still resolves; callable by no
-- client, only by the trigger below and this migration.
create or replace function public.notification_href_target(p_href text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  uuid_re constant text := '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
  v_found text;
  v_id uuid;
begin
  if p_href is null then
    return null;
  end if;
  v_found := coalesce(
    substring(p_href from '^/posts/(' || uuid_re || ')(?:[/?#]|$)'),
    substring(p_href from '^/cars/[^/?#]+/activity/(' || uuid_re || ')(?:[/?#]|$)'),
    substring(p_href from '^/listings/(' || uuid_re || ')(?:[/?#]|$)')
  );
  if v_found is not null then
    return v_found::uuid;
  end if;
  v_found := substring(p_href from '^/cars/([^/?#]+)/?(?:[?#]|$)');
  if v_found is not null then
    select c.id into v_id from public.cars c where c.slug = v_found;
    return v_id;
  end if;
  v_found := substring(p_href from '^/u/([^/?#]+)/?(?:[?#]|$)');
  if v_found is not null then
    select p.id into v_id from public.profiles p where p.username = v_found;
    return v_id;
  end if;
  return null;
end;
$function$;

revoke all on function public.notification_href_target(text) from public, anon, authenticated;

create or replace function public.notification_set_target()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if (tg_op = 'INSERT' and new.target_id is null)
     or (tg_op = 'UPDATE' and new.href is distinct from old.href) then
    new.target_id := public.notification_href_target(new.href);
  end if;
  return new;
end;
$function$;

drop trigger if exists notifications_set_target on public.notifications;
create trigger notifications_set_target
  before insert or update of href on public.notifications
  for each row execute function public.notification_set_target();

update public.notifications n
set target_id = public.notification_href_target(n.href)
where n.target_id is null and n.href is not null;

-- ── 2. Deleting a thing forgets what pointed at it ────────────────────────

-- Owner's rights: the saves, follows and likes of a deleted post belong to
-- other members, whose rows the deleting member can't touch.
create or replace function public.forget_deleted_social_target()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_type text := tg_argv[0];
begin
  delete from public.saves where target_type = v_type and target_id = old.id;
  if v_type in ('car', 'profile') then
    delete from public.follows where target_type = v_type and target_id = old.id;
  end if;
  if v_type in ('car', 'listing') then
    delete from public.likes where target_type = v_type and target_id = old.id;
  end if;
  delete from public.notifications where target_id = old.id;
  return old;
end;
$function$;

drop trigger if exists activity_posts_forget_social on public.activity_posts;
create trigger activity_posts_forget_social after delete on public.activity_posts
  for each row execute function public.forget_deleted_social_target('post');
drop trigger if exists listings_forget_social on public.listings;
create trigger listings_forget_social after delete on public.listings
  for each row execute function public.forget_deleted_social_target('listing');
drop trigger if exists cars_forget_social on public.cars;
create trigger cars_forget_social after delete on public.cars
  for each row execute function public.forget_deleted_social_target('car');
drop trigger if exists profiles_forget_social on public.profiles;
create trigger profiles_forget_social after delete on public.profiles
  for each row execute function public.forget_deleted_social_target('profile');

-- ── 3. What was already left behind ───────────────────────────────────────

delete from public.saves s
where (s.target_type = 'post' and not exists (select 1 from public.activity_posts p where p.id = s.target_id))
   or (s.target_type = 'listing' and not exists (select 1 from public.listings l where l.id = s.target_id))
   or (s.target_type = 'car' and not exists (select 1 from public.cars c where c.id = s.target_id))
   or (s.target_type = 'profile' and not exists (select 1 from public.profiles pr where pr.id = s.target_id));

delete from public.follows f
where (f.target_type = 'car' and not exists (select 1 from public.cars c where c.id = f.target_id))
   or (f.target_type = 'profile' and not exists (select 1 from public.profiles pr where pr.id = f.target_id));

delete from public.likes lk
where (lk.target_type = 'listing' and not exists (select 1 from public.listings l where l.id = lk.target_id))
   or (lk.target_type = 'car' and not exists (select 1 from public.cars c where c.id = lk.target_id));

delete from public.notifications n
where (n.target_id is not null
       and not exists (select 1 from public.activity_posts p where p.id = n.target_id)
       and not exists (select 1 from public.listings l where l.id = n.target_id)
       and not exists (select 1 from public.cars c where c.id = n.target_id)
       and not exists (select 1 from public.profiles pr where pr.id = n.target_id))
   or (n.target_id is null and n.href ~ '^/cars/[^/?#]+/?([?#]|$)');

notify pgrst, 'reload schema';

commit;
