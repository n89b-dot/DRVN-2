begin;

do $$
declare
  seller_id uuid := gen_random_uuid();
  buyer_id uuid := gen_random_uuid();
  car_id uuid := gen_random_uuid();
  other_car_id uuid := gen_random_uuid();
  target_listing_id uuid := gen_random_uuid();
  other_listing_id uuid := gen_random_uuid();
  question_id uuid := gen_random_uuid();
  rejected boolean := false;
begin
  if not (select prosecdef from pg_proc
          where oid = 'public.listing_question_parent_matches(uuid,uuid)'::regprocedure)
  then raise exception 'Question parent lookup does not bypass recursive RLS'; end if;
  if has_function_privilege('anon', 'public.listing_question_parent_matches(uuid,uuid)', 'execute')
  then raise exception 'Anonymous callers can probe question parents'; end if;

  insert into auth.users (id, email, raw_user_meta_data) values
    (seller_id, 'question-policy-seller@drvn.test', '{}'),
    (buyer_id, 'question-policy-buyer@drvn.test', '{}');
  insert into public.cars (id, owner_id, slug, name, is_public) values
    (car_id, seller_id, 'question-policy-car', 'Question policy car', true),
    (other_car_id, seller_id, 'question-policy-other-car', 'Other question policy car', true);
  insert into public.listings (
    id, seller_id, source_car_id, title, category, price_cents,
    shipping_cents, currency, status
  ) values
    (target_listing_id, seller_id, car_id, 'Question policy listing', 'performance', 1000, 0, 'USD', 'active'),
    (other_listing_id, seller_id, other_car_id, 'Other question policy listing', 'performance', 1000, 0, 'USD', 'active');

  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', buyer_id, 'role', 'authenticated')::text,
    true
  );
  insert into public.listing_questions (id, listing_id, author_id, body)
  values (question_id, target_listing_id, buyer_id, 'Does this include its bracket?');
  insert into public.listing_questions (listing_id, author_id, parent_id, body)
  values (target_listing_id, buyer_id, question_id, 'Adding one detail to the question.');

  begin
    insert into public.listing_questions (listing_id, author_id, parent_id, body)
    values (other_listing_id, buyer_id, question_id, 'Cross-listing reply');
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then raise exception 'Cross-listing reply was accepted'; end if;

  perform set_config('role', 'none', true);
  if (select count(*) from public.listing_questions where listing_id = target_listing_id) <> 2
  then raise exception 'Question and valid reply did not persist'; end if;

  raise notice 'all listing question RLS checks passed';
end $$;

rollback;
