-- DRVN v3 schema (PRD v3, M0 foundation)
-- DESTRUCTIVE: drops the old DRVN v1 schema on this project (no production data).
-- Run in the Supabase SQL Editor.

-- ============================================================
-- 0. Drop old schema
-- ============================================================
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user() cascade;

do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop table if exists public.%I cascade', t.tablename);
  end loop;
end $$;

-- ============================================================
-- 1. Core identity
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique,
  display_name text,
  avatar_url text,
  bio text,
  location text,
  links jsonb not null default '[]',
  profile_type text not null default 'user' check (profile_type in ('user', 'shop')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 2. Cars
-- ============================================================
create table public.cars (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  slug text not null unique,
  name text not null,
  make text,
  model text,
  year int,
  color text,
  about text,
  tags text[] not null default '{}',
  cover_image_url text,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.car_images (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references public.cars (id) on delete cascade,
  url text not null,
  alt text,
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 3. Activity (per-car build updates)
-- ============================================================
create table public.activity_posts (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references public.cars (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  intro text,
  body jsonb not null default '[]',
  video_url text,
  published_at timestamptz default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.activity_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.activity_posts (id) on delete cascade,
  url text not null,
  alt text,
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 4. Listings (marketplace)
-- ============================================================
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles (id) on delete cascade,
  source_car_id uuid references public.cars (id) on delete set null,
  title text not null,
  description text,
  category text not null,
  subcategory text,
  condition text check (condition in ('new', 'like_new', 'used', 'for_parts')),
  price_cents int not null check (price_cents >= 0),
  currency text not null default 'USD',
  location text,
  -- Freeform, non-authoritative seller notes (PRD §7.1) — never drives fitment.
  compatibility_notes text,
  status text not null default 'active' check (status in ('draft', 'active', 'sold', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  url text not null,
  alt text,
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 5. Structured mods (PRD §7.3)
-- ============================================================
create table public.mod_items (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references public.cars (id) on delete cascade,
  group_label text not null default 'Other',
  category text,
  brand text,
  product text,
  part_number text,
  raw_text text,
  linked_listing_id uuid references public.listings (id) on delete set null,
  confidence real,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 6. Social graph (saves / follows)
-- ============================================================
create table public.saves (
  user_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('listing', 'car', 'profile')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('car', 'profile')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (follower_id, target_type, target_id)
);

-- ============================================================
-- 7. Commerce scaffolding (wired up in M3)
-- ============================================================
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles (id),
  seller_id uuid not null references public.profiles (id),
  status text not null default 'pending' check (status in ('pending', 'paid', 'shipped', 'completed', 'cancelled', 'refunded')),
  subtotal_cents int not null default 0,
  platform_fee_cents int not null default 0,
  total_cents int not null default 0,
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  listing_id uuid not null references public.listings (id),
  price_cents int not null,
  quantity int not null default 1
);

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  amount_cents int not null check (amount_cents > 0),
  status text not null default 'open' check (status in ('open', 'accepted', 'declined', 'withdrawn', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  reviewee_id uuid not null references public.profiles (id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  body text,
  created_at timestamptz not null default now(),
  unique (order_id, reviewer_id)
);

create table public.listing_questions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  parent_id uuid references public.listing_questions (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

-- Marketplace-scoped messaging only (listing/offer threads; PRD §7.4).
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  offer_id uuid references public.offers (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 8. Indexes
-- ============================================================
create index cars_owner_idx on public.cars (owner_id);
create index car_images_car_idx on public.car_images (car_id);
create index activity_posts_car_idx on public.activity_posts (car_id);
create index activity_images_post_idx on public.activity_images (post_id);
create index listings_seller_idx on public.listings (seller_id);
create index listings_category_idx on public.listings (category, status);
create index listing_images_listing_idx on public.listing_images (listing_id);
create index mod_items_car_idx on public.mod_items (car_id);
create index offers_listing_idx on public.offers (listing_id);
create index listing_questions_listing_idx on public.listing_questions (listing_id);
create index messages_listing_idx on public.messages (listing_id);

-- ============================================================
-- 9. handle_new_user trigger
-- ============================================================
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 10. RLS
-- ============================================================
alter table public.profiles enable row level security;
alter table public.cars enable row level security;
alter table public.car_images enable row level security;
alter table public.activity_posts enable row level security;
alter table public.activity_images enable row level security;
alter table public.listings enable row level security;
alter table public.listing_images enable row level security;
alter table public.mod_items enable row level security;
alter table public.saves enable row level security;
alter table public.follows enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.offers enable row level security;
alter table public.reviews enable row level security;
alter table public.listing_questions enable row level security;
alter table public.messages enable row level security;

-- profiles
create policy "profiles are public" on public.profiles for select using (true);
create policy "users update own profile" on public.profiles for update using (auth.uid() = id);

-- cars
create policy "public cars readable" on public.cars for select
  using (is_public or auth.uid() = owner_id);
create policy "owners insert cars" on public.cars for insert with check (auth.uid() = owner_id);
create policy "owners update cars" on public.cars for update using (auth.uid() = owner_id);
create policy "owners delete cars" on public.cars for delete using (auth.uid() = owner_id);

-- car_images (via parent car)
create policy "car images follow car visibility" on public.car_images for select
  using (exists (select 1 from public.cars c where c.id = car_id and (c.is_public or c.owner_id = auth.uid())));
create policy "owners manage car images" on public.car_images for all
  using (exists (select 1 from public.cars c where c.id = car_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from public.cars c where c.id = car_id and c.owner_id = auth.uid()));

-- activity
create policy "published activity readable" on public.activity_posts for select
  using (
    (published_at is not null and exists (select 1 from public.cars c where c.id = car_id and c.is_public))
    or auth.uid() = author_id
  );
create policy "authors insert activity" on public.activity_posts for insert
  with check (auth.uid() = author_id and exists (select 1 from public.cars c where c.id = car_id and c.owner_id = auth.uid()));
create policy "authors update activity" on public.activity_posts for update using (auth.uid() = author_id);
create policy "authors delete activity" on public.activity_posts for delete using (auth.uid() = author_id);

create policy "activity images follow post" on public.activity_images for select
  using (exists (
    select 1 from public.activity_posts p
    join public.cars c on c.id = p.car_id
    where p.id = post_id and ((p.published_at is not null and c.is_public) or p.author_id = auth.uid())
  ));
create policy "authors manage activity images" on public.activity_images for all
  using (exists (select 1 from public.activity_posts p where p.id = post_id and p.author_id = auth.uid()))
  with check (exists (select 1 from public.activity_posts p where p.id = post_id and p.author_id = auth.uid()));

-- listings
create policy "active listings readable" on public.listings for select
  using (status in ('active', 'sold') or auth.uid() = seller_id);
create policy "sellers insert listings" on public.listings for insert with check (auth.uid() = seller_id);
create policy "sellers update listings" on public.listings for update using (auth.uid() = seller_id);
create policy "sellers delete listings" on public.listings for delete using (auth.uid() = seller_id);

create policy "listing images follow listing" on public.listing_images for select
  using (exists (select 1 from public.listings l where l.id = listing_id and (l.status in ('active','sold') or l.seller_id = auth.uid())));
create policy "sellers manage listing images" on public.listing_images for all
  using (exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid()))
  with check (exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid()));

-- mod_items (via parent car)
create policy "mods follow car visibility" on public.mod_items for select
  using (exists (select 1 from public.cars c where c.id = car_id and (c.is_public or c.owner_id = auth.uid())));
create policy "owners manage mods" on public.mod_items for all
  using (exists (select 1 from public.cars c where c.id = car_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from public.cars c where c.id = car_id and c.owner_id = auth.uid()));

-- saves / follows (private to the user)
create policy "users manage own saves" on public.saves for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users manage own follows" on public.follows for all
  using (auth.uid() = follower_id) with check (auth.uid() = follower_id);

-- commerce: participants only
create policy "participants read orders" on public.orders for select
  using (auth.uid() in (buyer_id, seller_id));
create policy "buyers create orders" on public.orders for insert with check (auth.uid() = buyer_id);
create policy "participants read order items" on public.order_items for select
  using (exists (select 1 from public.orders o where o.id = order_id and auth.uid() in (o.buyer_id, o.seller_id)));

create policy "participants read offers" on public.offers for select
  using (auth.uid() = buyer_id or exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid()));
create policy "buyers create offers" on public.offers for insert with check (auth.uid() = buyer_id);
create policy "participants update offers" on public.offers for update
  using (auth.uid() = buyer_id or exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid()));

create policy "reviews are public" on public.reviews for select using (true);
create policy "reviewers create reviews" on public.reviews for insert
  with check (auth.uid() = reviewer_id and exists (select 1 from public.orders o where o.id = order_id and auth.uid() in (o.buyer_id, o.seller_id)));

create policy "questions are public" on public.listing_questions for select using (true);
create policy "authed users ask questions" on public.listing_questions for insert
  with check (auth.uid() = author_id);

create policy "participants read messages" on public.messages for select
  using (auth.uid() in (sender_id, recipient_id));
create policy "senders create messages" on public.messages for insert
  with check (auth.uid() = sender_id);

-- ============================================================
-- 11. Storage buckets + policies
-- ============================================================
insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', true),
  ('car-images', 'car-images', true),
  ('activity-images', 'activity-images', true),
  ('listing-images', 'listing-images', true)
on conflict (id) do nothing;

create policy "public read media" on storage.objects for select
  using (bucket_id in ('avatars', 'car-images', 'activity-images', 'listing-images'));

create policy "users upload to own folder" on storage.objects for insert
  with check (
    bucket_id in ('avatars', 'car-images', 'activity-images', 'listing-images')
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users update own media" on storage.objects for update
  using (
    bucket_id in ('avatars', 'car-images', 'activity-images', 'listing-images')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users delete own media" on storage.objects for delete
  using (
    bucket_id in ('avatars', 'car-images', 'activity-images', 'listing-images')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
