-- 20261017150000 — every offer move becomes a recorded round (A1, step one:
-- expand; docs/decisions/negotiation-v2.md).
--
-- Today an offer is one row whose columns say how far it got: the buyer's
-- amount, at most one seller counter, and how it ended. Negotiation v2 needs
-- a history of moves (counter-backs, the 3-offers-per-listing limit, each
-- round's binding terms), so this adds it underneath without changing how
-- offers behave:
--   * offer_rounds: one row per move, numbered per offer. The buyer and the
--     listing's seller can read their own offers' rounds; nobody can write
--     them from the API.
--   * offer_round_terms: the limits in force when a round was issued (the
--     seller's effective minimum, and from A3b a buyer agent's ceiling). Private
--     on the listing_private_terms pattern: no client grants at all.
--   * A trigger records a round for every move today's code makes: the
--     opening offer, the seller's counter, accept, decline, withdraw and
--     expiry. Step two replaces it with offer_move, which writes rounds
--     itself.
--   * A backfill turns each existing offer's columns into its rounds. Terms
--     can't be recovered for past rounds, so they have none.
-- Agent columns (task, job, mandate version) arrive in A2.
-- Idempotent.

begin;

create table if not exists public.offer_rounds (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers(id) on delete cascade,
  round_no integer not null check (round_no > 0),
  listing_id uuid not null references public.listings(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  actor_role text not null check (actor_role in ('buyer', 'seller', 'system')),
  kind text not null check (kind in ('offer', 'counter', 'accept', 'decline', 'withdraw', 'expire', 'below_minimum')),
  amount_cents integer check (amount_cents is null or amount_cents > 0),
  expires_at timestamptz,
  actor_member_id uuid references public.profiles(id) on delete set null,
  idempotency_key text,
  created_at timestamptz not null default now(),
  unique (offer_id, round_no)
);

comment on table public.offer_rounds is
  'One row per negotiation move (20261017150000). Append-only; written by triggers now and by offer_move from A1 step two.';

create index if not exists offer_rounds_listing_buyer_idx on public.offer_rounds(listing_id, buyer_id);
create unique index if not exists offer_rounds_idempotency_key
  on public.offer_rounds(actor_member_id, idempotency_key) where idempotency_key is not null;

alter table public.offer_rounds enable row level security;
revoke all on public.offer_rounds from public, anon, authenticated;
grant select on public.offer_rounds to authenticated;
grant all on public.offer_rounds to service_role;

drop policy if exists "participants read offer rounds" on public.offer_rounds;
create policy "participants read offer rounds" on public.offer_rounds
  for select to authenticated
  using (
    buyer_id = (select auth.uid())
    or exists (select 1 from public.listings l where l.id = offer_rounds.listing_id and l.seller_id = (select auth.uid()))
    or (select public.is_admin())
  );

create table if not exists public.offer_round_terms (
  round_id uuid primary key references public.offer_rounds(id) on delete cascade,
  effective_floor_cents integer check (effective_floor_cents is null or effective_floor_cents > 0),
  created_at timestamptz not null default now()
);

comment on table public.offer_round_terms is
  'The limits in force when a round was issued (binding snapshot). Private: no client grants.';

alter table public.offer_round_terms enable row level security;
revoke all on public.offer_round_terms from public, anon, authenticated;
grant all on public.offer_round_terms to service_role;

-- Records the move today's code just made. Fires after the offer row is
-- written, so a move and its round commit together.
create or replace function public.record_offer_round()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_seller uuid;
  v_kind text;
  v_role text;
  v_actor uuid;
  v_amount integer;
  v_expires timestamptz;
  v_round uuid;
  v_no integer;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  select l.seller_id into v_seller from public.listings l where l.id = new.listing_id;

  if tg_op = 'INSERT' then
    v_kind := 'offer'; v_role := 'buyer'; v_actor := new.buyer_id;
    v_amount := new.amount_cents; v_expires := new.expires_at;
  elsif new.status = 'countered' then
    v_kind := 'counter'; v_role := 'seller'; v_actor := v_seller;
    v_amount := new.counter_amount_cents; v_expires := new.expires_at;
  elsif new.status = 'accepted' then
    -- The seller accepts the buyer's amount; the buyer accepts a counter.
    v_kind := 'accept';
    if old.status = 'countered' then v_role := 'buyer'; v_actor := new.buyer_id;
    else v_role := 'seller'; v_actor := v_seller; end if;
    v_amount := coalesce(new.counter_amount_cents, new.amount_cents);
  elsif new.status = 'declined' then
    v_kind := 'decline'; v_role := 'seller'; v_actor := v_seller;
  elsif new.status = 'withdrawn' then
    v_kind := 'withdraw'; v_role := 'buyer'; v_actor := new.buyer_id;
  elsif new.status = 'expired' then
    v_kind := 'expire'; v_role := 'system'; v_actor := null;
  else
    return null;
  end if;

  -- One writer per offer at a time: the offer row is already locked by the
  -- statement that fired this trigger.
  select coalesce(max(r.round_no), 0) + 1 into v_no from public.offer_rounds r where r.offer_id = new.id;
  insert into public.offer_rounds(offer_id, round_no, listing_id, buyer_id, actor_role, kind, amount_cents, expires_at, actor_member_id)
  values (new.id, v_no, new.listing_id, new.buyer_id, v_role, v_kind, v_amount, v_expires, v_actor)
  returning id into v_round;

  -- A proposal (opening offer or counter) keeps the seller's minimum in force
  -- at the time, so a later change can't rewrite what was agreed.
  if v_kind in ('offer', 'counter') then
    insert into public.offer_round_terms(round_id, effective_floor_cents)
    select v_round, t.offer_floor_cents from public.listing_private_terms t where t.listing_id = new.listing_id;
  end if;
  return null;
end;
$function$;

revoke all on function public.record_offer_round() from public, anon, authenticated;

drop trigger if exists offers_record_round on public.offers;
create trigger offers_record_round
  after insert or update of status on public.offers
  for each row execute function public.record_offer_round();

-- Backfill: rebuild each existing offer's rounds from its columns. Only
-- offers with no rounds yet, so a re-run adds nothing.
insert into public.offer_rounds(offer_id, round_no, listing_id, buyer_id, actor_role, kind, amount_cents, expires_at, actor_member_id, created_at)
select o.id, 1, o.listing_id, o.buyer_id, 'buyer', 'offer', o.amount_cents, o.expires_at, o.buyer_id, o.created_at
from public.offers o
where not exists (select 1 from public.offer_rounds r where r.offer_id = o.id);

insert into public.offer_rounds(offer_id, round_no, listing_id, buyer_id, actor_role, kind, amount_cents, expires_at, actor_member_id, created_at)
select o.id, 2, o.listing_id, o.buyer_id, 'seller', 'counter', o.counter_amount_cents, o.expires_at, l.seller_id, o.countered_at
from public.offers o join public.listings l on l.id = o.listing_id
where o.countered_at is not null and o.counter_amount_cents is not null
  and not exists (select 1 from public.offer_rounds r where r.offer_id = o.id and r.round_no > 1);

insert into public.offer_rounds(offer_id, round_no, listing_id, buyer_id, actor_role, kind, amount_cents, expires_at, actor_member_id, created_at)
select o.id,
       case when o.countered_at is not null and o.counter_amount_cents is not null then 3 else 2 end,
       o.listing_id, o.buyer_id,
       case o.status when 'withdrawn' then 'buyer' when 'expired' then 'system'
                     when 'accepted' then case when o.counter_amount_cents is not null then 'buyer' else 'seller' end
                     else 'seller' end,
       case o.status when 'accepted' then 'accept' when 'declined' then 'decline' when 'withdrawn' then 'withdraw' else 'expire' end,
       case when o.status = 'accepted' then coalesce(o.counter_amount_cents, o.amount_cents) end,
       null,
       case o.status when 'withdrawn' then o.buyer_id when 'expired' then null
                     when 'accepted' then case when o.counter_amount_cents is not null then o.buyer_id else l.seller_id end
                     else l.seller_id end,
       coalesce(o.responded_at, o.updated_at)
from public.offers o join public.listings l on l.id = o.listing_id
where o.status in ('accepted', 'declined', 'withdrawn', 'expired')
  and not exists (select 1 from public.offer_rounds r where r.offer_id = o.id and r.kind in ('accept', 'decline', 'withdraw', 'expire'));

commit;
