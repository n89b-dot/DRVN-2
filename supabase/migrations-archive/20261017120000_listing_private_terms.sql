-- 20261017120000 — a seller's offer minimum moves somewhere only they can read
-- (A0, step one of three: expand).
--
-- listings.offer_floor_cents is the lowest offer a seller will take. It is
-- meant to be private, but listings is readable table-wide by anon and
-- authenticated, so anyone could read it straight from the API. A column
-- revoke doesn't help while the table grant stands (cars had to swap its
-- table grant for column grants in 20261004160000), and listings has more
-- readers than cars did: the listing page's select("*") among them. So the
-- minimum moves out to its own table instead.
--
-- The move is three releases so that neither an older app nor a half-run
-- migration ever exposes more, or breaks more, than today:
--   1. expand (this file): listing_private_terms exists and is kept equal to
--      listings.offer_floor_cents on every write, existing rows backfilled.
--      Nothing reads it yet; every current writer keeps working unchanged.
--   2. switch: offer checks, the sell form and the edit page read the new
--      table (sellers through my_listing_offer_floor); the export contract
--      and deletion worker follow; generic refusal copy.
--   3. contract: once the switched app is live everywhere, null and drop
--      listings.offer_floor_cents and this file's mirror trigger.
--
-- Why a trigger rather than editing each writer: the minimum is written by
-- save_listing_creation, update_listing_atomic, guard_offer_insert's reads,
-- the garage "list it" action and service-role tools. A trigger on listings
-- keeps the copy in step for all of them, including any not found here,
-- without restating any of those functions in the expand step. It is dropped
-- in step 3, when the private table becomes the only home.
--
-- Access: no grants to anon or authenticated, row-level security on with no
-- policies, so the table is unreadable and unwritable from the API. The
-- owner reads through my_listing_offer_floor(listing), which answers only the
-- listing's seller (the my_car_vin pattern). offer_floor_privacy_guard.sql
-- checks all of it.
-- Idempotent.

begin;

create table if not exists public.listing_private_terms (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  offer_floor_cents integer,
  updated_at timestamptz not null default now(),
  constraint listing_private_terms_floor_positive check (offer_floor_cents is null or offer_floor_cents > 0)
);

comment on table public.listing_private_terms is
  'Listing terms only the seller (and the offer checks) may read. Replaces listings.offer_floor_cents (expand step, 20261017120000).';
comment on column public.listing_private_terms.offer_floor_cents is
  'The lowest offer the seller will accept. Never shown to buyers. Bounded by the listing price on listings until the contract step.';

create index if not exists listing_private_terms_seller_idx on public.listing_private_terms(seller_id);

alter table public.listing_private_terms enable row level security;
revoke all on public.listing_private_terms from public, anon, authenticated;
grant all on public.listing_private_terms to service_role;

-- Keeps the private copy equal to listings.offer_floor_cents. A row exists
-- for every listing so a later reader never has to tell "no minimum" from
-- "not copied yet".
create or replace function public.mirror_listing_private_terms()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  insert into public.listing_private_terms(listing_id, seller_id, offer_floor_cents, updated_at)
  values (new.id, new.seller_id, new.offer_floor_cents, now())
  on conflict (listing_id) do update
    set seller_id = excluded.seller_id,
        offer_floor_cents = excluded.offer_floor_cents,
        updated_at = excluded.updated_at
  where listing_private_terms.seller_id is distinct from excluded.seller_id
     or listing_private_terms.offer_floor_cents is distinct from excluded.offer_floor_cents;
  return null;
end;
$function$;

revoke all on function public.mirror_listing_private_terms() from public, anon, authenticated;

drop trigger if exists listings_mirror_private_terms on public.listings;
create trigger listings_mirror_private_terms
  after insert or update of offer_floor_cents, seller_id on public.listings
  for each row execute function public.mirror_listing_private_terms();

-- Backfill every existing listing, with or without a minimum.
insert into public.listing_private_terms(listing_id, seller_id, offer_floor_cents)
select l.id, l.seller_id, l.offer_floor_cents
from public.listings l
on conflict (listing_id) do update
  set offer_floor_cents = excluded.offer_floor_cents,
      seller_id = excluded.seller_id,
      updated_at = now()
where listing_private_terms.offer_floor_cents is distinct from excluded.offer_floor_cents
   or listing_private_terms.seller_id is distinct from excluded.seller_id;

-- The seller's own minimum, and nobody else's.
create or replace function public.my_listing_offer_floor(p_listing uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select t.offer_floor_cents
  from public.listing_private_terms t
  where t.listing_id = p_listing and t.seller_id = auth.uid();
$function$;

comment on function public.my_listing_offer_floor(uuid) is
  'Returns a listing''s offer minimum to its seller; null for anyone else.';

revoke all on function public.my_listing_offer_floor(uuid) from public, anon;
grant execute on function public.my_listing_offer_floor(uuid) to authenticated, service_role;

commit;
