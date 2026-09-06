begin;
create function public.gallery_test_fail() returns trigger language plpgsql as $$
begin
  if current_setting('drvn.test_gallery_failure',true)='on' then raise exception 'Injected gallery failure'; end if;
  return new;
end $$;
create trigger gallery_test_fail before update on public.car_images for each row execute function public.gallery_test_fail();
do $$
declare
  owner_id uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid(); v_car uuid:=gen_random_uuid();
  one_id uuid; two_id uuid; result jsonb; rejected boolean:=false; first_url text;
begin
  insert into auth.users(id,email,raw_user_meta_data) values(owner_id,'gallery-owner@drvn.test','{}'),(stranger,'gallery-stranger@drvn.test','{}');
  insert into public.cars(id,owner_id,slug,name,is_public) values(v_car,owner_id,'gallery-guard','Gallery guard',true);
  first_url:='http://127.0.0.1:54321/storage/v1/object/public/car-images/'||owner_id||'/one.webp';
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true);
  begin
    perform public.edit_car_gallery(v_car,'add',jsonb_build_object('url',first_url,'actor',owner_id));
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Authenticated caller bypassed verified upload attachment'; end if;
  rejected:=false;
  begin
    perform public.edit_car_gallery(v_car,'add',jsonb_build_object(
      'url','https://attacker.example/storage/v1/object/public/car-images/'||owner_id||'/beacon.webp',
      'actor',owner_id
    ));
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Off-site lookalike URL crossed direct gallery RPC boundary'; end if;

  perform set_config('role','service_role',true);
  rejected:=false;
  begin
    perform public.edit_car_gallery(v_car,'add',jsonb_build_object('url',first_url,'actor',stranger));
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Trusted attachment accepted an actor who does not own the car'; end if;
  result:=public.edit_car_gallery(v_car,'add',jsonb_build_object('url',first_url,'actor',owner_id));
  one_id:=(result->'image'->>'id')::uuid;
  result:=public.edit_car_gallery(v_car,'add',jsonb_build_object('url',first_url,'actor',owner_id));
  if (result->'image'->>'id')::uuid<>one_id then raise exception 'Upload retry duplicated the image'; end if;
  result:=public.edit_car_gallery(v_car,'add',jsonb_build_object('url',replace(first_url,'one.webp','two.webp'),'actor',owner_id));
  two_id:=(result->'image'->>'id')::uuid;
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true);
  perform public.edit_car_gallery(v_car,'reorder',jsonb_build_object('ids',jsonb_build_array(two_id,one_id)));
  perform public.edit_car_gallery(v_car,'reorder',jsonb_build_object('ids',jsonb_build_array(two_id,one_id)));
  if (select position from public.car_images where id=two_id)<>0 then raise exception 'Order retry did not converge'; end if;
  begin
    perform public.edit_car_gallery(v_car,'reorder',jsonb_build_object('ids',jsonb_build_array(one_id,one_id)));
  exception when others then rejected:=true; end;
  if not rejected then raise exception 'Duplicate IDs accepted'; end if;
  rejected:=false;
  perform set_config('drvn.test_gallery_failure','on',true);
  begin
    perform public.edit_car_gallery(v_car,'reorder',jsonb_build_object('ids',jsonb_build_array(one_id,two_id)));
  exception when others then rejected:=true; end;
  perform set_config('drvn.test_gallery_failure','off',true);
  if not rejected or (select position from public.car_images where id=two_id)<>0 or (select position from public.car_images where id=one_id)<>1 then raise exception 'Failed reorder committed partial changes'; end if;
  perform set_config('request.jwt.claims',json_build_object('sub',stranger,'role','authenticated')::text,true);
  rejected:=false;
  begin perform public.edit_car_gallery(v_car,'delete',jsonb_build_object('id',one_id)); exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Another member changed this gallery'; end if;
  perform set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true);
  perform public.edit_car_gallery(v_car,'delete',jsonb_build_object('id',one_id));
  perform public.edit_car_gallery(v_car,'delete',jsonb_build_object('id',one_id));
  if (select cover_image_url from public.cars where id=v_car)<>replace(first_url,'one.webp','two.webp') then raise exception 'Cover pointer was not promoted atomically'; end if;
  if (select count(*) from public.car_images where car_images.car_id=v_car)<>1 then raise exception 'Repeated delete removed the wrong number of photos'; end if;
  perform set_config('role','none',true);
  if (select prosecdef from pg_proc where oid='public.edit_car_gallery(uuid,text,jsonb)'::regprocedure) then raise exception 'Gallery function bypasses RLS'; end if;
  if has_function_privilege('anon','public.edit_car_gallery(uuid,text,jsonb)','execute') then raise exception 'Anonymous gallery mutation allowed'; end if;
  raise notice 'all car gallery consistency checks passed';
end $$;
rollback;
