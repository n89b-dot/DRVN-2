-- 20261110100000 (report five #117, OS-W41): one signed URL per member photo
-- per window, shared by every app instance.
--   1. The first offer for an object in a window wins; a later offer gets the
--      winner back, and a read returns it.
--   2. Windows are separate: the next window takes a new URL.
--   3. An offer prunes rows from before the previous window.
--   4. No member, visitor or anyone but the service role can call either
--      function or read the table (the URLs are bearer links).
--   5. An offer for a bucket that isn't a signed photo bucket stores nothing.
-- Transactional; disposable local or CI database only.
begin;

do $$
declare
  v_window bigint := 500000;
  v_url text;
  v_count integer;
begin
  -- 1. First offer wins.
  select signed_url into v_url from public.photo_signatures_offer(v_window,
    '[{"bucket":"car-images","path":"u1/a.webp","signed_url":"https://x/sign/car-images/u1/a.webp?token=first"}]'::jsonb);
  if v_url is distinct from 'https://x/sign/car-images/u1/a.webp?token=first' then
    raise exception 'FAIL 1: the first offer did not win (%) (OS-W41)', v_url;
  end if;
  select signed_url into v_url from public.photo_signatures_offer(v_window,
    '[{"bucket":"car-images","path":"u1/a.webp","signed_url":"https://x/sign/car-images/u1/a.webp?token=second"}]'::jsonb);
  if v_url is distinct from 'https://x/sign/car-images/u1/a.webp?token=first' then
    raise exception 'FAIL 1b: a later offer replaced the winner (%) (OS-W41)', v_url;
  end if;
  select signed_url into v_url from public.photo_signatures_read(v_window,
    '[{"bucket":"car-images","path":"u1/a.webp"},{"bucket":"car-images","path":"u1/none.webp"}]'::jsonb);
  if v_url is distinct from 'https://x/sign/car-images/u1/a.webp?token=first' then
    raise exception 'FAIL 1c: a read did not return the winner (%) (OS-W41)', v_url;
  end if;
  select count(*) into v_count from public.photo_signatures_read(v_window,
    '[{"bucket":"car-images","path":"u1/a.webp"},{"bucket":"car-images","path":"u1/none.webp"}]'::jsonb);
  if v_count <> 1 then
    raise exception 'FAIL 1d: a read returned % rows for one known object (OS-W41)', v_count;
  end if;

  -- 2. The next window is separate.
  select signed_url into v_url from public.photo_signatures_offer(v_window + 1,
    '[{"bucket":"car-images","path":"u1/a.webp","signed_url":"https://x/sign/car-images/u1/a.webp?token=next"}]'::jsonb);
  if v_url is distinct from 'https://x/sign/car-images/u1/a.webp?token=next' then
    raise exception 'FAIL 2: the next window reused the last window''s URL (OS-W41)';
  end if;

  -- 3. Two windows on, the first window's row is pruned.
  perform public.photo_signatures_offer(v_window + 2,
    '[{"bucket":"listing-images","path":"u1/b.webp","signed_url":"https://x/sign/listing-images/u1/b.webp?token=t"}]'::jsonb);
  if exists (select 1 from private.photo_signatures where signing_window = v_window) then
    raise exception 'FAIL 3: a row from two windows ago was not pruned (OS-W41)';
  end if;
  if not exists (select 1 from private.photo_signatures where signing_window = v_window + 1) then
    raise exception 'FAIL 3b: the previous window was pruned too early (OS-W41)';
  end if;

  -- 5. Only the three signed photo buckets.
  perform public.photo_signatures_offer(v_window + 2,
    '[{"bucket":"avatars","path":"u1/me.webp","signed_url":"https://x/a"}]'::jsonb);
  if exists (select 1 from private.photo_signatures where bucket = 'avatars') then
    raise exception 'FAIL 5: an offer stored a non-photo bucket (OS-W41)';
  end if;

  -- 4. Nobody but the service role.
  if has_function_privilege('anon', 'public.photo_signatures_read(bigint, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.photo_signatures_read(bigint, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.photo_signatures_offer(bigint, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.photo_signatures_offer(bigint, jsonb)', 'execute') then
    raise exception 'FAIL 4: a visitor or member can call the shared signing memo (OS-W41)';
  end if;
  if not has_function_privilege('service_role', 'public.photo_signatures_offer(bigint, jsonb)', 'execute') then
    raise exception 'FAIL 4b: the service role cannot offer signatures (OS-W41)';
  end if;
  if has_table_privilege('authenticated', 'private.photo_signatures', 'select')
     or has_table_privilege('anon', 'private.photo_signatures', 'select') then
    raise exception 'FAIL 4c: a visitor or member can read the signed URLs (OS-W41)';
  end if;

  raise notice 'all shared photo signature checks passed';
end $$;

rollback;
