-- Every foreign key in public has an index on its referencing columns
-- (N29, production-readiness 2026-11-03; migration 20261107153100).
--
-- Postgres never indexes the referencing side for you. Without one, deleting
-- a parent row (account deletion, a deleted listing, the agent retention
-- sweep) reads the whole child table once per row. An index covers a key when
-- its leading key columns (not INCLUDE columns) are exactly the key's
-- columns, in any order, and it is valid (not a failed CONCURRENTLY build); a partial
-- index covers a one-column key only when its predicate is
-- "<column> IS NOT NULL" (every lookup by a value satisfies that).
--
-- A key without one must be indexed, or added to `allowed` below with the
-- reason it never needs one.
begin;

do $$
declare
  -- table.column[,column] => why no index is needed
  allowed jsonb := jsonb_build_object(
    'cars.catalog_make_id', 'reference catalogue, never deleted; public reads use cars_catalog_make_idx',
    'cars.catalog_model_id', 'reference catalogue, never deleted; public reads use cars_catalog_model_idx',
    'product_fitments.catalog_model_id', 'reference catalogue, never deleted; reads use product_fitments_vehicle_idx',
    'product_fitments.generation_id,catalog_model_id', 'reference catalogue, never deleted; reads use product_fitments_vehicle_idx',
    'agent_spend_limits.changed_by', 'one-row settings table',
    'agent_beta_steps.changed_by', 'four-row settings table');
  bad text;
  plan text;
  line text;
begin
  create temporary table fk_coverage on commit drop as
  select c.conname,
         c.conrelid::regclass::text || '.' || array_to_string(array(
           select a.attname from unnest(c.conkey) with ordinality k(n, o)
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.o), ',') as fk,
         exists (
           select 1 from pg_index i
           where i.indrelid = c.conrelid
             -- A valid, ready index, whose KEY columns (never INCLUDE
             -- columns, which can't be searched) start with the key's.
             and i.indisvalid and i.indisready
             and cardinality(c.conkey) <= i.indnkeyatts
             and (select array_agg(x order by x) from unnest((i.indkey::int2[])[0:cardinality(c.conkey) - 1]) x)
                 = (select array_agg(x order by x) from unnest(c.conkey) x)
             and (i.indpred is null
                  or (cardinality(c.conkey) = 1
                      and pg_get_expr(i.indpred, i.indrelid) = format('(%I IS NOT NULL)',
                            (select a.attname from pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[1])))))
           as covered
  from pg_constraint c
  where c.contype = 'f' and c.connamespace = 'public'::regnamespace;

  -- 1. Every foreign key is covered, or deliberately allowed.
  select string_agg(fk || ' (' || conname || ')', ', ' order by fk) into bad
  from fk_coverage where not covered and not allowed ? fk;
  if bad is not null then
    raise exception 'FAIL 1: foreign keys with no covering index (index them, or allow-list them here with a reason): %', bad;
  end if;

  -- 2. The allow-list stays true: each entry is still a foreign key, and
  --    still has no index (an entry that gained one comes off the list).
  select string_agg(k, ', ') into bad
  from jsonb_object_keys(allowed) k
  where not exists (select 1 from fk_coverage f where f.fk = k and not f.covered);
  if bad is not null then
    raise exception 'FAIL 2: allow-listed keys that are gone or now indexed (remove them from the list): %', bad;
  end if;

  -- 3. The keys the readiness review named are covered by name.
  select string_agg(k, ', ') into bad
  from unnest(array['notifications.actor_id', 'transfer_intents.seller_id', 'activity_comments.author_id',
                    'reviews.reviewer_id', 'listing_questions.author_id', 'payment_recoveries.order_id',
                    'offer_rounds.buyer_id']) k
  where not exists (select 1 from fk_coverage f where f.fk = k and f.covered);
  if bad is not null then
    raise exception 'FAIL 3: keys from the readiness review still uncovered: %', bad;
  end if;

  -- 4. The planner can use them: a cascade-style lookup on a plain index
  --    (offer_rounds.buyer_id) and on a partial one (notifications.actor_id).
  set local enable_seqscan = off;
  plan := '';
  for line in execute 'explain (costs off) select 1 from public.offer_rounds where buyer_id = ''00000000-0000-0000-0000-000000000001''::uuid' loop
    plan := plan || line || ' ';
  end loop;
  if plan !~ 'offer_rounds_buyer_id_idx' then
    raise exception 'FAIL 4a: a lookup by offer_rounds.buyer_id does not use its index: %', plan;
  end if;
  plan := '';
  for line in execute 'explain (costs off) select 1 from public.notifications where actor_id = ''00000000-0000-0000-0000-000000000001''::uuid' loop
    plan := plan || line || ' ';
  end loop;
  if plan !~ 'notifications_actor_id_idx' then
    raise exception 'FAIL 4b: a lookup by notifications.actor_id does not use its partial index: %', plan;
  end if;
  reset enable_seqscan;

  raise notice 'all foreign key index checks passed';
end;
$$;

rollback;
