-- ============================================================================
-- 0031 — Durable conversation model (P3.2)
--
-- The inbox (/messages) had no table to read: threads were derived at request
-- time by scanning the most recent 1200 messages and collapsing them in JS,
-- which meant in-memory pagination, page-local search, and a hard horizon —
-- a quiet thread older than the scan window simply vanished. This materialises
-- the thread as a `conversations` row (one per order or offer channel), kept
-- current by triggers on `messages`, so the inbox becomes one indexed query.
--
-- Unread mechanism: a denormalised per-user counter (`conversation_unreads`)
-- maintained by the same triggers, rather than counting unread messages at
-- read time. Chosen because the inbox needs per-thread badges for a whole
-- page plus a header total in one round trip — with a counter table that is
-- a single indexed select; counting from `messages` would be a per-page
-- aggregate over an unbounded history. The triggers are the only writers
-- (floor 0 on decrement), and the read path (`read_at` update) is unchanged.
--
-- Also fixes a latent bug: `messages.listing_id` was NOT NULL from 0001, but
-- 0007 made order-context messages possible whose listing has been deleted
-- (order_items.listing_id is nullable since 0026) — sendThreadMessage
-- non-null-asserts `listingId!` today and would crash inserting such a
-- message. The column becomes nullable; `messages_has_context` still
-- requires *some* addressable context.
--
-- Idempotent: safe to re-run (create if not exists / on conflict do nothing /
-- guarded updates). The backfill recomputes last_message_* which is
-- convergent — re-running after live traffic lands on the same values the
-- triggers maintain.
-- ============================================================================

begin;

-- ============================================================
-- 1. Tables
-- ============================================================

-- One row per message channel. `type` names which ref carries the identity;
-- the check below insists exactly the matching ref is set, so a row can never
-- be ambiguous about which thread it is. Participants are the two profiles
-- from the first message; the sender/recipient pair is fixed per channel
-- (sendThreadMessage derives it from the order/offer parties every time).
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('order', 'offer')),
  order_id uuid unique references public.orders (id) on delete cascade,
  offer_id uuid unique references public.offers (id) on delete cascade,
  listing_id uuid references public.listings (id) on delete set null,
  participant_a uuid not null references public.profiles (id) on delete cascade,
  participant_b uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Denormalised "last word" so the inbox never touches `messages`. No FK on
  -- last_message_id: it is set by an AFTER INSERT trigger and a dangling
  -- pointer after a message cascade-delete is harmless (preview text stays).
  last_message_id uuid,
  last_message_at timestamptz,
  last_message_preview text,
  constraint conversations_type_ref check (
    (type = 'order' and order_id is not null and offer_id is null)
    or (type = 'offer' and offer_id is not null and order_id is null)
  )
);

-- The inbox query is "my conversations, newest word first" — one of these two
-- indexes serves each arm of the participant OR.
create index if not exists conversations_participant_a_idx
  on public.conversations (participant_a, last_message_at desc);
create index if not exists conversations_participant_b_idx
  on public.conversations (participant_b, last_message_at desc);

-- Per-user unread counters, trigger-maintained (see header for why counters
-- rather than counting messages). One row per (conversation, reader).
create table if not exists public.conversation_unreads (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  unread_count int not null default 0,
  primary key (conversation_id, user_id)
);

-- The shell badge / inbox total is "sum my counters" — index by reader.
create index if not exists conversation_unreads_user_idx
  on public.conversation_unreads (user_id);

alter table public.messages
  add column if not exists conversation_id uuid references public.conversations (id) on delete set null;

create index if not exists messages_conversation_idx
  on public.messages (conversation_id);

-- The listing_id NOT NULL fix (see header). messages_has_context (0007)
-- still guarantees a message belongs to something addressable.
alter table public.messages alter column listing_id drop not null;

-- ============================================================
-- 2. Triggers — messages drive conversations
-- ============================================================

-- BEFORE INSERT: find-or-create the conversation for the message's channel
-- and stamp conversation_id on the row. SECURITY DEFINER (matching the 0026
-- money functions) because clients insert messages under RLS and have no
-- write access to `conversations`. Concurrency-safe: the unique constraints
-- on order_id/offer_id make the insert race resolve to one row, and the
-- follow-up select reads whichever insert won.
create or replace function public.message_attach_conversation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conversation_id uuid;
begin
  -- Order takes precedence over offer, mirroring how the app addresses
  -- threads (sendThreadMessage sets exactly one; legacy rows never set both).
  if new.order_id is not null then
    insert into public.conversations (type, order_id, listing_id, participant_a, participant_b)
    values ('order', new.order_id, new.listing_id, new.sender_id, new.recipient_id)
    on conflict (order_id) do nothing;

    select id into v_conversation_id
    from public.conversations where order_id = new.order_id;
  elsif new.offer_id is not null then
    insert into public.conversations (type, offer_id, listing_id, participant_a, participant_b)
    values ('offer', new.offer_id, new.listing_id, new.sender_id, new.recipient_id)
    on conflict (offer_id) do nothing;

    select id into v_conversation_id
    from public.conversations where offer_id = new.offer_id;
  else
    -- Listing-only context (legacy shape) has no thread surface; leave it
    -- unattached, exactly as the derived inbox ignored it.
    return new;
  end if;

  new.conversation_id := v_conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_attach_conversation on public.messages;
create trigger messages_attach_conversation
  before insert on public.messages
  for each row execute function public.message_attach_conversation();

-- AFTER INSERT: bump the conversation's last word and the recipient's unread
-- counter. AFTER rather than BEFORE so last_message_id points at a row that
-- exists.
create or replace function public.message_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.conversation_id is null then
    return new;
  end if;

  update public.conversations
  set last_message_id = new.id,
      last_message_at = new.created_at,
      last_message_preview = left(new.body, 140)
  where id = new.conversation_id;

  -- A message can arrive already read in theory (read_at set on insert);
  -- only count genuinely unread arrivals.
  if new.read_at is null then
    insert into public.conversation_unreads (conversation_id, user_id, unread_count)
    values (new.conversation_id, new.recipient_id, 1)
    on conflict (conversation_id, user_id)
    do update set unread_count = public.conversation_unreads.unread_count + 1;
  end if;

  return new;
end;
$$;

drop trigger if exists messages_after_insert on public.messages;
create trigger messages_after_insert
  after insert on public.messages
  for each row execute function public.message_after_insert();

-- AFTER UPDATE OF read_at: keep the counter honest when a thread is read.
-- markThreadMessagesRead updates read_at row-by-row exactly as before — this
-- fires per row and decrements with a floor of 0, so a counter that drifted
-- (or a backfill seeded low) can never go negative.
create or replace function public.message_read_decrement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.conversation_id is not null
     and old.read_at is null
     and new.read_at is not null then
    update public.conversation_unreads
    set unread_count = greatest(unread_count - 1, 0)
    where conversation_id = new.conversation_id
      and user_id = new.recipient_id;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_read_decrement on public.messages;
create trigger messages_read_decrement
  after update of read_at on public.messages
  for each row execute function public.message_read_decrement();

-- Extend 0007's immutability guard: conversation_id is trigger-owned and must
-- not be client-rewritable (the update policy from 0006 lets recipients
-- update their rows; the guard is what limits *which* columns).
create or replace function public.guard_message_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_trusted_writer() then
    return new;
  end if;

  if new.body is distinct from old.body
     or new.sender_id is distinct from old.sender_id
     or new.recipient_id is distinct from old.recipient_id
     or new.listing_id is distinct from old.listing_id
     or new.offer_id is distinct from old.offer_id
     or new.order_id is distinct from old.order_id
     or new.conversation_id is distinct from old.conversation_id then
    raise exception 'only read_at may be updated on a message'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ============================================================
-- 3. Backfill — materialise conversations from message history
-- ============================================================

-- Participants come from the messages themselves (sender/recipient are NOT
-- NULL) rather than the order/offer rows — orders' buyer_id/seller_id go null
-- on account anonymisation (0007), which would make participant_a/b
-- unsatisfiable for exactly the threads that most need preserving.
-- `distinct on` picks the newest message per channel as the representative.

insert into public.conversations (type, order_id, listing_id, participant_a, participant_b)
select distinct on (m.order_id)
  'order', m.order_id, m.listing_id, m.sender_id, m.recipient_id
from public.messages m
where m.order_id is not null
order by m.order_id, m.created_at desc
on conflict (order_id) do nothing;

-- Order precedence: a hypothetical row carrying both refs threads on the
-- order, matching the trigger and the old derived inbox.
insert into public.conversations (type, offer_id, listing_id, participant_a, participant_b)
select distinct on (m.offer_id)
  'offer', m.offer_id, m.listing_id, m.sender_id, m.recipient_id
from public.messages m
where m.offer_id is not null and m.order_id is null
order by m.offer_id, m.created_at desc
on conflict (offer_id) do nothing;

-- Attach existing messages to their conversations (only rows not yet
-- attached, so a re-run is a no-op).
update public.messages m
set conversation_id = c.id
from public.conversations c
where m.conversation_id is null
  and ((m.order_id is not null and c.order_id = m.order_id)
    or (m.order_id is null and m.offer_id is not null and c.offer_id = m.offer_id));

-- Stamp the last word on every conversation from its newest message.
-- Convergent rather than guarded: recomputing after live traffic produces
-- the same values the triggers maintain.
update public.conversations c
set last_message_id = latest.id,
    last_message_at = latest.created_at,
    last_message_preview = left(latest.body, 140)
from (
  select distinct on (conversation_id) conversation_id, id, created_at, body
  from public.messages
  where conversation_id is not null
  order by conversation_id, created_at desc
) latest
where latest.conversation_id = c.id;

-- Seed unread counters from actual unread messages. `on conflict do nothing`
-- keeps trigger-maintained counters intact on a re-run.
insert into public.conversation_unreads (conversation_id, user_id, unread_count)
select m.conversation_id, m.recipient_id, count(*)
from public.messages m
where m.conversation_id is not null and m.read_at is null
group by m.conversation_id, m.recipient_id
on conflict (conversation_id, user_id) do nothing;

-- ============================================================
-- 4. RLS — participants read; only triggers write
-- ============================================================

alter table public.conversations enable row level security;
alter table public.conversation_unreads enable row level security;

drop policy if exists "participants read conversations" on public.conversations;
create policy "participants read conversations" on public.conversations for select
  using (auth.uid() = participant_a or auth.uid() = participant_b);

drop policy if exists "users read own unreads" on public.conversation_unreads;
create policy "users read own unreads" on public.conversation_unreads for select
  using (auth.uid() = user_id);

-- No insert/update/delete policies on either table: the SECURITY DEFINER
-- trigger functions above are the only writers from client sessions.

-- ============================================================
-- 5. Search RPC — bounded search over the caller's conversations
-- ============================================================

-- The inbox's `q` used to filter only the page already in memory. This
-- searches the caller's whole conversation set: previews, counterparty
-- names, and message bodies. SECURITY INVOKER, so the conversations /
-- messages RLS above scopes everything to the caller — no definer needed.
-- Plain ilike (no trigram index): message volume per user is modest and the
-- exists() is bounded by the caller's own threads. Pattern metacharacters in
-- p_query widen matching at worst; they cannot escape the participant filter.
create or replace function public.search_user_messages(p_query text)
returns setof uuid
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select c.id
  from public.conversations c
  left join public.profiles p
    on p.id = case when c.participant_a = auth.uid() then c.participant_b else c.participant_a end
  where (c.participant_a = auth.uid() or c.participant_b = auth.uid())
    and (
      c.last_message_preview ilike '%' || p_query || '%'
      or p.display_name ilike '%' || p_query || '%'
      or p.username ilike '%' || p_query || '%'
      or exists (
        select 1 from public.messages m
        where m.conversation_id = c.id
          and m.body ilike '%' || p_query || '%'
      )
    )
  order by c.last_message_at desc nulls last
  limit 50;
$$;

-- ============================================================
-- Self-checks
-- ============================================================
do $$
declare
  v_unattached int;
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'conversations'
  ) then
    raise exception 'SELF-CHECK FAILED: conversations missing';
  end if;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'conversation_unreads'
  ) then
    raise exception 'SELF-CHECK FAILED: conversation_unreads missing';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages'
      and column_name = 'listing_id' and is_nullable = 'NO'
  ) then
    raise exception 'SELF-CHECK FAILED: messages.listing_id still NOT NULL';
  end if;

  -- Every order/offer message must have found a conversation.
  select count(*) into v_unattached
  from public.messages
  where conversation_id is null
    and (order_id is not null or offer_id is not null);
  if v_unattached > 0 then
    raise exception 'SELF-CHECK FAILED: % order/offer messages unattached', v_unattached;
  end if;

  raise notice 'PASS: 0031 self-checks';
end $$;

commit;
