-- 0049 — Immutable commercial sale snapshot (transaction-completion brief §6).
--
-- A dispute must never depend on reconstructing historical truth from the
-- current listing. Today order_items freezes only title/price/shipping plus
-- the 0024 condition_snapshot; everything else the buyer saw — description,
-- category, part numbers, fitment, source car, seller identity, gallery —
-- still resolves against the live listing, which the seller can edit, re-shoot
-- or delete after the sale.
--
-- This migration freezes the whole contract at purchase time:
--
--   * order_items.commercial_snapshot — one versioned jsonb object holding
--     listing identity, part identity, condition, fitment, source-car context,
--     commercial terms and seller identity as they stood at purchase.
--   * order_item_snapshot_images — the listing gallery, frozen row-per-photo.
--     Only the public URL is copied; 0049 also adds this table to the media
--     lifecycle reference check (src/lib/media-lifecycle.ts) so the underlying
--     storage object cannot be garbage-collected out from under the record.
--
-- The snapshot is taken by BEFORE INSERT trigger on order_items — the same
-- pattern 0024 established — because every order-creation path (0007 cart
-- claim, 0012/0034 offer accept) inserts order_items from inside a SQL
-- function. Server-side by construction; no client-submitted snapshot data
-- exists anywhere in the flow. A paid order cannot exist without its snapshot:
-- the column is NOT NULL and the trigger fills it before the row lands.
--
-- Immutability is enforced in the database, not by convention: a column guard
-- refuses UPDATEs to the frozen columns, and snapshot image rows refuse
-- UPDATE outright (DELETE remains possible only via the order_items cascade,
-- which is how order deletion already anonymises history).
--
-- Deliberately NOT stored in the snapshot: fulfilment addresses, phone
-- numbers, Stripe references — no secrets, no private data. The snapshot is
-- evidence of what was represented and agreed, and it is readable by exactly
-- the people who can already read the order.
--
-- Backfill: existing order_items get a best-available snapshot built from the
-- current listing (flagged "backfilled": true — content is today's listing,
-- not provably purchase-time) or, where the listing is gone, from the columns
-- the row itself carries (flagged "degraded": true).
--
-- Idempotent. Safe to re-run.

begin;

-- ============================================================
-- 1. Columns + frozen-gallery table
-- ============================================================
alter table public.order_items
  add column if not exists commercial_snapshot jsonb,
  add column if not exists snapshot_version int;

comment on column public.order_items.commercial_snapshot is
  'What the buyer purchased, frozen at purchase time. Versioned jsonb; see snapshot_version. Immutable after insert.';
comment on column public.order_items.snapshot_version is
  'Shape version of commercial_snapshot. v1 = 0049.';

create table if not exists public.order_item_snapshot_images (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  url text not null,
  alt text,
  position int not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.order_item_snapshot_images is
  'Listing gallery frozen at purchase. Rows are immutable; referenced URLs are protected from media GC.';

create index if not exists order_item_snapshot_images_item_idx
  on public.order_item_snapshot_images (order_item_id, position);

-- Media GC looks objects up by URL before deleting; without this the
-- reference check is a sequential scan per candidate object.
create index if not exists order_item_snapshot_images_url_idx
  on public.order_item_snapshot_images (url);

-- ============================================================
-- 2. Snapshot builder
-- ============================================================
-- Reads only server-side state. p_price/p_shipping are the transacted amounts
-- from the order_items row (an accepted offer's price differs from the listing
-- price, which is recorded separately as listing_price_cents).
create or replace function public.listing_commercial_snapshot(
  p_listing_id uuid,
  p_price_cents int,
  p_shipping_cents int
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_listing record;
  v_fitment jsonb;
  v_alt_numbers jsonb;
  v_car jsonb;
  v_seller jsonb;
begin
  select l.id, l.seller_id, l.source_car_id, l.title, l.description,
         l.category, l.subcategory, l.condition, l.grade,
         l.condition_checklist, l.compatibility_notes, l.part_number,
         l.price_cents, l.currency, l.shipping_cents, l.allows_collection
    into v_listing
    from public.listings l
   where l.id = p_listing_id;

  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'make', f.make, 'model', f.model,
             'year_start', f.year_start, 'year_end', f.year_end
           ) order by f.make, f.model, f.year_start
         ), '[]'::jsonb)
    into v_fitment
    from public.listing_fitments f
   where f.listing_id = p_listing_id;

  select coalesce(jsonb_agg(pn.number order by pn.created_at), '[]'::jsonb)
    into v_alt_numbers
    from public.listing_part_numbers pn
   where pn.listing_id = p_listing_id;

  select jsonb_strip_nulls(jsonb_build_object(
           'id', c.id, 'name', c.name,
           'year', c.year, 'make', c.make, 'model', c.model
         ))
    into v_car
    from public.cars c
   where c.id = v_listing.source_car_id;

  select jsonb_strip_nulls(jsonb_build_object(
           'id', p.id,
           'username', p.username,
           'display_name', p.display_name,
           'profile_type', p.profile_type
         ))
    into v_seller
    from public.profiles p
   where p.id = v_listing.seller_id;

  return jsonb_strip_nulls(jsonb_build_object(
    'version', 1,
    'captured_at', now(),
    'listing', jsonb_build_object(
      'id', v_listing.id,
      'title', v_listing.title,
      'description', v_listing.description,
      'category', v_listing.category,
      'subcategory', v_listing.subcategory
    ),
    'part', jsonb_build_object(
      'part_number', v_listing.part_number,
      'alt_part_numbers', v_alt_numbers
    ),
    'condition', jsonb_build_object(
      'condition', v_listing.condition,
      'grade', v_listing.grade,
      'checklist', v_listing.condition_checklist,
      'compatibility_notes', v_listing.compatibility_notes
    ),
    'fitment', v_fitment,
    'source_car', v_car,
    'commercial', jsonb_build_object(
      'price_cents', p_price_cents,
      'listing_price_cents', v_listing.price_cents,
      'currency', v_listing.currency,
      'shipping_cents', p_shipping_cents,
      -- Only flat seller-arranged shipping exists today; the shipping domain
      -- (brief §8+) extends this value set rather than this shape.
      'shipping_mode', 'seller_arranged',
      'allows_collection', v_listing.allows_collection,
      -- No shop return policies exist yet (brief §34/§37); the writer starts
      -- recording them here once shop_profiles land. Absent key = none.
      'return_policy', null
    ),
    'seller', v_seller
  ));
end;
$$;

revoke all on function public.listing_commercial_snapshot(uuid, int, int)
  from public, anon, authenticated;

-- ============================================================
-- 3. Purchase-time trigger — supersedes 0024's condition-only trigger
-- ============================================================
create or replace function public.snapshot_order_item_purchase()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 0024 behaviour, preserved verbatim: the condition contract that dispute
  -- adjudication already reads.
  if new.listing_id is not null and new.condition_snapshot is null then
    select jsonb_strip_nulls(
             jsonb_build_object(
               'condition', l.condition,
               'grade', l.grade,
               'checklist', l.condition_checklist,
               'compatibility_notes', l.compatibility_notes
             )
           )
      into new.condition_snapshot
      from public.listings l
     where l.id = new.listing_id;
  end if;

  if new.commercial_snapshot is null and new.listing_id is not null then
    new.commercial_snapshot := public.listing_commercial_snapshot(
      new.listing_id, new.price_cents, new.shipping_cents
    );
  end if;

  -- Live order paths always insert with an existing listing, so this branch
  -- is a safety net, not a code path: freeze what the row itself carries
  -- rather than let a NOT NULL violation abort a checkout.
  if new.commercial_snapshot is null then
    new.commercial_snapshot := jsonb_build_object(
      'version', 1,
      'captured_at', now(),
      'degraded', true,
      'listing', jsonb_strip_nulls(jsonb_build_object('id', new.listing_id, 'title', new.title)),
      'commercial', jsonb_build_object(
        'price_cents', new.price_cents,
        'shipping_cents', new.shipping_cents,
        'quantity', new.quantity
      )
    );
  end if;

  new.snapshot_version := coalesce(new.snapshot_version, 1);
  return new;
end;
$$;

drop trigger if exists order_items_condition_snapshot on public.order_items;
drop trigger if exists order_items_purchase_snapshot on public.order_items;
create trigger order_items_purchase_snapshot
  before insert on public.order_items
  for each row execute function public.snapshot_order_item_purchase();

-- The 0024 function is no longer wired to anything; keep the catalog clean.
drop function if exists public.snapshot_order_item_condition();

-- Gallery freeze runs AFTER insert (needs the order_item id).
create or replace function public.snapshot_order_item_images()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.listing_id is not null then
    insert into public.order_item_snapshot_images (order_item_id, url, alt, position)
    select new.id, li.url, li.alt, coalesce(li.position, 0)
      from public.listing_images li
     where li.listing_id = new.listing_id;
  end if;
  return null;
end;
$$;

drop trigger if exists order_items_snapshot_images on public.order_items;
create trigger order_items_snapshot_images
  after insert on public.order_items
  for each row execute function public.snapshot_order_item_images();

-- ============================================================
-- 4. Backfill, then tighten to NOT NULL
-- ============================================================
-- Best-available truth for pre-0049 rows: the live listing where it still
-- exists (flagged backfilled — this is today's content, not provably
-- purchase-time), otherwise the columns the row already froze (degraded).
update public.order_items oi
   set commercial_snapshot = coalesce(
         public.listing_commercial_snapshot(oi.listing_id, oi.price_cents, oi.shipping_cents)
           || jsonb_build_object('backfilled', true),
         jsonb_build_object(
           'version', 1,
           'captured_at', now(),
           'backfilled', true,
           'degraded', true,
           'listing', jsonb_strip_nulls(jsonb_build_object('id', oi.listing_id, 'title', oi.title)),
           'condition', coalesce(oi.condition_snapshot, '{}'::jsonb),
           'commercial', jsonb_build_object(
             'price_cents', oi.price_cents,
             'shipping_cents', oi.shipping_cents,
             'quantity', oi.quantity
           )
         )
       ),
       snapshot_version = 1
 where oi.commercial_snapshot is null;

-- Freeze current galleries for pre-0049 items that have none yet.
insert into public.order_item_snapshot_images (order_item_id, url, alt, position)
select oi.id, li.url, li.alt, coalesce(li.position, 0)
  from public.order_items oi
  join public.listing_images li on li.listing_id = oi.listing_id
 where not exists (
         select 1 from public.order_item_snapshot_images s
          where s.order_item_id = oi.id
       );

alter table public.order_items
  alter column commercial_snapshot set not null;
alter table public.order_items
  alter column snapshot_version set not null,
  alter column snapshot_version set default 1;

-- ============================================================
-- 5. Immutability guards
-- ============================================================
-- Not security definer: pure validation, runs as the caller (0047 precedent).
-- listing_id is deliberately NOT frozen — the FK's ON DELETE SET NULL is an
-- UPDATE on this table and must keep working when a listing is deleted.
create or replace function public.guard_order_item_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.commercial_snapshot is distinct from old.commercial_snapshot
     or new.snapshot_version is distinct from old.snapshot_version
     or (old.condition_snapshot is not null
         and new.condition_snapshot is distinct from old.condition_snapshot)
     or new.price_cents is distinct from old.price_cents
     or new.shipping_cents is distinct from old.shipping_cents
     or new.quantity is distinct from old.quantity
     or new.title is distinct from old.title
     or new.order_id is distinct from old.order_id
  then
    raise exception 'order_items purchase record is immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists order_items_immutable on public.order_items;
create trigger order_items_immutable
  before update on public.order_items
  for each row execute function public.guard_order_item_immutable();

create or replace function public.guard_snapshot_image_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'order_item_snapshot_images rows are immutable'
    using errcode = '42501';
end;
$$;

drop trigger if exists order_item_snapshot_images_immutable on public.order_item_snapshot_images;
create trigger order_item_snapshot_images_immutable
  before update on public.order_item_snapshot_images
  for each row execute function public.guard_snapshot_image_immutable();

-- ============================================================
-- 6. RLS — reads mirror order_items; writes are trigger/service-role only
-- ============================================================
alter table public.order_item_snapshot_images enable row level security;
revoke all on public.order_item_snapshot_images from anon, authenticated;
grant select on public.order_item_snapshot_images to authenticated;

drop policy if exists "participants read snapshot images" on public.order_item_snapshot_images;
create policy "participants read snapshot images" on public.order_item_snapshot_images for select
  using (exists (
    select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where oi.id = order_item_id
       and (auth.uid() in (o.buyer_id, o.seller_id) or public.is_admin())
  ));

-- ============================================================
-- Self-checks
-- ============================================================
do $$
declare
  v_count int;
begin
  if to_regclass('public.order_item_snapshot_images') is null then
    raise exception '0049: order_item_snapshot_images missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_items'
      and column_name = 'commercial_snapshot' and is_nullable = 'NO'
  ) then
    raise exception '0049: order_items.commercial_snapshot missing or nullable';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'order_items_purchase_snapshot'
      and tgrelid = 'public.order_items'::regclass
  ) then
    raise exception '0049: order_items_purchase_snapshot trigger missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'order_items_snapshot_images'
      and tgrelid = 'public.order_items'::regclass
  ) then
    raise exception '0049: order_items_snapshot_images trigger missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'order_items_immutable'
      and tgrelid = 'public.order_items'::regclass
  ) then
    raise exception '0049: order_items_immutable guard missing';
  end if;

  -- 0024's condition trigger must be gone — two snapshot triggers racing on
  -- the same column would be a silent ordering bug.
  if exists (
    select 1 from pg_trigger
    where tgname = 'order_items_condition_snapshot'
      and tgrelid = 'public.order_items'::regclass
  ) then
    raise exception '0049: superseded order_items_condition_snapshot still present';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'order_item_snapshot_images'
      and policyname = 'participants read snapshot images'
  ) then
    raise exception '0049: snapshot images read policy missing';
  end if;

  select count(*) into v_count from public.order_items where commercial_snapshot is null;
  if v_count > 0 then
    raise exception '0049: % order_items row(s) missing commercial_snapshot after backfill', v_count;
  end if;

  raise notice 'PASS: 0049 self-checks';
end $$;

commit;
