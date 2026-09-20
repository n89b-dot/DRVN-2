-- 20260919197000 — posting without a car (PRD 2026-09 W-5; build plan WS14b).
--
-- Principle 1 of the PRD: "the car gives context; it is never a gate." A
-- member who has sold their car, or who is selling parts before they buy
-- one, currently cannot post at all — `activity_posts.car_id` is NOT NULL.
--
-- The rule that replaces it is not "anything goes": a post must be about a
-- car, a tagged part, or both. That keeps Principle 3 ("everything is about
-- a car or a part") true while dropping the gate, and it is enforced here
-- rather than in the composer, because a rule about what the product IS
-- belongs where it cannot be forgotten.
--
-- The check is DEFERRABLE INITIALLY DEFERRED: a post and its tagged parts
-- are written in the same transaction and the parts land second, so an
-- immediate check would fail every carless post on the way in.
--
-- Idempotent.

begin;

alter table public.activity_posts
  alter column car_id drop not null;

comment on column public.activity_posts.car_id is
  'Optional since W-5. A post must be about a car, a tagged part, or both — see the trigger below.';

create or replace function public.guard_post_has_subject()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Drafts are exempt: you start writing before you decide what it is about.
  if new.published_at is null then
    return new;
  end if;
  if new.car_id is not null then
    return new;
  end if;
  if exists (select 1 from public.activity_post_listings t where t.post_id = new.id) then
    return new;
  end if;
  raise exception 'A post needs a car, a tagged part, or both.' using errcode = '23514';
end;
$$;

-- Constraint trigger so it can be deferred to the end of the transaction,
-- by which time the tagged parts exist.
drop trigger if exists guard_post_has_subject on public.activity_posts;
create constraint trigger guard_post_has_subject
  after insert or update on public.activity_posts
  deferrable initially deferred
  for each row execute function public.guard_post_has_subject();

commit;
