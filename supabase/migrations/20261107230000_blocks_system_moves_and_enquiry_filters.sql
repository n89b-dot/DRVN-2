-- OS-W32 follow-up to 20261107220600 (blocks and Message seller), from the
-- GPT review of PR #121.
--
--   1. P1  A block broke checkout after payment. A offers on B's listing, B
--          blocks A, C buys it: purchase_finalize expires A's offer, the round
--          recorder writes a system 'expire' round, and the offer_rounds block
--          check refused it (BL403), rolling back the finalisation of a
--          payment that had already succeeded. The expiry cron
--          (release_expired_reservations) failed the same way, and so would
--          any other round DRVN writes itself (account deletion's expiry, a
--          system withdrawal). Moves that only end a negotiation are now
--          exempt: any round DRVN writes (actor_role 'system'), any expiry,
--          a decline by either party and a withdrawal by the offer's maker
--          (the coordinator's ruling on #128, in line with Neil's block
--          ruling: a block stops new messages, offers, follows and replies).
--          New offers, counters, accepts and below-minimum attempts by a
--          member or the agent are still refused.
--   2. P1  Forged events skipped the block check and the first-contact limit.
--          Both skip kind = 'event' (lifecycle notes are DRVN's), but
--          guard_message_insert only turns a member's 'event' back into a
--          'message' after them (triggers fire in name order). A member can
--          no longer write an event at all: messages_00_member_events runs
--          first and refuses it (42501). Server paths (service role, and
--          definer functions, whose current_user is their owner) still write
--          events.
--   3. P2  A follow that passed its check before a concurrent block committed
--          survived the block. Every contact write and every block now take
--          the same per-pair advisory lock before they check or clean up:
--          the follow rechecks the block after the lock, and the block's
--          clean-up deletes follows after the lock, so whichever commits
--          second sees the other.
--   4. P2  Listing enquiries vanished from the Buying and Selling inbox
--          filters, which looked only for an order or offer between the two.
--          list_conversations now counts a listing enquiry in the pair's
--          conversation too.
--
-- Restated from their latest definitions: private.refuse_blocked_contact and
-- private.block_ends_follows (20261107220600), public.list_conversations
-- (20260928140000). New: private.member_pair_lock_key, private.lock_member_pair,
-- private.refuse_member_events and the messages_00_member_events trigger. No
-- money rule changes.

begin;

-- ------------------------------------------------------------
-- 3. One advisory lock per member pair, the same whichever way round.
-- ------------------------------------------------------------
create or replace function private.member_pair_lock_key(p_a uuid, p_b uuid)
returns bigint
language sql
immutable
set search_path = public, pg_temp
as $$
  select hashtextextended('member-pair:' || least(p_a, p_b)::text || ':' || greatest(p_a, p_b)::text, 0);
$$;

revoke all on function private.member_pair_lock_key(uuid, uuid) from public, anon, authenticated;

create or replace function private.lock_member_pair(p_a uuid, p_b uuid)
returns void
language sql
volatile
set search_path = public, pg_temp
as $$
  select pg_advisory_xact_lock(private.member_pair_lock_key(p_a, p_b));
$$;

revoke all on function private.lock_member_pair(uuid, uuid) from public, anon, authenticated;

comment on function private.lock_member_pair(uuid, uuid) is
  'OS-W32: serialises a block with contact writes between the same two members (held to commit).';

-- Blocking ends the follows between the two, both ways. The pair lock first:
-- a follow that checked before this block committed has either committed
-- (and this delete, a fresh statement after the lock, sees it) or waits for
-- the lock and then sees the block.
create or replace function private.block_ends_follows()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.lock_member_pair(new.blocker_id, new.blocked_id);
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
      -- Lifecycle events are DRVN's, not the member's. Only a trusted
      -- writer can get here with one: messages_00_member_events refuses a
      -- member's.
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
      -- Moves that end a negotiation only reduce contact, so a block never
      -- stops them: DRVN's own moves (a lapsed offer expiring, rival offers
      -- expiring when the part sells — purchase_finalize, after the payment
      -- succeeded — a withdrawal DRVN makes), any expiry, a decline by
      -- either party, and the offer's maker withdrawing it. Refusing them
      -- would roll back the work they're part of, or leave the blocked
      -- offer stuck open. New proposals and agreement — an offer, a
      -- counter, an accept, a below-minimum attempt — by a member or the
      -- agent are still refused.
      if new.actor_role = 'system'
         or new.kind in ('expire', 'decline')
         or (new.kind = 'withdraw' and new.actor_role = 'buyer') then
        return new;
      end if;
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
  if v_actor is null or v_other is null or v_actor = v_other then
    return new;
  end if;
  -- Serialise with a concurrent block between the two, then check: this
  -- statement runs after the lock, so it sees a block that committed while
  -- this write waited.
  perform private.lock_member_pair(v_actor, v_other);
  if private.either_blocked(v_actor, v_other) then
    raise exception 'You can''t contact this member.' using errcode = 'BL403';
  end if;
  return new;
end;
$$;

revoke all on function private.refuse_blocked_contact() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 2. A member can't write a lifecycle event.
-- ------------------------------------------------------------
-- Invoker, so is_trusted_writer() sees the real writer: a member's own
-- token is refused; the service role and definer functions (current_user is
-- their owner) are trusted. Named to fire before every other insert trigger
-- on messages (messages_0_first_contact, messages_block_check,
-- messages_guard_insert, and any quota trigger), so nothing downstream ever
-- sees a forged event.
create or replace function private.refuse_member_events()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.kind is distinct from 'message' and not public.is_trusted_writer() then
    raise exception 'Only DRVN writes lifecycle events.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.refuse_member_events() from public, anon, authenticated;

drop trigger if exists messages_00_member_events on public.messages;
create trigger messages_00_member_events before insert on public.messages
  for each row execute function private.refuse_member_events();

-- ------------------------------------------------------------
-- 4. The inbox filters count listing enquiries.
-- ------------------------------------------------------------
-- Restated from 20260928140000; the only change is the enquiry branch in
-- each of the buying and selling filters: a message in this conversation
-- about a listing, with no offer or order, where the listing is theirs
-- (buying) or mine (selling).
create or replace function public.list_conversations(
  p_filter text default 'all',
  p_query text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  counterparty_id uuid,
  last_message_id uuid,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count int,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with mine as (
    select
      c.id, c.last_message_id, c.last_message_at, c.last_message_preview,
      case when c.participant_a = auth.uid() then c.participant_b else c.participant_a end as other
    from public.conversations c
    where auth.uid() in (c.participant_a, c.participant_b)
  ),
  scored as (
    select m.*, coalesce(u.unread_count, 0) as unread
    from mine m
    left join public.conversation_unreads u
      on u.conversation_id = m.id and u.user_id = auth.uid()
  ),
  filtered as (
    select s.*
    from scored s
    where (
      coalesce(p_filter, 'all') = 'all'
      or (p_filter = 'unread' and s.unread > 0)
      or (p_filter = 'buying' and (
        exists (select 1 from public.orders o where o.buyer_id = auth.uid() and o.seller_id = s.other)
        or exists (
          select 1 from public.offers f join public.listings l on l.id = f.listing_id
          where f.buyer_id = auth.uid() and l.seller_id = s.other
        )
        or exists (
          select 1 from public.messages mm join public.listings l on l.id = mm.listing_id
          where mm.conversation_id = s.id and mm.order_id is null and mm.offer_id is null
            and l.seller_id = s.other
        )
      ))
      or (p_filter = 'selling' and (
        exists (select 1 from public.orders o where o.seller_id = auth.uid() and o.buyer_id = s.other)
        or exists (
          select 1 from public.offers f join public.listings l on l.id = f.listing_id
          where l.seller_id = auth.uid() and f.buyer_id = s.other
        )
        or exists (
          select 1 from public.messages mm join public.listings l on l.id = mm.listing_id
          where mm.conversation_id = s.id and mm.order_id is null and mm.offer_id is null
            and l.seller_id = auth.uid()
        )
      ))
    )
    and (
      nullif(btrim(coalesce(p_query, '')), '') is null
      or s.last_message_preview ilike '%' || btrim(p_query) || '%'
      or exists (
        select 1 from public.profiles p
        where p.id = s.other
          and (p.display_name ilike '%' || btrim(p_query) || '%' or p.username ilike '%' || btrim(p_query) || '%')
      )
      or exists (
        select 1 from public.messages mm
        where mm.conversation_id = s.id and mm.body ilike '%' || btrim(p_query) || '%'
      )
      or exists (
        select 1 from public.messages mm
        join public.listings l on l.id = mm.listing_id
        where mm.conversation_id = s.id and l.title ilike '%' || btrim(p_query) || '%'
      )
    )
  )
  select f.id, f.other, f.last_message_id, f.last_message_at, f.last_message_preview,
         f.unread::int, count(*) over ()
  from filtered f
  order by f.last_message_at desc nulls last, f.id
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_conversations(text, text, int, int) from public, anon;
grant execute on function public.list_conversations(text, text, int, int) to authenticated;

commit;
