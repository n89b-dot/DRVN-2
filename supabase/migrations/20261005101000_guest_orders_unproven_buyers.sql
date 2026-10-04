-- 20261005101000 — a buyer can only be reviewed for an order they placed.
--
-- Guest checkout resolves the typed email to an account and places the order
-- under it. Typing an address proves nothing, so an order can belong to an
-- account whose owner never placed it — and the seller of that order could
-- then review "the buyer", putting a rating on someone else's profile. With a
-- registered member's email that was a pay-to-smear: buy something cheap as a
-- guest with their address, and a colluding seller rates them.
--
-- Two halves. The app (src/features/commerce/guest-buyer.ts) no longer
-- places a guest order under an account whose owner has proven the address;
-- it asks them to sign in instead. And here, in the database, an order whose
-- buyer had not proven the address when it was placed is recorded as such,
-- and the seller can't review the buyer on it. The buyer can still review
-- the seller once they've claimed the order through the emailed link.
--
-- "Proven" is auth.users.confirmed_at: set when an address is confirmed (a
-- confirmation or magic link, OAuth, or auto-confirm in development) and
-- never for an account guest checkout created. It is snapshotted when the
-- order is inserted, so a later claim doesn't retroactively make an order the
-- claimer may not have placed reviewable. Existing orders are backfilled from
-- the same rule: the buyer had no confirmed address at the order's creation.
-- (Orders a guest attached to an already-confirmed member before this release
-- can't be told apart from the member's own; they stay reviewable.)
--
-- Idempotent: create-if-not-exists, create or replace, drop-if-exists.

begin;

create table if not exists private.unproven_buyer_orders (
  order_id uuid primary key references public.orders (id) on delete cascade,
  buyer_id uuid not null,
  recorded_at timestamptz not null default now()
);
alter table private.unproven_buyer_orders enable row level security;
revoke all on private.unproven_buyer_orders from public, anon, authenticated;

comment on table private.unproven_buyer_orders is
  'Orders whose buyer had not proven their email when the order was placed (guest checkout). The seller cannot review the buyer on these.';

-- Snapshot at insert. Orders are only ever written by the purchase RPCs.
create or replace function private.record_unproven_buyer_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.buyer_id is not null and not exists (
    select 1 from auth.users u where u.id = new.buyer_id and u.confirmed_at is not null
  ) then
    insert into private.unproven_buyer_orders (order_id, buyer_id)
    values (new.id, new.buyer_id)
    on conflict (order_id) do nothing;
  end if;
  return null;
end;
$$;
revoke all on function private.record_unproven_buyer_order() from public, anon, authenticated;

drop trigger if exists orders_record_unproven_buyer on public.orders;
create trigger orders_record_unproven_buyer
  after insert on public.orders
  for each row execute function private.record_unproven_buyer_order();

insert into private.unproven_buyer_orders (order_id, buyer_id)
select o.id, o.buyer_id
from public.orders o
left join auth.users u on u.id = o.buyer_id
where o.buyer_id is not null
  and (u.confirmed_at is null or u.confirmed_at > o.created_at)
on conflict (order_id) do nothing;

-- Enforced on insert for every writer, the service role included. The
-- reviewee can't be changed afterwards (guard_review_columns, 0012).
create or replace function private.refuse_review_of_unproven_buyer()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from private.unproven_buyer_orders p
    where p.order_id = new.order_id and p.buyer_id = new.reviewee_id
  ) then
    raise exception 'This buyer checked out as a guest, so they can''t be reviewed on this order'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.refuse_review_of_unproven_buyer() from public, anon, authenticated;

drop trigger if exists reviews_refuse_unproven_buyer on public.reviews;
create trigger reviews_refuse_unproven_buyer
  before insert on public.reviews
  for each row execute function private.refuse_review_of_unproven_buyer();

-- For the order page: whether the seller's "review the buyer" form should be
-- offered. Answers only a party to the order; null for anyone else.
create or replace function public.order_buyer_reviewable(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (select 1 from private.unproven_buyer_orders p where p.order_id = o.id)
  from public.orders o
  where o.id = p_order and auth.uid() in (o.buyer_id, o.seller_id);
$$;
revoke all on function public.order_buyer_reviewable(uuid) from public, anon;
grant execute on function public.order_buyer_reviewable(uuid) to authenticated, service_role;

commit;
