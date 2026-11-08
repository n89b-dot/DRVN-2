begin;

create function public.listing_creation_test_fail() returns trigger language plpgsql as $$
begin
  if current_setting('drvn.test_listing_creation_failure',true)='on' then
    raise exception 'Injected listing projection failure';
  end if;
  return new;
end $$;
create trigger listing_creation_test_fail
  before insert on public.listing_images
  for each row execute function public.listing_creation_test_fail();

do $$
declare
  seller uuid := gen_random_uuid();
  other_seller uuid := gen_random_uuid();
  uninvited uuid := gen_random_uuid();
  seller_invite uuid := gen_random_uuid();
  other_invite uuid := gen_random_uuid();
  request_id uuid := gen_random_uuid();
  first_claim jsonb;
  replay_claim jsonb;
  other_claim jsonb;
  atomic_request uuid := gen_random_uuid();
  atomic_claim jsonb;
  failed_request uuid := gen_random_uuid();
  failed_claim jsonb;
  changed_request uuid := gen_random_uuid();
  changed_claim jsonb;
  denied_request uuid := gen_random_uuid();
  denied_claim jsonb;
  saved jsonb;
  listing_payload jsonb := jsonb_build_object(
    'source_car_id',null,'title','Atomic listing','description','Whole projection',
    'category','performance','subcategory',null,'condition','used','grade',null,
    'condition_checklist',null,'price_cents',12500,'shipping_cents',0,
    'shipping_mode','flat','weight_oz',null,'length_in',null,'width_in',null,
    'height_in',null,'offer_floor_cents',null,'allows_collection',false,
    'location',null,'compatibility_notes',null,'part_number','ABC-123','status','draft'
  );
  images_payload jsonb := jsonb_build_array(
    jsonb_build_object('url','https://proj.supabase.co/storage/v1/object/public/listing-images/' || seller || '/one.webp','alt','One'),
    jsonb_build_object('url','https://proj.supabase.co/storage/v1/object/public/listing-images/' || seller || '/two.webp','alt','Two')
  );
  fitments_payload jsonb := jsonb_build_array(
    jsonb_build_object('make','Audi','model','S4','year_start',2018,'year_end',2020)
  );
  numbers_payload jsonb := jsonb_build_array('ABC123','06M 145 722 H');
  rejected boolean := false;
begin
  -- Member photo writes need the storage origin recorded (20261107203000).
  insert into public.job_config(key, value) values ('media_storage_origin', 'https://proj.supabase.co')
    on conflict (key) do update set value = excluded.value;
  update public.beta_access_config set enforced=false where singleton=true;
  insert into auth.users(id,email,raw_user_meta_data)
  values
    (seller,'listing-request-seller@drvn.test','{}'),
    (other_seller,'listing-request-other@drvn.test','{}'),
    (uninvited,'listing-request-uninvited@drvn.test','{}');
  insert into public.beta_invitations(
    id,email_normalized,roles,token_hash,expires_at,consumed_at,consumed_by
  ) values
    (seller_invite,'listing-request-seller@drvn.test',array['seller'],repeat('1',64),now()+interval '1 hour',now(),seller),
    (other_invite,'listing-request-other@drvn.test',array['seller'],repeat('2',64),now()+interval '1 hour',now(),other_seller);
  insert into public.beta_memberships(user_id,invitation_id,email_normalized,roles)
  values
    (seller,seller_invite,'listing-request-seller@drvn.test',array['seller']),
    (other_seller,other_invite,'listing-request-other@drvn.test',array['seller']);
  update public.beta_access_config set enforced=true where singleton=true;

  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uninvited,'role','authenticated')::text,true);
  begin
    perform public.claim_listing_creation(gen_random_uuid(),repeat('d',64));
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then raise exception 'Uninvited seller claimed listing creation'; end if;
  rejected := false;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',seller,'role','authenticated')::text,true);
  first_claim := public.claim_listing_creation(request_id, repeat('a',64));
  replay_claim := public.claim_listing_creation(request_id, repeat('a',64));
  if first_claim->>'listing_id' <> replay_claim->>'listing_id'
     or (replay_claim->>'completed')::boolean then
    raise exception 'Exact request replay did not return its original pending listing';
  end if;

  -- N72: a claim with no listing behind it was refused or abandoned, so a
  -- changed request takes it over (same listing id) instead of trapping the
  -- form. Once its listing exists, a changed payload is refused (below).
  replay_claim := public.claim_listing_creation(request_id, repeat('b',64));
  if replay_claim->>'listing_id' <> first_claim->>'listing_id'
     or (replay_claim->>'completed')::boolean
     or (replay_claim->>'fresh')::boolean then
    raise exception 'Changed request did not take over its unused claim';
  end if;
  replay_claim := public.claim_listing_creation(request_id, repeat('a',64));
  if replay_claim->>'listing_id' <> first_claim->>'listing_id' then
    raise exception 'Rebinding an unused claim changed its listing';
  end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',other_seller,'role','authenticated')::text,true);
  other_claim := public.claim_listing_creation(request_id, repeat('c',64));
  if other_claim->>'listing_id' = first_claim->>'listing_id' then
    raise exception 'Request identity crossed seller boundary';
  end if;
  perform set_config('role','postgres',true);
  update public.profiles set suspended_at=now(),suspended_reason='guard' where id=other_seller;
  perform set_config('role','authenticated',true);
  begin
    perform public.claim_listing_creation(gen_random_uuid(),repeat('e',64));
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then raise exception 'Suspended seller claimed listing creation'; end if;
  rejected := false;

  perform set_config('role','postgres',true);
  insert into public.listings(id,seller_id,title,category,price_cents,status)
  values((first_claim->>'listing_id')::uuid,seller,'Request guard listing','performance',1000,'draft');

  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',seller,'role','authenticated')::text,true);
  perform public.complete_listing_creation(request_id,repeat('a',64),(first_claim->>'listing_id')::uuid);
  replay_claim := public.claim_listing_creation(request_id,repeat('a',64));
  if not (replay_claim->>'completed')::boolean then
    raise exception 'Completed request did not remain completed on replay';
  end if;
  rejected := false;
  begin
    perform public.claim_listing_creation(request_id, repeat('b',64));
  exception when invalid_parameter_value then
    rejected := true;
  end;
  if not rejected then raise exception 'Changed payload reused a completed listing request'; end if;
  rejected := false;

  atomic_claim := public.claim_listing_creation(atomic_request,repeat('f',64));
  saved := public.save_listing_creation(
    atomic_request,repeat('f',64),listing_payload,images_payload,
    fitments_payload,numbers_payload,null
  );
  if saved->>'listing_id' <> atomic_claim->>'listing_id'
     or not (saved->>'completed')::boolean
     or (select count(*) from public.listing_images where listing_id=(saved->>'listing_id')::uuid)<>2
     or (select count(*) from public.listing_fitments where listing_id=(saved->>'listing_id')::uuid)<>1
     or (select count(*) from public.listing_part_numbers where listing_id=(saved->>'listing_id')::uuid)<>2 then
    raise exception 'Atomic listing projection was incomplete';
  end if;
  saved := public.save_listing_creation(
    atomic_request,repeat('f',64),listing_payload,images_payload,
    fitments_payload,numbers_payload,null
  );
  if not (saved->>'replayed')::boolean
     or (select count(*) from public.listing_images where listing_id=(saved->>'listing_id')::uuid)<>2 then
    raise exception 'Completed atomic replay duplicated its projection';
  end if;

  failed_claim := public.claim_listing_creation(failed_request,repeat('3',64));
  perform set_config('drvn.test_listing_creation_failure','on',true);
  begin
    perform public.save_listing_creation(
      failed_request,repeat('3',64),listing_payload,images_payload,
      fitments_payload,numbers_payload,null
    );
  exception when others then rejected:=true;
  end;
  perform set_config('drvn.test_listing_creation_failure','off',true);
  if not rejected
     or exists(select 1 from public.listings where id=(failed_claim->>'listing_id')::uuid)
     or (public.claim_listing_creation(failed_request,repeat('3',64))->>'completed')::boolean then
    raise exception 'Injected projection failure committed a partial listing';
  end if;
  rejected:=false;
  saved := public.save_listing_creation(
    failed_request,repeat('3',64),listing_payload,images_payload,
    fitments_payload,numbers_payload,null
  );
  if not (saved->>'completed')::boolean then raise exception 'Failed projection did not recover'; end if;

  changed_claim := public.claim_listing_creation(changed_request,repeat('4',64));
  perform set_config('role','postgres',true);
  insert into public.listings(id,seller_id,title,category,price_cents,status)
  values((changed_claim->>'listing_id')::uuid,seller,'Changed elsewhere','performance',12500,'draft');
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',seller,'role','authenticated')::text,true);
  begin
    perform public.save_listing_creation(
      changed_request,repeat('4',64),listing_payload,images_payload,
      fitments_payload,numbers_payload,null
    );
  exception when serialization_failure then rejected:=true;
  end;
  if not rejected then raise exception 'Pending replay overwrote a changed listing'; end if;
  rejected:=false;
  -- Its listing exists, so the request is spent: a changed payload can't take it.
  begin
    perform public.claim_listing_creation(changed_request,repeat('6',64));
  exception when invalid_parameter_value then rejected:=true;
  end;
  if not rejected then raise exception 'Changed payload took over a request whose listing exists'; end if;
  rejected:=false;

  denied_claim := public.claim_listing_creation(denied_request,repeat('5',64));
  if not (denied_claim->>'fresh')::boolean
     or not public.discard_listing_creation(denied_request,repeat('5',64)) then
    raise exception 'Denied fresh request could not release its unused admission';
  end if;
  denied_claim := public.claim_listing_creation(denied_request,repeat('5',64));
  if not (denied_claim->>'fresh')::boolean then
    raise exception 'Denied request retry bypassed fresh admission';
  end if;

  rejected := false;
  begin
    perform public.complete_listing_creation(request_id,repeat('a',64),(other_claim->>'listing_id')::uuid);
  exception when invalid_parameter_value then
    rejected := true;
  end;
  if not rejected then raise exception 'Completion accepted a mismatched listing'; end if;

  perform set_config('role','none',true);
  if has_function_privilege('anon','public.claim_listing_creation(uuid,text)','execute') then
    raise exception 'Anonymous caller can claim listing creation';
  end if;
  if has_table_privilege('authenticated','private.listing_creation_requests','select') then
    raise exception 'Authenticated caller can read the private request ledger';
  end if;
  if (select prosecdef from pg_proc where oid='public.save_listing_creation(uuid,text,jsonb,jsonb,jsonb,jsonb,uuid)'::regprocedure) then
    raise exception 'Atomic listing save bypasses row-level security';
  end if;
  if has_function_privilege('anon','public.save_listing_creation(uuid,text,jsonb,jsonb,jsonb,jsonb,uuid)','execute') then
    raise exception 'Anonymous caller can save a listing projection';
  end if;
  if has_function_privilege('anon','public.discard_listing_creation(uuid,text)','execute') then
    raise exception 'Anonymous caller can discard listing creation';
  end if;
  raise notice 'all listing creation request checks passed';
end $$;

rollback;
