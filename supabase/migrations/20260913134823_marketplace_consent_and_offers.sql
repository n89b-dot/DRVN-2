begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Restore the existing consent boundary without changing payment settlement.
create table if not exists public.analytics_consents(user_id uuid primary key references public.profiles(id) on delete cascade,allowed boolean not null default false,version uuid not null default gen_random_uuid(),expires_at timestamptz not null default now()+interval '180 days');
alter table public.analytics_consents enable row level security;
revoke all on public.analytics_consents from public,anon,authenticated;
grant select on public.analytics_consents to authenticated;
grant all on public.analytics_consents to service_role;
drop policy if exists "own analytics preference" on public.analytics_consents;
create policy "own analytics preference" on public.analytics_consents for select to authenticated using(user_id=auth.uid());
create or replace function public.set_analytics_consent(p_allowed boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not public.profile_is_visible(auth.uid()) then raise exception 'Active account required' using errcode='42501'; end if;
 insert into public.analytics_consents(user_id,allowed) values(auth.uid(),p_allowed)
 on conflict(user_id) do update set allowed=p_allowed,version=gen_random_uuid(),expires_at=now()+interval '180 days';
end $$;
revoke all on function public.set_analytics_consent(boolean) from public,anon;
grant execute on function public.set_analytics_consent(boolean) to authenticated;


-- Refuse to guess which user-created offer should survive. This makes a
-- legacy anomaly explicit before installing the concurrent live-offer key.
do $$
begin
  if exists(
    select 1 from public.offers where status in ('open','countered')
    group by listing_id,buyer_id having count(*)>1
  ) then
    raise exception 'Cannot enforce one live offer: duplicate live buyer/listing offers require review';
  end if;
end $$;

create unique index if not exists offers_one_live_buyer_listing
  on public.offers(listing_id,buyer_id)
  where status in ('open','countered');

-- One invoker-rights statement owns the offer and its optional opening
-- message. RLS plus the existing offer/message guards still apply. The
-- client-provided offer id is the immutable retry identity; the same UUID is
-- also safe as the opening message id because the tables have separate keys.
create or replace function public.create_offer_with_message(
  p_offer uuid,p_listing uuid,p_amount integer,p_message text default null
) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare
  actor uuid:=auth.uid();
  listing public.listings;
  existing public.offers;
  opening public.messages;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_offer is null or p_listing is null or p_amount is null or p_amount<=0 or p_amount>100000000 then
    raise exception 'Invalid offer request';
  end if;
  if p_message is not null and (p_message='' or p_message<>btrim(p_message) or length(p_message)>2000) then
    raise exception 'Invalid offer message';
  end if;

  select * into existing from public.offers where id=p_offer;
  if found then
    if existing.buyer_id<>actor or existing.listing_id<>p_listing or existing.amount_cents<>p_amount then
      raise exception 'Offer retry identity changed' using errcode='23505';
    end if;
    select * into opening from public.messages where id=p_offer;
    if p_message is null then
      if found then raise exception 'Offer retry message changed'; end if;
    elsif not found or opening.sender_id<>actor or opening.offer_id<>p_offer
       or opening.listing_id is distinct from p_listing or opening.order_id is not null
       or opening.body<>p_message then
      raise exception 'Offer retry message changed';
    end if;
    return jsonb_build_object('offer_id',existing.id,'replayed',true);
  end if;

  select * into listing from public.listings where id=p_listing;
  if not found or listing.status<>'active' then raise exception 'Listing is not available'; end if;
  if listing.seller_id=actor then raise exception 'Buyer cannot offer on own listing'; end if;
  if listing.shipping_mode='drvn' then raise exception 'Offers are unavailable with rated shipping'; end if;
  if p_amount>listing.price_cents then raise exception 'Offer exceeds asking price'; end if;
  if listing.offer_floor_cents is not null and p_amount<listing.offer_floor_cents then
    raise exception 'Offer is below seller minimum';
  end if;

  insert into public.offers(id,listing_id,buyer_id,amount_cents)
  values(p_offer,p_listing,actor,p_amount)
  returning * into existing;
  if p_message is not null then
    insert into public.messages(
      id,listing_id,offer_id,order_id,sender_id,recipient_id,body
    ) values(p_offer,p_listing,p_offer,null,actor,listing.seller_id,p_message);
  end if;
  return jsonb_build_object('offer_id',existing.id,'replayed',false);
end $$;

revoke all on function public.create_offer_with_message(uuid,uuid,integer,text)
  from public,anon;
grant execute on function public.create_offer_with_message(uuid,uuid,integer,text)
  to authenticated;
notify pgrst,'reload schema';

notify pgrst,'reload schema';
commit;
