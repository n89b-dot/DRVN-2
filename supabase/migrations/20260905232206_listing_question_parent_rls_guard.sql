-- Checking a reply's parent from the listing_questions INSERT policy by
-- selecting listing_questions directly recursively invokes that table's RLS.
-- Keep the lookup behind a narrow definer function. It also applies the same
-- listing visibility rule as the SELECT policy, so invoking it directly does
-- not reveal a private listing thread.
create or replace function public.listing_question_parent_matches(
  p_parent_id uuid,
  p_listing_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.listing_questions q
    join public.listings l on l.id = q.listing_id
    where q.id = p_parent_id
      and q.listing_id = p_listing_id
      and (l.status in ('active', 'sold') or l.seller_id = auth.uid())
  );
$$;

revoke all on function public.listing_question_parent_matches(uuid, uuid)
  from public, anon;
grant execute on function public.listing_question_parent_matches(uuid, uuid)
  to authenticated;

drop policy if exists "authed users ask questions" on public.listing_questions;
create policy "authed users ask questions" on public.listing_questions for insert
  with check (
    auth.uid() = author_id
    and char_length(body) between 1 and 2000
    and exists (
      select 1 from public.listings l
      where l.id = listing_questions.listing_id
        and (l.status in ('active', 'sold') or l.seller_id = auth.uid())
    )
    and (
      parent_id is null
      or public.listing_question_parent_matches(
        listing_questions.parent_id,
        listing_questions.listing_id
      )
    )
  );
