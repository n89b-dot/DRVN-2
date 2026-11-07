begin;

do $$
declare
  v_member_id uuid := gen_random_uuid();
  v_car_id uuid := gen_random_uuid();
  draft_a uuid := gen_random_uuid();
  draft_b uuid := gen_random_uuid();
  published_id uuid;
  rejected boolean := false;
  first_body jsonb := '[{"type":"text","style":"normal","text":"First saved body"}]'::jsonb;
  final_body jsonb := '[{"type":"text","style":"normal","text":"Published body"}]'::jsonb;
begin
  -- Signature gained p_listing_ids with the quick-post work (20260919194000).
  if (select prosecdef from pg_proc
       where oid = 'public.write_activity_post(text,uuid,uuid,text,jsonb,text[],text,text,uuid[])'::regprocedure)
  then raise exception 'Activity write function bypasses caller RLS'; end if;
  -- Exactly one arity: a leftover overload makes every call ambiguous.
  if (select count(*) from pg_proc where proname = 'write_activity_post'
        and pronamespace = 'public'::regnamespace) <> 1
  then raise exception 'write_activity_post has more than one signature'; end if;

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_member_id, 'activity-write-guard@drvn.test', '{}');

  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_member_id, 'role', 'authenticated')::text,
    true
  );
  insert into public.cars (id, owner_id, slug, name, is_public)
  values (v_car_id, v_member_id, 'activity-write-guard', 'Activity write guard', true);

  perform * from public.write_activity_post(
    'draft', draft_a, v_car_id, 'First title', first_body, array[]::text[]
  );
  perform * from public.write_activity_post(
    'draft', draft_b, v_car_id, 'Latest title', final_body, array[]::text[]
  );

  perform set_config('role', 'none', true);
  if (select count(*) from public.activity_posts p
      where p.car_id = v_car_id and p.author_id = v_member_id
        and p.published_at is null and p.draft_archived_at is null) <> 1
  then raise exception 'Repeated draft operations created duplicate active drafts'; end if;
  if not exists (
    select 1 from public.activity_posts p
    where p.car_id = v_car_id and p.author_id = v_member_id
      and p.title = 'Latest title' and p.body = final_body
  ) then raise exception 'Latest draft content was not retained'; end if;

  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_member_id, 'role', 'authenticated')::text,
    true
  );
  select result.post_id into published_id
  from public.write_activity_post(
    'publish', draft_b, v_car_id, 'Published title', final_body,
    array['https://proj.supabase.co/storage/v1/object/public/activity-images/' || v_member_id || '/cover.jpg']::text[]
  ) result;
  perform * from public.write_activity_post(
    'publish', draft_b, v_car_id, 'Published title', final_body,
    array['https://proj.supabase.co/storage/v1/object/public/activity-images/' || v_member_id || '/cover.jpg']::text[]
  );
  -- Simulates a draft request that began before publish but acquired the
  -- per-car lock after it. It must observe the publish receipt and do nothing.
  perform * from public.write_activity_post(
    'draft', draft_b, v_car_id, 'Stale autosave', first_body, array[]::text[]
  );

  perform set_config('role', 'none', true);
  if (select count(*) from public.activity_posts p
      where p.car_id = v_car_id and p.author_id = v_member_id and p.published_at is not null) <> 1
  then raise exception 'Publish replay created a duplicate post'; end if;
  if exists (
    select 1 from public.activity_posts p
    where p.car_id = v_car_id and p.author_id = v_member_id
      and p.published_at is null and p.draft_archived_at is null
  ) then raise exception 'Stale autosave resurrected a draft after publish'; end if;
  if (select count(*) from public.activity_images ai where ai.post_id = published_id) <> 1
  then raise exception 'Published image projection was not committed'; end if;

  perform set_config('role', 'authenticated', true);
  begin
    perform * from public.write_activity_post(
      'publish', draft_b, v_car_id, 'Changed retry', final_body,
      array['https://proj.supabase.co/storage/v1/object/public/activity-images/' || v_member_id || '/cover.jpg']::text[]
    );
  exception when invalid_parameter_value then
    rejected := true;
  end;
  if not rejected then raise exception 'Changed publish retry was adopted'; end if;
  rejected := false;
  begin
    insert into public.activity_posts (id, car_id, author_id, title, body, published_at)
    values (gen_random_uuid(), v_car_id, v_member_id, 'Bypass', '[]'::jsonb, now());
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then raise exception 'Direct post insert bypassed the durable writer'; end if;

  perform * from public.write_activity_post(
    p_mode => 'update',
    p_post_id => published_id,
    p_car_id => v_car_id,
    p_title => 'Details only',
    p_intro => 'Preserve the document and cover'
  );
  perform set_config('role', 'none', true);
  if not exists (
    select 1 from public.activity_posts p
    where p.id = published_id and p.title = 'Details only' and p.body = final_body
  ) then raise exception 'Details-only update replaced the document'; end if;
  if (select array_agg(ai.url order by ai.position) from public.activity_images ai where ai.post_id = published_id)
      is distinct from array['https://proj.supabase.co/storage/v1/object/public/activity-images/' || v_member_id || '/cover.jpg']::text[]
  then raise exception 'Details-only update replaced the image projection'; end if;

  perform set_config('role', 'authenticated', true);
  begin
    perform * from public.write_activity_post(
      'update', published_id, v_car_id, 'Must roll back', first_body,
      array[null]::text[], null, null
    );
  exception when not_null_violation then
    null;
  end;

  perform set_config('role', 'none', true);
  if not exists (
    select 1 from public.activity_posts p
    where p.id = published_id and p.title = 'Details only' and p.body = final_body
  ) then raise exception 'Post changed when its image projection failed'; end if;
  if (select array_agg(ai.url order by ai.position) from public.activity_images ai where ai.post_id = published_id)
      is distinct from array['https://proj.supabase.co/storage/v1/object/public/activity-images/' || v_member_id || '/cover.jpg']::text[]
  then raise exception 'Image projection changed after rolled-back update'; end if;

  perform set_config('role', 'authenticated', true);
  perform * from public.write_activity_post(
    'update', published_id, v_car_id, 'Updated atomically', first_body,
    array['https://proj.supabase.co/storage/v1/object/public/activity-images/' || v_member_id || '/new-cover.jpg']::text[], null, null
  );
  perform set_config('role', 'none', true);
  if not exists (
    select 1 from public.activity_posts p
    join public.activity_images ai on ai.post_id = p.id
    where p.id = published_id and p.title = 'Updated atomically'
      and p.body = first_body
      and ai.url = 'https://proj.supabase.co/storage/v1/object/public/activity-images/' || v_member_id || '/new-cover.jpg'
  ) then raise exception 'Atomic post/image update did not converge'; end if;

  raise notice 'all durable activity write checks passed';
end $$;

rollback;
