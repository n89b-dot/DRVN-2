-- OS-W32: block, suspension visibility, and Message seller (Neil's ruling,
-- 7 November 2026: "Block approved; hide suspended members; buyers may
-- message sellers").
--
--   N54  Members couldn't block anyone (docs/production-readiness-2026-11-03.md
--        §2.3). A block is private and directed (member_blocks), and one
--        symmetric "either blocked" check refuses every person-to-person
--        write between the two: messages, offers and offer moves (the
--        agent's writes too, since they land in the same tables), listing
--        questions, replies on posts and follows. Blocking also ends the
--        follows between them. The only exception is a message attached to
--        an order the two share, so an open order can still be finished.
--   N59  A suspended member's posts without a car, their replies and their
--        profile stayed visible. Restrictive read policies now hide them from
--        everyone but the member, admins, and people they share a
--        conversation or an order with (so past orders still name them).
--   R-directcontact  A real "Message seller": a buyer's message about a
--        listing joins the pair's conversation, the seller can reply, a new
--        contact is rate limited in SQL (10 new people a day), and blocks
--        apply. Agents still never message people (AG-4): the agent worker
--        has no grant on messages.
--
-- Redefined: activity_post_visible (adds the suspension rule) and
-- message_attach_conversation (attaches listing enquiries). The messages
-- insert policy's listing branch is replaced; its order and offer branches
-- are unchanged.

begin;

-- ------------------------------------------------------------
-- N54: blocks
-- ------------------------------------------------------------
create table if not exists public.member_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists member_blocks_blocked_idx on public.member_blocks (blocked_id);

comment on table public.member_blocks is
  'N54: a member''s private, directed blocks. Only the blocker can read their own rows; either direction refuses contact.';

alter table public.member_blocks enable row level security;
revoke all on public.member_blocks from anon, authenticated;
grant select, insert, delete on public.member_blocks to authenticated;

drop policy if exists "members read their own blocks" on public.member_blocks;
create policy "members read their own blocks" on public.member_blocks
  for select to authenticated using (blocker_id = (select auth.uid()));
drop policy if exists "members block for themselves" on public.member_blocks;
create policy "members block for themselves" on public.member_blocks
  for insert to authenticated with check (blocker_id = (select auth.uid()));
drop policy if exists "members unblock for themselves" on public.member_blocks;
create policy "members unblock for themselves" on public.member_blocks
  for delete to authenticated using (blocker_id = (select auth.uid()));

create or replace function private.either_blocked(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_a is not null and p_b is not null and exists (
    select 1 from public.member_blocks b
     where (b.blocker_id = p_a and b.blocked_id = p_b)
        or (b.blocker_id = p_b and b.blocked_id = p_a)
  );
$$;

revoke all on function private.either_blocked(uuid, uuid) from public, anon, authenticated;

-- Blocking ends the follows between the two, both ways.
create or replace function private.block_ends_follows()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.follows f
   where (f.follower_id = new.blocker_id and f.target_type = 'profile' and f.target_id = new.blocked_id)
      or (f.follower_id = new.blocked_id and f.target_type = 'profile' and f.target_id = new.blocker_id)
      or (f.follower_id = new.blocker_id and f.target_type = 'car'
          and f.target_id in (select c.id from public.cars c where c.owner_id = new.blocked_id))
      or (f.follower_id = new.blocked_id and f.target_type = 'car'
          and f.target_id in (select c.id from public.cars c where c.owner_id = new.blocker_id));
  return new;
end;
$$;

revoke all on function private.block_ends_follows() from public, anon, authenticated;

drop trigger if exists member_blocks_end_follows on public.member_blocks;
create trigger member_blocks_end_follows
  after insert on public.member_blocks
  for each row execute function private.block_ends_follows();

-- One check for every person-to-person write. tg_argv[0] names the table's
-- shape; the other person is worked out from the row.
create or replace function private.refuse_blocked_contact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_other uuid;
  v_seller uuid;
begin
  case tg_table_name
    when 'messages' then
      -- Lifecycle events are DRVN's, not the member's.
      if new.kind = 'event' then return new; end if;
      v_actor := new.sender_id;
      v_other := new.recipient_id;
      -- The order exception: only communication attached to an order the
      -- two of them share, so an open order can still be finished.
      if new.order_id is not null and exists (
        select 1 from public.orders o
         where o.id = new.order_id
           and ((o.buyer_id = v_actor and o.seller_id = v_other) or (o.seller_id = v_actor and o.buyer_id = v_other))
      ) then
        return new;
      end if;
    when 'offers' then
      select l.seller_id into v_seller from public.listings l where l.id = new.listing_id;
      v_actor := new.buyer_id;
      v_other := v_seller;
    when 'offer_rounds' then
      select l.seller_id into v_seller from public.listings l where l.id = new.listing_id;
      v_actor := new.buyer_id;
      v_other := v_seller;
    when 'listing_questions' then
      select l.seller_id into v_seller from public.listings l where l.id = new.listing_id;
      v_actor := new.author_id;
      if v_actor = v_seller and new.parent_id is not null then
        select q.author_id into v_other from public.listing_questions q where q.id = new.parent_id;
      else
        v_other := v_seller;
      end if;
    when 'activity_comments' then
      v_actor := new.author_id;
      select p.author_id into v_other from public.activity_posts p where p.id = new.post_id;
    when 'follows' then
      v_actor := new.follower_id;
      if new.target_type = 'profile' then
        v_other := new.target_id;
      else
        select c.owner_id into v_other from public.cars c where c.id = new.target_id;
      end if;
    else
      return new;
  end case;
  if v_actor is distinct from v_other and private.either_blocked(v_actor, v_other) then
    raise exception 'You can''t contact this member.' using errcode = 'BL403';
  end if;
  return new;
end;
$$;

revoke all on function private.refuse_blocked_contact() from public, anon, authenticated;

drop trigger if exists messages_block_check on public.messages;
create trigger messages_block_check before insert on public.messages
  for each row execute function private.refuse_blocked_contact();
drop trigger if exists offers_block_check on public.offers;
create trigger offers_block_check before insert on public.offers
  for each row execute function private.refuse_blocked_contact();
drop trigger if exists offer_rounds_block_check on public.offer_rounds;
create trigger offer_rounds_block_check before insert on public.offer_rounds
  for each row execute function private.refuse_blocked_contact();
drop trigger if exists listing_questions_block_check on public.listing_questions;
create trigger listing_questions_block_check before insert on public.listing_questions
  for each row execute function private.refuse_blocked_contact();
drop trigger if exists activity_comments_block_check on public.activity_comments;
create trigger activity_comments_block_check before insert on public.activity_comments
  for each row execute function private.refuse_blocked_contact();
drop trigger if exists follows_block_check on public.follows;
create trigger follows_block_check before insert on public.follows
  for each row execute function private.refuse_blocked_contact();

-- ------------------------------------------------------------
-- N59: a suspended member's posts, replies and profile
-- ------------------------------------------------------------
-- Whether the caller shares a conversation or an order with this member —
-- so a suspended counterparty is still named on the caller's own deals.
create or replace function public.profile_shares_deal_with_me(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (select auth.uid()) is not null and (
    exists (
      select 1 from public.conversations c
       where (c.participant_a = (select auth.uid()) and c.participant_b = p_id)
          or (c.participant_b = (select auth.uid()) and c.participant_a = p_id)
    )
    or exists (
      select 1 from public.orders o
       where (o.buyer_id = (select auth.uid()) and o.seller_id = p_id)
          or (o.seller_id = (select auth.uid()) and o.buyer_id = p_id)
    )
  );
$$;

revoke all on function public.profile_shares_deal_with_me(uuid) from public;
grant execute on function public.profile_shares_deal_with_me(uuid) to anon, authenticated;

drop policy if exists "suspended profiles hidden" on public.profiles;
create policy "suspended profiles hidden" on public.profiles
  as restrictive for select to anon, authenticated
  using (
    suspended_at is null
    or id = (select auth.uid())
    or (select public.is_admin())
    or public.profile_shares_deal_with_me(id)
  );

drop policy if exists "suspended authors' posts hidden" on public.activity_posts;
create policy "suspended authors' posts hidden" on public.activity_posts
  as restrictive for select to anon, authenticated
  using (
    author_id = (select auth.uid())
    or (select public.is_admin())
    or not (author_id in (select public.suspended_profile_ids()))
  );

drop policy if exists "suspended authors' replies hidden" on public.activity_comments;
create policy "suspended authors' replies hidden" on public.activity_comments
  as restrictive for select to anon, authenticated
  using (
    author_id = (select auth.uid())
    or (select public.is_admin())
    or not (author_id in (select public.suspended_profile_ids()))
  );

-- Replies and reactions follow their post's visibility through this
-- function, which now also hides a suspended author's post.
create or replace function public.activity_post_visible(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.activity_posts p
    left join public.cars c on c.id = p.car_id
    where p.id = p_post_id
      and (
        (p.published_at is not null and (p.car_id is null or c.is_public)
         and not public.is_suspended(p.author_id))
        or p.author_id = auth.uid()
      )
  );
$$;

-- ------------------------------------------------------------
-- R-directcontact: Message seller
-- ------------------------------------------------------------
-- The seller may answer a buyer who asked about one of their listings.
-- Answers only for the caller as that listing's seller.
create or replace function public.listing_enquiry_reply_allowed(p_listing uuid, p_buyer uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.listings l
      join public.messages m on m.listing_id = l.id
     where l.id = p_listing
       and l.seller_id = (select auth.uid())
       and m.sender_id = p_buyer
       and m.recipient_id = l.seller_id
       and m.order_id is null and m.offer_id is null
  );
$$;

revoke all on function public.listing_enquiry_reply_allowed(uuid, uuid) from public, anon;
grant execute on function public.listing_enquiry_reply_allowed(uuid, uuid) to authenticated;

alter policy "senders create messages" on public.messages
  with check (
    ((select auth.uid()) = sender_id)
    and ((select auth.uid()) is distinct from recipient_id)
    and (
      (order_id is not null and exists (
        select 1 from public.orders o
         where o.id = messages.order_id
           and ((select auth.uid()) = o.buyer_id or (select auth.uid()) = o.seller_id)
           and (messages.recipient_id = o.buyer_id or messages.recipient_id = o.seller_id)))
      or (offer_id is not null and exists (
        select 1 from public.offers f join public.listings l on l.id = f.listing_id
         where f.id = messages.offer_id
           and ((select auth.uid()) = f.buyer_id or (select auth.uid()) = l.seller_id)
           and (messages.recipient_id = f.buyer_id or messages.recipient_id = l.seller_id)))
      -- A buyer asking the seller about a listing for sale (or sold)…
      or (order_id is null and offer_id is null and listing_id is not null and exists (
        select 1 from public.listings l
         where l.id = messages.listing_id
           and l.status in ('active', 'sold')
           and messages.recipient_id = l.seller_id))
      -- …and the seller answering that buyer.
      or (order_id is null and offer_id is null and listing_id is not null
          and public.listing_enquiry_reply_allowed(listing_id, recipient_id))
    )
  );

-- A listing enquiry joins the pair's conversation, like an order or an
-- offer message.
create or replace function public.message_attach_conversation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conversation_id uuid;
  v_lo uuid := least(new.sender_id, new.recipient_id);
  v_hi uuid := greatest(new.sender_id, new.recipient_id);
begin
  if new.order_id is null and new.offer_id is null and new.listing_id is null then
    return new;
  end if;

  insert into public.conversations (participant_a, participant_b)
  values (v_lo, v_hi)
  on conflict (participant_a, participant_b) do nothing;

  select id into v_conversation_id
  from public.conversations
  where participant_a = v_lo and participant_b = v_hi;

  new.conversation_id := v_conversation_id;
  return new;
end;
$$;

-- A first message to someone new (no conversation yet) is limited: 10 new
-- people a day. Replies and deal messages aren't first contact.
create or replace function private.limit_first_contact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or new.kind = 'event' or new.order_id is not null or new.offer_id is not null then
    return new;
  end if;
  if exists (
    select 1 from public.conversations c
     where c.participant_a = least(new.sender_id, new.recipient_id)
       and c.participant_b = greatest(new.sender_id, new.recipient_id)
  ) then
    return new;
  end if;
  if not public.consume_rate_limit('db-first-contact:' || v_uid::text, 10, interval '1 day') then
    raise exception 'You''ve messaged a lot of new people today — try again tomorrow.' using errcode = 'RL429';
  end if;
  return new;
end;
$$;

revoke all on function private.limit_first_contact() from public, anon, authenticated;

-- Before messages_attach_conversation (name order), so "new" means no
-- conversation existed before this message.
drop trigger if exists messages_0_first_contact on public.messages;
create trigger messages_0_first_contact before insert on public.messages
  for each row execute function private.limit_first_contact();

commit;
