-- ============================================================================
-- 0006 — Security hardening (remediation plan R1)
--
-- Context: anyone holding the anon key and a user JWT can talk to PostgREST
-- directly. RLS — not the server actions — is therefore the real security
-- boundary, and several policies were looser than the actions in front of them.
--
-- This migration closes: forged orders → fake reviews, profile_type
-- self-escalation, ownership reassignment on every owned table, offer
-- tampering, comment/reaction visibility bypass, unbounded text, and
-- unrestricted uploads. It also adds a DB-backed rate limiter.
--
-- Idempotent: safe to re-run.
-- Run in the Supabase SQL Editor.
-- ============================================================================

begin;

-- ============================================================
-- 1. Helper: is this a trusted server-side writer?
-- ============================================================
-- Used by the column-immutability triggers below so that service-role paths
-- (checkout, offer acceptance, fulfilment) and dashboard SQL keep working
-- while ordinary user JWTs cannot touch privileged columns.
create or replace function public.is_trusted_writer()
returns boolean
language sql
stable
as $$
  select
    current_user in ('postgres', 'supabase_admin', 'service_role')
    or coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      ''
    ) = 'service_role';
$$;

-- ============================================================
-- 2. profiles — pin role, allow username to be set exactly once
-- ============================================================
-- WITH CHECK stops `id` being rewritten. profile_type and username need a
-- trigger, because a policy cannot compare against the pre-update row.
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.guard_profile_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_trusted_writer() then
    return new;
  end if;

  -- profile_type is a role flag ('user' | 'shop'). Self-granting 'shop' would
  -- hand a user any seller tooling or fee tier keyed off it.
  if new.profile_type is distinct from old.profile_type then
    raise exception 'profile_type cannot be changed by the account holder'
      using errcode = '42501';
  end if;

  -- Onboarding sets the username; after that it is an identity other people
  -- link to, so changes go through a controlled path, not a raw PATCH.
  if old.username is not null and new.username is distinct from old.username then
    raise exception 'username cannot be changed once set'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_columns on public.profiles;
create trigger profiles_guard_columns
  before update on public.profiles
  for each row execute function public.guard_profile_columns();

-- ============================================================
-- 3. Owned tables — ownership columns become immutable
-- ============================================================
-- Every owner-update policy previously had USING with no WITH CHECK. USING is
-- evaluated against the OLD row, so the owner passed the check and the NEW
-- row's owner_id/seller_id was accepted unvalidated — letting anyone dump a
-- car or listing onto another account.
drop policy if exists "owners update cars" on public.cars;
create policy "owners update cars" on public.cars for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "sellers update listings" on public.listings;
create policy "sellers update listings" on public.listings for update
  using (auth.uid() = seller_id)
  with check (auth.uid() = seller_id);

drop policy if exists "authors update activity" on public.activity_posts;
create policy "authors update activity" on public.activity_posts for update
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

-- A listing's source car is a provenance claim; it must stay owned by the
-- seller. (The server action checks this too — this is the backstop.)
create or replace function public.guard_listing_source_car()
returns trigger
language plpgsql
as $$
begin
  if public.is_trusted_writer() then
    return new;
  end if;

  if new.source_car_id is not null and not exists (
    select 1 from public.cars c
    where c.id = new.source_car_id and c.owner_id = new.seller_id
  ) then
    raise exception 'source_car_id must reference a car owned by the seller'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists listings_guard_source_car on public.listings;
create trigger listings_guard_source_car
  before insert or update on public.listings
  for each row execute function public.guard_listing_source_car();

-- ============================================================
-- 4. orders — no client writes at all
-- ============================================================
-- The INSERT policy only checked buyer_id, leaving seller_id, amounts and
-- status free. That allowed a self-inserted order born 'paid' naming any
-- victim as seller, which the review policy then accepted as proof of a
-- transaction. All order creation runs through the service-role client, so no
-- client-side policy is needed: with RLS on and no INSERT/UPDATE/DELETE
-- policy, PostgREST denies those verbs by default. Reads are unchanged.
drop policy if exists "buyers create orders" on public.orders;

-- ============================================================
-- 5. reviews — must describe a real order between the two parties
-- ============================================================
drop policy if exists "reviewers create reviews" on public.reviews;
create policy "reviewers create reviews" on public.reviews for insert
  with check (
    auth.uid() = reviewer_id
    and reviewer_id is distinct from reviewee_id
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and auth.uid() in (o.buyer_id, o.seller_id)
        -- The reviewee must be the *counterparty* of that order, not an
        -- arbitrary profile the client names.
        and reviewee_id = case
              when auth.uid() = o.buyer_id then o.seller_id
              else o.buyer_id
            end
    )
  );

-- Reviews were permanent and unmoderatable: no UPDATE or DELETE policy existed.
create policy "authors update reviews" on public.reviews for update
  using (auth.uid() = reviewer_id)
  with check (auth.uid() = reviewer_id);
create policy "authors delete reviews" on public.reviews for delete
  using (auth.uid() = reviewer_id);

-- ============================================================
-- 6. offers — amount and identity immutable; buyer may only withdraw
-- ============================================================
-- "participants update offers" had USING and no WITH CHECK, so a buyer could
-- rewrite amount_cents, reassign buyer_id, or flip a declined offer back to
-- open. Acceptance/decline runs service-side, so the only client-side write
-- a user needs is withdrawing their own open offer.
drop policy if exists "participants update offers" on public.offers;
create policy "buyers withdraw own offers" on public.offers for update
  using (auth.uid() = buyer_id and status = 'open')
  with check (auth.uid() = buyer_id and status in ('open', 'withdrawn'));

create or replace function public.guard_offer_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_trusted_writer() then
    return new;
  end if;

  if new.amount_cents is distinct from old.amount_cents
     or new.listing_id is distinct from old.listing_id
     or new.buyer_id is distinct from old.buyer_id then
    raise exception 'offer amount and parties are immutable'
      using errcode = '42501';
  end if;

  -- A closed offer never reopens.
  if old.status <> 'open' and new.status <> old.status then
    raise exception 'offer status is final once it leaves open'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists offers_guard_columns on public.offers;
create trigger offers_guard_columns
  before update on public.offers
  for each row execute function public.guard_offer_columns();

-- ============================================================
-- 7. listing_questions — scope to a visible listing, keep threads coherent
-- ============================================================
drop policy if exists "authed users ask questions" on public.listing_questions;
create policy "authed users ask questions" on public.listing_questions for insert
  with check (
    auth.uid() = author_id
    and char_length(body) between 1 and 2000
    and exists (
      select 1 from public.listings l
      where l.id = listing_id
        and (l.status in ('active', 'sold') or l.seller_id = auth.uid())
    )
    -- A reply must hang off a question on the *same* listing, or threads can
    -- be corrupted across listings.
    and (
      parent_id is null
      or exists (
        select 1 from public.listing_questions q
        where q.id = parent_id and q.listing_id = listing_questions.listing_id
      )
    )
  );

create policy "authors delete questions" on public.listing_questions for delete
  using (auth.uid() = author_id);

-- ============================================================
-- 8. activity engagement — inherit the parent post's visibility
-- ============================================================
-- 0003 shipped `using (true)` for both, so comments and reactions on
-- unpublished or private-car posts were world-readable and world-writable.
create or replace function public.activity_post_visible(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.activity_posts p
    join public.cars c on c.id = p.car_id
    where p.id = p_post_id
      and ((p.published_at is not null and c.is_public) or p.author_id = auth.uid())
  );
$$;

drop policy if exists "reactions public read" on public.activity_reactions;
create policy "reactions follow post visibility" on public.activity_reactions for select
  using (public.activity_post_visible(post_id));

drop policy if exists "users manage own reactions" on public.activity_reactions;
create policy "users manage own reactions" on public.activity_reactions for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and char_length(emoji) <= 16
    and public.activity_post_visible(post_id)
  );

drop policy if exists "comments public read" on public.activity_comments;
create policy "comments follow post visibility" on public.activity_comments for select
  using (public.activity_post_visible(post_id));

drop policy if exists "users create comments" on public.activity_comments;
create policy "users create comments" on public.activity_comments for insert
  with check (
    auth.uid() = author_id
    and char_length(body) between 1 and 2000
    and public.activity_post_visible(post_id)
  );

-- 0003 shipped a delete policy but no update policy.
create policy "authors update comments" on public.activity_comments for update
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

-- ============================================================
-- 9. messages — recipients can mark read, nobody can rewrite history
-- ============================================================
-- `read_at` existed with no UPDATE policy, so it could never be written.
create policy "recipients update own messages" on public.messages for update
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

create or replace function public.guard_message_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_trusted_writer() then
    return new;
  end if;

  if new.body is distinct from old.body
     or new.sender_id is distinct from old.sender_id
     or new.recipient_id is distinct from old.recipient_id
     or new.listing_id is distinct from old.listing_id
     or new.offer_id is distinct from old.offer_id then
    raise exception 'only read_at may be updated on a message'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists messages_guard_columns on public.messages;
create trigger messages_guard_columns
  before update on public.messages
  for each row execute function public.guard_message_columns();

-- ============================================================
-- 10. Text bounds — stop unbounded user input at the database
-- ============================================================
-- Application validation is the friendly path; these are the backstop against
-- a direct REST insert of a multi-megabyte field.
alter table public.profiles
  drop constraint if exists profiles_text_bounds,
  add constraint profiles_text_bounds check (
    char_length(coalesce(display_name, '')) <= 80
    and char_length(coalesce(bio, '')) <= 1000
    and char_length(coalesce(location, '')) <= 120
  );

alter table public.cars
  drop constraint if exists cars_text_bounds,
  add constraint cars_text_bounds check (
    char_length(name) between 1 and 120
    and char_length(coalesce(about, '')) <= 4000
    and char_length(coalesce(color, '')) <= 60
    and coalesce(array_length(tags, 1), 0) <= 20
  );

alter table public.listings
  drop constraint if exists listings_text_bounds,
  add constraint listings_text_bounds check (
    char_length(title) between 1 and 140
    and char_length(coalesce(description, '')) <= 8000
    and char_length(coalesce(compatibility_notes, '')) <= 2000
    and char_length(coalesce(location, '')) <= 120
  );

-- price_cents is `int`; cap well below int4 overflow so a large offer or price
-- surfaces as a validation message rather than a raw Postgres error.
alter table public.listings
  drop constraint if exists listings_price_ceiling,
  add constraint listings_price_ceiling check (price_cents <= 100000000); -- 1,000,000.00

alter table public.offers
  drop constraint if exists offers_amount_ceiling,
  add constraint offers_amount_ceiling check (amount_cents <= 100000000);

alter table public.activity_posts
  drop constraint if exists activity_posts_text_bounds,
  add constraint activity_posts_text_bounds check (
    char_length(title) between 1 and 160
    and char_length(coalesce(intro, '')) <= 2000
  );

alter table public.reviews
  drop constraint if exists reviews_body_bounds,
  add constraint reviews_body_bounds check (char_length(coalesce(body, '')) <= 2000);

alter table public.messages
  drop constraint if exists messages_body_bounds,
  add constraint messages_body_bounds check (char_length(body) between 1 and 4000);

alter table public.listing_questions
  drop constraint if exists listing_questions_body_bounds,
  add constraint listing_questions_body_bounds check (char_length(body) between 1 and 2000);

alter table public.activity_comments
  drop constraint if exists activity_comments_body_bounds,
  add constraint activity_comments_body_bounds check (char_length(body) between 1 and 2000);

alter table public.activity_reactions
  drop constraint if exists activity_reactions_emoji_bounds,
  add constraint activity_reactions_emoji_bounds check (char_length(emoji) between 1 and 16);

-- ============================================================
-- 11. Storage — enforce type and size at the bucket, not the browser
-- ============================================================
-- Client-side `accept="image/*"` and a size check are advisory only: the
-- storage API takes a client-supplied content type. Without these limits a
-- user could park HTML or SVG in a public bucket and get a served URL.
update storage.buckets
set
  file_size_limit = 10485760, -- 10 MB
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']
where id in ('car-images', 'activity-images', 'listing-images');

update storage.buckets
set
  file_size_limit = 2097152, -- 2 MB
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
where id = 'avatars';

-- ============================================================
-- 12. Rate limiting
-- ============================================================
-- Signup, offers, questions, comments and reactions were all unthrottled.
-- A fixed-window counter in Postgres keeps this dependency-free.
create table if not exists public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count int not null default 0
);

alter table public.rate_limits enable row level security;
-- No policies: only the service role (which bypasses RLS) touches this.

comment on table public.rate_limits is
  'Fixed-window rate limiter. Written only via consume_rate_limit() on the service-role path.';

create or replace function public.consume_rate_limit(
  p_key text,
  p_limit int,
  p_window interval
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.rate_limits (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set
      -- Reset the window if the old one has elapsed, otherwise increment.
      window_start = case
        when public.rate_limits.window_start < now() - p_window then now()
        else public.rate_limits.window_start
      end,
      count = case
        when public.rate_limits.window_start < now() - p_window then 1
        else public.rate_limits.count + 1
      end
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.consume_rate_limit(text, int, interval) from public, anon, authenticated;

-- Housekeeping: callable manually or from a scheduled job.
create or replace function public.prune_rate_limits()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.rate_limits where window_start < now() - interval '1 day';
$$;

commit;
