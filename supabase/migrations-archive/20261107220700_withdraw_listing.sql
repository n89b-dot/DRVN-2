-- OS-W33 N77 (Neil's ruling, 7 November 2026: "Withdraw, don't delete").
--
-- Deleting a listing silently deleted every buyer's offer on it (offers
-- cascade on listings), with no notice and no history
-- (docs/plans/2026-11-readiness-crosswalk.md N473).
--
-- 1. withdraw_listing(listing): one atomic, seller-authorised step. It takes
--    the listing row first — the same lock order as offer_move_core,
--    offer_open_core and checkout — so it serialises with any offer move or
--    checkout already under way, and refuses a listing that is reserved or
--    sold (the order decides it). Every live offer ends as withdrawn with
--    ended_reason 'listing_withdrawn', a system round records it, each
--    buyer is notified, and the listing is archived: nothing is deleted.
-- 2. A member can no longer DELETE a listing that has offers: the delete is
--    refused (LW409) and the app offers Withdraw. Trusted server paths
--    (account deletion) are unchanged.
--
-- New functions and one new column; nothing existing is redefined.

begin;

alter table public.offers add column if not exists ended_reason text;
alter table public.offers drop constraint if exists offers_ended_reason_check;
alter table public.offers add constraint offers_ended_reason_check
  check (ended_reason is null or (ended_reason = 'listing_withdrawn' and status = 'withdrawn'));

comment on column public.offers.ended_reason is
  'N77: why DRVN ended the offer rather than one of its parties. listing_withdrawn: the seller withdrew the listing.';

create or replace function public.withdraw_listing(p_listing uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_listing public.listings;
  v_offer record;
  v_ended integer := 0;
  v_round uuid;
begin
  if v_uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_listing is null then raise exception 'Missing listing' using errcode = '22023'; end if;

  -- Listing first: the lock every offer move and checkout takes first too.
  select * into v_listing from public.listings where id = p_listing for update;
  if not found or v_listing.seller_id is distinct from v_uid then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;
  if v_listing.status in ('reserved', 'sold') then
    raise exception 'This listing is mid-checkout or sold' using errcode = 'LW423';
  end if;
  if v_listing.status = 'archived' then
    return jsonb_build_object('outcome', 'withdrawn', 'offers_ended', 0, 'replayed', true);
  end if;

  -- The offer rounds below are this function's; the round trigger stays out.
  perform set_config('drvn.offer_move', 'on', true);
  for v_offer in
    select o.id, o.buyer_id, o.round_count from public.offers o
     where o.listing_id = p_listing and o.status in ('open', 'countered')
     order by o.id
     for update
  loop
    insert into public.offer_rounds (offer_id, round_no, listing_id, buyer_id, actor_role, kind, actor_member_id)
    values (v_offer.id, v_offer.round_count + 1, p_listing, v_offer.buyer_id, 'system', 'withdraw', null)
    returning id into v_round;
    update public.offers
       set status = 'withdrawn', ended_reason = 'listing_withdrawn', responded_at = now(),
           round_count = v_offer.round_count + 1, last_round_id = v_round
     where id = v_offer.id;
    perform public.notify(
      v_offer.buyer_id, 'offer_listing_withdrawn', 'marketplace',
      'The seller withdrew this listing', 'Your offer on "' || v_listing.title || '" has ended. Nothing was charged.',
      '/offers/' || v_offer.id, null
    );
    v_ended := v_ended + 1;
  end loop;
  perform set_config('drvn.offer_move', 'off', true);

  update public.listings set status = 'archived' where id = p_listing;
  return jsonb_build_object('outcome', 'withdrawn', 'offers_ended', v_ended, 'replayed', false);
end;
$$;

revoke all on function public.withdraw_listing(uuid) from public, anon;
grant execute on function public.withdraw_listing(uuid) to authenticated;

comment on function public.withdraw_listing(uuid) is
  'N77: the seller withdraws a listing atomically (listing-first lock): live offers end with a listing-withdrawal reason, buyers are told, the listing is archived, nothing is deleted.';

-- A member deleting a listing that has offers would take the buyers'
-- history with it: refuse, and say to withdraw. Invoker, like
-- guard_listing_delete, so is_trusted_writer() sees the real caller; only a
-- listing's seller can delete it, and its seller reads every offer on it.
create or replace function private.guard_listing_delete_history()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if public.is_trusted_writer() then
    return old;
  end if;
  if exists (select 1 from public.offers o where o.listing_id = old.id) then
    raise exception 'This listing has offers. Withdraw it instead, so the buyers keep their history.'
      using errcode = 'LW409';
  end if;
  return old;
end;
$$;

revoke all on function private.guard_listing_delete_history() from public, anon, authenticated;

drop trigger if exists listings_guard_delete_history on public.listings;
create trigger listings_guard_delete_history
  before delete on public.listings
  for each row execute function private.guard_listing_delete_history();

commit;
