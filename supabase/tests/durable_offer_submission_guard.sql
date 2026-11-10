-- Opening an offer and its first message commit together, replay exactly and
-- refuse a changed retry (offer_open since the contract, 20261019120000).
begin;

insert into auth.users(id,email) values
  ('10000000-0000-4000-8000-000000000001','offer-atomic-seller@drvn.test'),
  ('10000000-0000-4000-8000-000000000002','offer-atomic-buyer@drvn.test');
insert into public.listings(id,seller_id,title,category,price_cents,shipping_cents,currency,status)
values(
  '20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  'Atomic offer fixture','engine',10000,0,'USD','active'
);

create function pg_temp.fail_opening_offer_message() returns trigger language plpgsql as $$
begin
  if new.body='[force-offer-message-failure]' then raise exception 'forced opening message failure'; end if;
  return new;
end $$;

-- This guard's own helpers are called while acting as other roles. A new
-- function is closed by default (20261110170000), so they are opened here.
grant execute on all routines in schema pg_temp to public;
create trigger force_opening_offer_message_failure before insert on public.messages
for each row execute function pg_temp.fail_opening_offer_message();

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);

do $$
declare result jsonb; refused boolean;
begin
  refused:=false;
  begin
    perform public.offer_open(
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',9000,'[force-offer-message-failure]'
    );
  exception when others then refused:=true; end;
  if not refused or exists(select 1 from public.offers where id='30000000-0000-4000-8000-000000000001') then
    raise exception 'Opening-message failure left a partially-created offer';
  end if;

  result:=public.offer_open(
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',9000,'Can you ship on Friday?'
  );
  if coalesce((result->>'replayed')::boolean,true)
     or not exists(
       select 1 from public.offers where id='30000000-0000-4000-8000-000000000001'
       and buyer_id='10000000-0000-4000-8000-000000000002'
       and listing_id='20000000-0000-4000-8000-000000000001' and amount_cents=9000
     )
     or not exists(
       select 1 from public.messages where id='30000000-0000-4000-8000-000000000001'
       and offer_id='30000000-0000-4000-8000-000000000001'
       and sender_id='10000000-0000-4000-8000-000000000002'
       and recipient_id='10000000-0000-4000-8000-000000000001'
       and body='Can you ship on Friday?'
     ) then raise exception 'Offer and opening message did not commit atomically'; end if;

  result:=public.offer_open(
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',9000,'Can you ship on Friday?'
  );
  if coalesce((result->>'replayed')::boolean,false) is not true
     or (select count(*) from public.offers where id='30000000-0000-4000-8000-000000000001')<>1
     or (select count(*) from public.messages where id='30000000-0000-4000-8000-000000000001')<>1 then
    raise exception 'Exact offer replay duplicated an effect';
  end if;

  refused:=false;
  begin perform public.offer_open(
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',8999,'Can you ship on Friday?'
  ); exception when others then refused:=true; end;
  if not refused then raise exception 'Offer retry accepted a changed amount'; end if;
  refused:=false;
  begin perform public.offer_open(
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',9000,'Changed message'
  ); exception when others then refused:=true; end;
  if not refused then raise exception 'Offer retry accepted a changed message'; end if;

  refused:=false;
  begin perform public.offer_open(
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',8500,null
  ); exception when unique_violation then refused:=true; when others then refused:=true; end;
  if not refused or exists(select 1 from public.offers where id='30000000-0000-4000-8000-000000000002') then
    raise exception 'Different request identity created a second live offer';
  end if;
end $$;

reset role;

do $$
begin
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='offers_one_live_buyer_listing') then
    raise exception 'Live offer uniqueness index is missing';
  end if;
  if has_function_privilege('anon','public.offer_open(uuid,uuid,integer,text)','execute') then
    raise exception 'Anonymous role can invoke offer submission';
  end if;
  -- offer_open replaced it (20261017160000); the contract dropped it (20261019120000).
  if to_regprocedure('public.create_offer_with_message(uuid,uuid,integer,text)') is not null then
    raise exception 'The pre-negotiation-v2 offer submission function is still installed';
  end if;
  raise notice 'all durable offer submission checks passed';
end $$;

rollback;
