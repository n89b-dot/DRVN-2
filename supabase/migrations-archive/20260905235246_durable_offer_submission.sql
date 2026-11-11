begin;

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

create unique index offers_one_live_buyer_listing
  on public.offers(listing_id,buyer_id)
  where status in ('open','countered');

-- One invoker-rights statement owns the offer and its optional opening
-- message. RLS plus the existing offer/message guards still apply. The
-- client-provided offer id is the immutable retry identity; the same UUID is
-- also safe as the opening message id because the tables have separate keys.
create function public.create_offer_with_message(
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
commit;
