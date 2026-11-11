-- 0035 — seller_open_questions: buyer questions still waiting on the seller.
--
-- The listings ledger shows unanswered questions per row (0030), but only for
-- the fifty rows on screen, so the seller's summary line could not honestly
-- say how many questions are outstanding across the whole catalog. The
-- anti-join ("a top-level question with no reply") isn't expressible through
-- PostgREST, so it gets the same treatment as the other ledger aggregates: a
-- SECURITY INVOKER function reading only what the seller can already read.
--
-- Deliberately its own function rather than a column added to
-- seller_register_tally — changing a function's return type means dropping it
-- first, which is exactly the kind of non-re-runnable step these migrations
-- avoid.
--
-- Idempotent: CREATE OR REPLACE plus IF NOT EXISTS. Safe to re-run.

begin;

create or replace function public.seller_open_questions(p_seller uuid)
returns bigint
language sql
security invoker
set search_path = public
stable
as $$
  select count(*)
  from public.listing_questions q
  join public.listings l on l.id = q.listing_id
  where l.seller_id = p_seller
    and p_seller = auth.uid()
    and q.parent_id is null
    and not exists (
      select 1 from public.listing_questions a where a.parent_id = q.id
    );
$$;

revoke all on function public.seller_open_questions(uuid) from public, anon;
grant execute on function public.seller_open_questions(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'seller_open_questions'
  ) then
    raise exception '0035: seller_open_questions missing';
  end if;
  raise notice 'PASS: 0035 self-checks';
end $$;

commit;
