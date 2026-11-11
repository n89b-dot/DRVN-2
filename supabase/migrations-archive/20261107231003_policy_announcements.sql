-- ============================================================================
-- 20261107231003 — Announcing policy changes in the app (N629)
--
-- The Terms (§13) and the Privacy Policy ("Changes") both promise that
-- material changes are announced in the app. Nothing did that. The smallest
-- honest mechanism is the one every member already reads: a notification in
-- the bell, linking to the page that changed.
--
--  * public.policy_announcements — one row per announced change, keyed, so
--    announcing the same change twice reaches nobody twice.
--  * public.announce_policy_update(key, title, body, href) — service role
--    only. Records the change and notifies every member: every profile with
--    a handle (a deleted account loses its handle, and an unfinished one has
--    none yet), kind 'policy_updated', never muted. Returns how many were
--    told.
--
-- Then the change this release makes is announced: the 7 November 2026
-- Terms and Privacy update (18+ confirmation, copyright notices).
--
-- Idempotent.
-- ============================================================================

begin;

create table if not exists public.policy_announcements (
  key          text primary key check (key ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  title        text not null check (length(btrim(title)) between 1 and 120),
  body         text not null check (length(btrim(body)) between 1 and 500),
  href         text not null check (href ~ '^/[a-z0-9/#_-]*$'),
  recipients   int not null default 0,
  announced_at timestamptz not null default now()
);
comment on table public.policy_announcements is
  'Material Terms/Privacy changes announced in the app, one row per change (N629). Written by announce_policy_update().';
alter table public.policy_announcements enable row level security;
revoke all on public.policy_announcements from public, anon, authenticated;
grant select on public.policy_announcements to service_role;

create or replace function public.announce_policy_update(p_key text, p_title text, p_body text, p_href text)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  insert into public.policy_announcements (key, title, body, href)
  values (p_key, p_title, p_body, p_href)
  on conflict (key) do nothing;
  if not found then
    return 0;
  end if;

  insert into public.notifications (user_id, kind, section, title, body, href, actor_id)
  select p.id, 'policy_updated', 'marketplace', p_title, p_body, p_href, null
    from public.profiles p
   where p.username is not null;
  get diagnostics v_count = row_count;

  update public.policy_announcements set recipients = v_count where key = p_key;
  return v_count;
end;
$$;
revoke all on function public.announce_policy_update(text, text, text, text) from public, anon, authenticated;
grant execute on function public.announce_policy_update(text, text, text, text) to service_role;

do $$
begin
  perform public.announce_policy_update(
    '2026-11-07-terms-privacy',
    'We updated our Terms and Privacy Policy',
    'From 7 November 2026: new members confirm they are 18 or over, and rights holders can send a copyright notice. Read what changed.',
    '/terms#changes'
  );
end $$;

commit;
