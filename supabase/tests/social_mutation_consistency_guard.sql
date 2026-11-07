begin;
do $$
declare
  member_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  target_uuid uuid := gen_random_uuid();
  rejected boolean := false;
begin
  if (select prosecdef from pg_proc where oid='public.set_social_relationship(text,text,uuid,boolean)'::regprocedure)
  then raise exception 'Social mutation function bypasses caller RLS'; end if;
  insert into auth.users(id,email,raw_user_meta_data) values
    (member_id,'social-guard-member@drvn.test','{}'),
    (other_id,'social-guard-other@drvn.test','{}');
  -- A real build: a save, like or follow must name something that exists
  -- (20261107180100).
  insert into public.cars(id, owner_id, slug, name, is_public)
    values (target_uuid, other_id, 'social-guard-target', 'Social guard target', true);

  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',json_build_object('sub',member_id,'role','authenticated')::text,true);
  perform public.set_social_relationship('save','car',target_uuid,true);
  perform public.set_social_relationship('save','car',target_uuid,true);
  perform public.set_social_relationship('like','car',target_uuid,true);
  perform public.set_social_relationship('like','car',target_uuid,true);
  perform public.set_social_relationship('follow','car',target_uuid,true);
  perform public.set_social_relationship('follow','car',target_uuid,true);

  perform set_config('role','none',true);
  if (select count(*) from public.saves where user_id=member_id and target_id=target_uuid) <> 1
    or (select count(*) from public.likes where user_id=member_id and target_id=target_uuid) <> 1
    or (select count(*) from public.follows where follower_id=member_id and target_id=target_uuid) <> 1
  then raise exception 'Repeated desired-state writes did not converge'; end if;

  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',json_build_object('sub',other_id,'role','authenticated')::text,true);
  perform public.set_social_relationship('save','car',target_uuid,true);
  perform set_config('request.jwt.claims',json_build_object('sub',member_id,'role','authenticated')::text,true);
  perform public.set_social_relationship('save','car',target_uuid,false);
  perform public.set_social_relationship('save','car',target_uuid,false);
  perform public.set_social_relationship('like','car',target_uuid,false);
  perform public.set_social_relationship('like','car',target_uuid,false);
  perform public.set_social_relationship('follow','car',target_uuid,false);
  perform public.set_social_relationship('follow','car',target_uuid,false);
  begin
    perform public.set_social_relationship('follow','listing',target_uuid,true);
  exception when invalid_parameter_value then
    rejected := true;
  end;
  if not rejected then raise exception 'Unsupported relationship was accepted'; end if;
  rejected := false;
  begin
    perform public.set_social_relationship('save','car',target_uuid,null);
  exception when invalid_parameter_value then
    rejected := true;
  end;
  if not rejected then raise exception 'Null desired state was accepted'; end if;

  perform set_config('role','none',true);
  if exists(select 1 from public.saves where user_id=member_id and target_id=target_uuid)
    or exists(select 1 from public.likes where user_id=member_id and target_id=target_uuid)
    or exists(select 1 from public.follows where follower_id=member_id and target_id=target_uuid)
  then raise exception 'Repeated removal did not converge'; end if;
  if not exists(select 1 from public.saves where user_id=other_id and target_id=target_uuid)
  then raise exception 'One member changed another member''s relationship'; end if;

  raise notice 'all social mutation consistency checks passed';
end $$;
rollback;
