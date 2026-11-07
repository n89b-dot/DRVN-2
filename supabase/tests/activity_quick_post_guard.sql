-- Quick posts never touch a saved draft (PRD 2026-09 W-1). RELEASE-BLOCKING.
-- Transactional; disposable local database only.
begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_car uuid := gen_random_uuid();
  v_draft_op uuid := gen_random_uuid();
  v_quick_op uuid := gen_random_uuid();
  v_quick_op2 uuid := gen_random_uuid();
  v_draft_before public.activity_posts%rowtype;
  v_draft_after public.activity_posts%rowtype;
  v_quick_id uuid;
  v_outcome text;
  v_rejected boolean;
  v_count int;
begin
  update public.beta_access_config set enforced = false where singleton;
  -- Member photo writes need the storage origin recorded (20261107150500).
  insert into public.job_config(key, value) values ('media_storage_origin', 'https://proj.supabase.co')
    on conflict (key) do update set value = excluded.value;
  insert into auth.users(id, email) values (v_owner, 'quick-post-owner@drvn.test');
  insert into public.profiles(id, username) values (v_owner, 'quick_post_owner')
    on conflict (id) do update set username = excluded.username;
  insert into public.cars(id, owner_id, slug, name)
    values (v_car, v_owner, 'quick-post-guard', 'Quick post guard');

  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );

  -- A long update, saved as a draft and left alone.
  perform public.write_activity_post(
    'draft', v_draft_op, v_car,
    'The head is off and here is everything I found',
    '[{"type":"text","html":"<p>Two thousand words about a cylinder head.</p>"}]'::jsonb
  );

  perform set_config('role', 'none', true);
  select p.* into v_draft_before
    from public.activity_posts p
   where p.car_id = v_car and p.published_at is null and p.draft_archived_at is null;
  if not found then raise exception 'The draft was not saved'; end if;

  -- The same person fires off a quick post about something else entirely.
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );
  select post_id, outcome into v_quick_id, v_outcome
    from public.write_activity_post(
      'quick', v_quick_op, v_car, null,
      '[{"type":"text","html":"<p>New wheels turned up.</p>"}]'::jsonb,
      array['https://proj.supabase.co/storage/v1/object/public/activity-images/' || v_owner || '/wheels.jpg']
    );
  if v_outcome <> 'published' then
    raise exception 'A quick post did not publish (got %)', v_outcome;
  end if;

  perform set_config('role', 'none', true);

  -- THE contract: the draft is untouched, byte for byte.
  select p.* into v_draft_after from public.activity_posts p where p.id = v_draft_before.id;
  if not found then
    raise exception 'A quick post CONSUMED the saved draft';
  end if;
  if v_draft_after.published_at is not null then
    raise exception 'A quick post PUBLISHED the saved draft';
  end if;
  if v_draft_after.title is distinct from v_draft_before.title
     or v_draft_after.body is distinct from v_draft_before.body
     or v_draft_after.draft_key is distinct from v_draft_before.draft_key then
    raise exception 'A quick post rewrote the saved draft';
  end if;

  -- And both posts exist.
  select count(*) into v_count from public.activity_posts where car_id = v_car;
  if v_count <> 2 then
    raise exception 'Expected the draft and the quick post; found % rows', v_count;
  end if;
  if not exists (
    select 1 from public.activity_posts
     where id = v_quick_id and published_at is not null and title is null
  ) then
    raise exception 'The quick post is missing, or invented a title';
  end if;

  -- Retry-safety: the same operation id replays rather than double-posting.
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );
  select outcome into v_outcome
    from public.write_activity_post(
      'quick', v_quick_op, v_car, null,
      '[{"type":"text","html":"<p>New wheels turned up.</p>"}]'::jsonb,
      array['https://proj.supabase.co/storage/v1/object/public/activity-images/' || v_owner || '/wheels.jpg']
    );
  if v_outcome <> 'replayed' then
    raise exception 'A repeated quick post did not replay (got %)', v_outcome;
  end if;

  -- W-2: a publish with no photo is refused.
  v_rejected := false;
  begin
    perform public.write_activity_post(
      'quick', v_quick_op2, v_car, null,
      '[{"type":"text","html":"<p>No photo.</p>"}]'::jsonb
    );
  exception when others then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'A photoless quick post was published'; end if;

  -- ...but a draft may still have none.
  perform public.write_activity_post(
    'draft', v_draft_op, v_car, 'Still writing', '[]'::jsonb
  );

  -- A quick post can be corrected afterwards without inventing a title, and
  -- the edit stores "no title" as null rather than as an empty heading.
  perform public.write_activity_post(
    'update', v_quick_op, v_car, '',
    '[{"type":"text","html":"<p>New wheels turned up. 18s.</p>"}]'::jsonb,
    array['https://proj.supabase.co/storage/v1/object/public/activity-images/' || v_owner || '/wheels.jpg']
  );
  -- ...while a titled post still can't be edited down to nothing.
  v_rejected := false;
  begin
    perform public.write_activity_post('update', v_quick_op2, v_car, '');
  exception when others then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'An unknown post accepted an edit'; end if;

  perform set_config('role', 'none', true);
  select count(*) into v_count from public.activity_posts where car_id = v_car;
  if v_count <> 2 then
    raise exception 'Row count drifted after the photo checks: %', v_count;
  end if;

  if exists (select 1 from public.activity_posts where id = v_quick_op and title is not null) then
    raise exception 'Editing a quick post gave it a title';
  end if;
  if not exists (select 1 from public.activity_images where post_id = v_quick_op) then
    raise exception 'Editing a quick post lost its photo';
  end if;

  raise notice 'all quick-post checks passed';
end;
$$;

rollback;
