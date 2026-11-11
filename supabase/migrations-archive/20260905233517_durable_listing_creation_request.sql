begin;

-- A listing form keeps one UUID for its lifetime. The server freezes the
-- normalized payload against that UUID before inserting anything, so a lost
-- Server Action response can retry the same listing instead of creating a
-- second one. This ledger is private: authenticated callers may use the two
-- narrow functions but cannot read or rewrite another request directly.
create table private.listing_creation_requests (
  seller_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  listing_id uuid not null unique default gen_random_uuid(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (seller_id, request_id)
);

alter table private.listing_creation_requests enable row level security;
revoke all on private.listing_creation_requests from public, anon, authenticated;

create function public.claim_listing_creation(p_request uuid, p_payload_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_request private.listing_creation_requests%rowtype;
  v_inserted integer;
begin
  if v_actor is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not exists (
       select 1 from public.profiles p
       where p.id = v_actor and p.suspended_at is null
     )
     or not private.beta_member_eligible(v_actor, 'seller') then
    raise exception 'Selling is unavailable for this account' using errcode = '42501';
  end if;
  if p_request is null or coalesce(p_payload_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid listing creation request' using errcode = '22023';
  end if;

  insert into private.listing_creation_requests(seller_id, request_id, payload_hash)
  values(v_actor, p_request, p_payload_hash)
  on conflict(seller_id, request_id) do nothing;
  get diagnostics v_inserted = row_count;

  select * into strict v_request
  from private.listing_creation_requests
  where seller_id = v_actor and request_id = p_request
  for update;

  if v_request.payload_hash <> p_payload_hash then
    raise exception 'Listing request was already used with different details'
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'listing_id', v_request.listing_id,
    'completed', v_request.completed_at is not null,
    'fresh', v_inserted = 1
  );
end;
$$;

create function public.complete_listing_creation(
  p_request uuid,
  p_payload_hash text,
  p_listing uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not exists (
       select 1 from public.profiles p
       where p.id = v_actor and p.suspended_at is null
     ) then
    raise exception 'Account unavailable' using errcode = '42501';
  end if;

  update private.listing_creation_requests r
  set completed_at = coalesce(r.completed_at, now())
  where r.seller_id = v_actor
    and r.request_id = p_request
    and r.payload_hash = p_payload_hash
    and r.listing_id = p_listing
    and exists (
      select 1 from public.listings l
      where l.id = p_listing and l.seller_id = v_actor
    );

  if not found then
    raise exception 'Listing creation request does not match the listing'
      using errcode = '22023';
  end if;
  return true;
end;
$$;

-- A first attempt that fails admission must not become a free "recovery" on
-- its next click. Remove only this caller's unused pending claim; the row lock
-- and NOT EXISTS check prevent racing a listing save that has begun.
create function public.discard_listing_creation(p_request uuid, p_payload_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'Sign in first' using errcode='42501'; end if;
  delete from private.listing_creation_requests r
  where r.seller_id=v_actor and r.request_id=p_request
    and r.payload_hash=p_payload_hash and r.completed_at is null
    and not exists(select 1 from public.listings l where l.id=r.listing_id);
  return found;
end;
$$;

-- The listing and every projection visible to a buyer commit together. The
-- invoker's RLS remains in force; the narrow definer functions above only
-- inspect/update the caller's private request record. The advisory lock spans
-- this transaction, serializing concurrent delivery of the same request.
create function public.save_listing_creation(
  p_request uuid,
  p_payload_hash text,
  p_listing jsonb,
  p_images jsonb,
  p_fitments jsonb,
  p_alt_numbers jsonb,
  p_mod_item uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_claim jsonb;
  v_id uuid;
  v_existing public.listings%rowtype;
  v_status text;
begin
  if v_actor is null then raise exception 'Sign in first' using errcode='42501'; end if;
  if jsonb_typeof(p_listing) is distinct from 'object'
     or jsonb_typeof(p_images) is distinct from 'array'
     or jsonb_typeof(p_fitments) is distinct from 'array'
     or jsonb_typeof(p_alt_numbers) is distinct from 'array'
     or jsonb_array_length(p_images) > 12
     or jsonb_array_length(p_fitments) > 10
     or jsonb_array_length(p_alt_numbers) > 5 then
    raise exception 'Invalid listing projection' using errcode='22023';
  end if;
  v_status := p_listing->>'status';
  if v_status not in ('draft','active') then
    raise exception 'Invalid initial listing status' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || p_request::text, 0));
  v_claim := public.claim_listing_creation(p_request,p_payload_hash);
  v_id := (v_claim->>'listing_id')::uuid;
  if (v_claim->>'completed')::boolean then
    return jsonb_build_object('listing_id',v_id,'completed',true,'replayed',true);
  end if;

  insert into public.listings(
    id,seller_id,source_car_id,title,description,category,subcategory,condition,
    grade,condition_checklist,price_cents,shipping_cents,shipping_mode,
    weight_oz,length_in,width_in,height_in,offer_floor_cents,allows_collection,
    location,compatibility_notes,part_number,status
  ) values (
    v_id,v_actor,nullif(p_listing->>'source_car_id','')::uuid,
    p_listing->>'title',nullif(p_listing->>'description',''),p_listing->>'category',
    nullif(p_listing->>'subcategory',''),nullif(p_listing->>'condition',''),
    nullif(p_listing->>'grade',''),nullif(p_listing->'condition_checklist','null'::jsonb),
    (p_listing->>'price_cents')::integer,(p_listing->>'shipping_cents')::integer,
    p_listing->>'shipping_mode',nullif(p_listing->>'weight_oz','')::numeric,
    nullif(p_listing->>'length_in','')::numeric,nullif(p_listing->>'width_in','')::numeric,
    nullif(p_listing->>'height_in','')::numeric,nullif(p_listing->>'offer_floor_cents','')::integer,
    (p_listing->>'allows_collection')::boolean,nullif(p_listing->>'location',''),
    nullif(p_listing->>'compatibility_notes',''),nullif(p_listing->>'part_number',''),v_status
  ) on conflict(id) do nothing;

  select * into strict v_existing from public.listings where id=v_id for update;
  if v_existing.seller_id is distinct from v_actor
     or v_existing.source_car_id is distinct from nullif(p_listing->>'source_car_id','')::uuid
     or v_existing.title is distinct from p_listing->>'title'
     or v_existing.description is distinct from nullif(p_listing->>'description','')
     or v_existing.category is distinct from p_listing->>'category'
     or v_existing.subcategory is distinct from nullif(p_listing->>'subcategory','')
     or v_existing.condition is distinct from nullif(p_listing->>'condition','')
     or v_existing.grade is distinct from nullif(p_listing->>'grade','')
     or v_existing.condition_checklist is distinct from nullif(p_listing->'condition_checklist','null'::jsonb)
     or v_existing.price_cents is distinct from (p_listing->>'price_cents')::integer
     or v_existing.shipping_cents is distinct from (p_listing->>'shipping_cents')::integer
     or v_existing.shipping_mode is distinct from p_listing->>'shipping_mode'
     or v_existing.weight_oz is distinct from nullif(p_listing->>'weight_oz','')::numeric
     or v_existing.length_in is distinct from nullif(p_listing->>'length_in','')::numeric
     or v_existing.width_in is distinct from nullif(p_listing->>'width_in','')::numeric
     or v_existing.height_in is distinct from nullif(p_listing->>'height_in','')::numeric
     or v_existing.offer_floor_cents is distinct from nullif(p_listing->>'offer_floor_cents','')::integer
     or v_existing.allows_collection is distinct from (p_listing->>'allows_collection')::boolean
     or v_existing.location is distinct from nullif(p_listing->>'location','')
     or v_existing.compatibility_notes is distinct from nullif(p_listing->>'compatibility_notes','')
     or v_existing.part_number is distinct from nullif(p_listing->>'part_number','')
     or v_existing.status is distinct from v_status then
    raise exception 'Listing changed after this request began; refresh before continuing'
      using errcode='40001';
  end if;

  delete from public.listing_images where listing_id=v_id;
  insert into public.listing_images(listing_id,url,alt,position)
  select v_id,item->>'url',nullif(item->>'alt',''),ordinality-1
  from jsonb_array_elements(p_images) with ordinality as image(item,ordinality);

  delete from public.listing_fitments where listing_id=v_id;
  insert into public.listing_fitments(listing_id,make,model,year_start,year_end)
  select v_id,item->>'make',item->>'model',nullif(item->>'year_start','')::integer,
         nullif(item->>'year_end','')::integer
  from jsonb_array_elements(p_fitments) as fitment(item);

  delete from public.listing_part_numbers where listing_id=v_id;
  insert into public.listing_part_numbers(listing_id,number)
  select v_id,value from jsonb_array_elements_text(p_alt_numbers) as number(value);

  if p_mod_item is not null and v_existing.source_car_id is not null then
    update public.mod_items m set linked_listing_id=v_id
    where m.id=p_mod_item and m.car_id=v_existing.source_car_id
      and exists(select 1 from public.cars c where c.id=m.car_id and c.owner_id=v_actor);
    if not found then
      raise exception 'Build line does not belong to this listing source car' using errcode='42501';
    end if;
  end if;

  perform public.complete_listing_creation(p_request,p_payload_hash,v_id);
  return jsonb_build_object('listing_id',v_id,'completed',true,'replayed',false);
end;
$$;

revoke all on function public.claim_listing_creation(uuid,text) from public, anon;
revoke all on function public.complete_listing_creation(uuid,text,uuid) from public, anon;
revoke all on function public.discard_listing_creation(uuid,text) from public, anon;
revoke all on function public.save_listing_creation(uuid,text,jsonb,jsonb,jsonb,jsonb,uuid) from public, anon;
grant execute on function public.claim_listing_creation(uuid,text) to authenticated;
grant execute on function public.complete_listing_creation(uuid,text,uuid) to authenticated;
grant execute on function public.discard_listing_creation(uuid,text) to authenticated;
grant execute on function public.save_listing_creation(uuid,text,jsonb,jsonb,jsonb,jsonb,uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
