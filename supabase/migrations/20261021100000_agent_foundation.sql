-- 20261021100000 — the agent's tables (A2, agent foundation;
-- docs/decisions/agent-foundations.md and agent-data-rules.md).
--
-- Nothing here is visible to members, and no agent acts: the 'all' kill
-- switch is seeded on, so the agent stays paused for everyone until A3a turns
-- it off. (A seller who sets agent limits through the API before then does
-- tighten their own listing's floor at once: one floor, agent-foundations §6.)
--
-- Separate data for separate things:
--   * agent_mandates: the limits a member sets for one listing, as seller
--     (an agent minimum, which can only be stricter than the listing's own
--     floor; a target; a style) or buyer (a ceiling on the item price or on
--     item + shipping; a style). Versioned; every version is kept in
--     agent_mandate_versions.
--   * agent_tasks: what the agent is trying to do, with statuses working,
--     waiting_for_event, needs_approval, completed, failed, cancelled.
--   * agent_events: an append-only record of each decision and move.
--   * agent_conversations and agent_messages: the chat (unused until A3c).
--   * agent_approvals: confirm cards the owner answers.
--   * agent_jobs: the outbox the worker leases, apart from tasks so a lost
--     lease never loses the member's objective.
--   * agent_controls: the admin kill switches.
--   * agent_telemetry: operational monitoring (ids, kinds and codes only).
-- Members read their own rows (owner-only RLS); nobody writes them from the
-- API. The writers are the definer functions in 20261021100100.
-- offer_rounds gains the agent columns A1 left for A2, and
-- offer_round_terms the buyer agent's ceiling in force.
-- Idempotent.

begin;

-- ---------------------------------------------------------------------------
-- Redaction: payment-card numbers (13–19 digits passing Luhn, with spaces or
-- dashes) never get stored (agent-data-rules.md §3). The app redacts first;
-- this is the database's own backstop for any writer.
-- ---------------------------------------------------------------------------
create or replace function public.agent_luhn(p_digits text)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $function$
declare
  v_sum integer := 0;
  v_digit integer;
  v_double boolean := false;
  i integer;
begin
  if p_digits is null or p_digits !~ '^[0-9]+$' then return false; end if;
  for i in reverse length(p_digits)..1 loop
    v_digit := substr(p_digits, i, 1)::integer;
    if v_double then
      v_digit := v_digit * 2;
      if v_digit > 9 then v_digit := v_digit - 9; end if;
    end if;
    v_sum := v_sum + v_digit;
    v_double := not v_double;
  end loop;
  return v_sum % 10 = 0;
end;
$function$;

revoke all on function public.agent_luhn(text) from public, anon, authenticated;

-- A run of digit groups ("4242 4242 4242 4242 12/28") is tried group by
-- group: any 13–19 digits starting and ending on a group boundary that pass
-- Luhn are removed, so trailing digits (an expiry, a CVC) can't hide a card.
create or replace function public.agent_redact_cards(p_text text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $function$
declare
  v_out text := p_text;
  v_run text;
  v_groups text[];
  v_seps text[];
  v_digits text;
  v_span text;
  n integer;
  i integer;
  j integer;
  v_hit integer;
begin
  if p_text is null then return null; end if;
  for v_run in select (regexp_matches(p_text, '[0-9]+(?:[ -][0-9]+)*', 'g'))[1] loop
    v_groups := regexp_split_to_array(v_run, '[ -]');
    v_seps := array(select (regexp_matches(v_run, '[ -]', 'g'))[1]);
    n := coalesce(array_length(v_groups, 1), 0);
    i := 1;
    while i <= n loop
      v_digits := '';
      v_hit := null;
      for j in i..n loop
        v_digits := v_digits || v_groups[j];
        exit when length(v_digits) > 19;
        if length(v_digits) >= 13 and public.agent_luhn(v_digits) then v_hit := j; end if;
      end loop;
      if v_hit is not null then
        v_span := v_groups[i];
        for j in i + 1..v_hit loop v_span := v_span || v_seps[j - 1] || v_groups[j]; end loop;
        v_out := replace(v_out, v_span, '[card number removed]');
        i := v_hit + 1;
      else
        i := i + 1;
      end if;
    end loop;
  end loop;
  return v_out;
end;
$function$;

revoke all on function public.agent_redact_cards(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Mandates
-- ---------------------------------------------------------------------------
create table if not exists public.agent_mandates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  scope text not null check (scope in ('seller', 'buyer')),
  listing_id uuid not null references public.listings(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'paused', 'revoked', 'ended')),
  version integer not null default 1 check (version > 0),
  -- Seller: the agent's minimum (the effective floor is the higher of this
  -- and the listing's own floor) and its target. Buyer: the ceiling.
  minimum_cents integer check (minimum_cents is null or minimum_cents > 0),
  target_cents integer check (target_cents is null or target_cents > 0),
  ceiling_cents integer check (ceiling_cents is null or ceiling_cents > 0),
  ceiling_basis text check (ceiling_basis is null or ceiling_basis in ('item', 'total')),
  style text not null default 'balanced' check (style in ('firm', 'balanced', 'flexible')),
  expires_at timestamptz,
  -- The seller's once-per-listing acknowledgement that the agent's counters
  -- are binding (AG-6 / O-5).
  binding_acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint agent_mandates_shape check (
    (scope = 'seller' and ceiling_cents is null and ceiling_basis is null and binding_acknowledged_at is not null)
    or (scope = 'buyer' and ceiling_cents is not null and ceiling_basis is not null and minimum_cents is null)
  ),
  constraint agent_mandates_ended check ((status in ('revoked', 'ended')) = (ended_at is not null))
);

comment on table public.agent_mandates is
  'The limits a member set for their agent on one listing (20261021100000). Owner-only. An agent minimum can only make the floor stricter.';

create unique index if not exists agent_mandates_one_live
  on public.agent_mandates(owner_id, scope, listing_id) where status in ('active', 'paused');
create index if not exists agent_mandates_listing_idx on public.agent_mandates(listing_id) where status in ('active', 'paused');
create index if not exists agent_mandates_ended_idx on public.agent_mandates(ended_at) where ended_at is not null;

create table if not exists public.agent_mandate_versions (
  mandate_id uuid not null references public.agent_mandates(id) on delete cascade,
  version integer not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  status text not null,
  minimum_cents integer,
  target_cents integer,
  ceiling_cents integer,
  ceiling_basis text,
  style text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (mandate_id, version)
);

comment on table public.agent_mandate_versions is
  'Every version of every mandate, as set (20261021100000). Append-only; goes with its mandate.';

create or replace function public.agent_record_mandate_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if tg_op = 'UPDATE' and new.version = old.version then
    -- A status change keeps the version; keep the stored row in step.
    update public.agent_mandate_versions set status = new.status
    where mandate_id = new.id and version = new.version;
    return null;
  end if;
  insert into public.agent_mandate_versions(mandate_id, version, owner_id, status, minimum_cents, target_cents,
    ceiling_cents, ceiling_basis, style, expires_at)
  values (new.id, new.version, new.owner_id, new.status, new.minimum_cents, new.target_cents,
    new.ceiling_cents, new.ceiling_basis, new.style, new.expires_at)
  on conflict (mandate_id, version) do nothing;
  return null;
end;
$function$;

revoke all on function public.agent_record_mandate_version() from public, anon, authenticated;

drop trigger if exists agent_mandates_record_version on public.agent_mandates;
create trigger agent_mandates_record_version
  after insert or update of version, status on public.agent_mandates
  for each row execute function public.agent_record_mandate_version();

-- Mandate lifecycle: active ↔ paused; either → revoked (the owner) or ended
-- (sold, offer finished, expired). Revoked and ended are final.
create or replace function public.guard_agent_mandate_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if new.status = old.status then return new; end if;
  if old.status in ('revoked', 'ended')
     or not (old.status, new.status) in (('active', 'paused'), ('paused', 'active'), ('active', 'revoked'),
       ('paused', 'revoked'), ('active', 'ended'), ('paused', 'ended')) then
    raise exception 'Mandate cannot move from % to %', old.status, new.status using errcode = '23514';
  end if;
  return new;
end;
$function$;

drop trigger if exists agent_mandates_status_guard on public.agent_mandates;
create trigger agent_mandates_status_guard
  before update of status on public.agent_mandates
  for each row execute function public.guard_agent_mandate_status();

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create table if not exists public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  mandate_id uuid references public.agent_mandates(id) on delete set null,
  scope text not null check (scope in ('seller', 'buyer', 'garage')),
  objective text not null check (length(objective) between 1 and 500),
  status text not null default 'working'
    check (status in ('working', 'waiting_for_event', 'needs_approval', 'completed', 'failed', 'cancelled')),
  listing_id uuid references public.listings(id) on delete set null,
  offer_id uuid references public.offers(id) on delete set null,
  outcome text check (outcome is null or length(outcome) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint agent_tasks_finished check ((status in ('completed', 'failed', 'cancelled')) = (finished_at is not null))
);

comment on table public.agent_tasks is
  'What the agent is trying to do for its owner (20261021100000). Owner-only; open until done, finished ones kept 12 months.';

create index if not exists agent_tasks_owner_idx on public.agent_tasks(owner_id, created_at desc);
create index if not exists agent_tasks_mandate_idx on public.agent_tasks(mandate_id);
create index if not exists agent_tasks_open_idx on public.agent_tasks(status, updated_at) where finished_at is null;
create index if not exists agent_tasks_finished_idx on public.agent_tasks(finished_at) where finished_at is not null;

create or replace function public.guard_agent_task_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if tg_op = 'INSERT' then
    new.objective := public.agent_redact_cards(new.objective);
    return new;
  end if;
  if new.objective is distinct from old.objective then
    new.objective := public.agent_redact_cards(new.objective);
  end if;
  if new.status = old.status then return new; end if;
  if old.status in ('completed', 'failed', 'cancelled') then
    raise exception 'Task is finished' using errcode = '23514';
  end if;
  new.updated_at := now();
  new.finished_at := case when new.status in ('completed', 'failed', 'cancelled') then now() end;
  return new;
end;
$function$;

drop trigger if exists agent_tasks_status_guard on public.agent_tasks;
create trigger agent_tasks_status_guard
  before insert or update on public.agent_tasks
  for each row execute function public.guard_agent_task_status();

-- ---------------------------------------------------------------------------
-- Jobs: the outbox
-- ---------------------------------------------------------------------------
create table if not exists public.agent_jobs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.agent_tasks(id) on delete cascade,
  kind text not null check (kind in ('offer_turn', 'offer_open')),
  -- The one agent_* write this job may make.
  expected_action text not null check (expected_action in ('offer_move', 'offer_open')),
  listing_id uuid not null references public.listings(id) on delete cascade,
  offer_id uuid references public.offers(id) on delete cascade,
  round_no integer,
  dedup_key text not null unique check (length(dedup_key) between 8 and 300),
  status text not null default 'pending' check (status in ('pending', 'leased', 'done', 'failed', 'cancelled', 'dead')),
  attempts integer not null default 0,
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  lease_id uuid,
  lease_expires_at timestamptz,
  available_at timestamptz not null default now(),
  last_error text check (last_error is null or length(last_error) <= 200),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint agent_jobs_shape check (
    (kind = 'offer_turn' and expected_action = 'offer_move' and offer_id is not null and round_no is not null)
    or (kind = 'offer_open' and expected_action = 'offer_open' and offer_id is null)
  ),
  constraint agent_jobs_lease check ((status = 'leased') = (lease_id is not null and lease_expires_at is not null)),
  constraint agent_jobs_finished check ((status in ('done', 'failed', 'cancelled', 'dead')) = (finished_at is not null))
);

comment on table public.agent_jobs is
  'The agent outbox (20261021100000): written in the same transaction as the event, leased by agent_worker. Ids and states only; kept 30 days after it finishes.';

create index if not exists agent_jobs_ready_idx on public.agent_jobs(available_at) where status = 'pending';
create index if not exists agent_jobs_leased_idx on public.agent_jobs(lease_expires_at) where status = 'leased';
create index if not exists agent_jobs_task_idx on public.agent_jobs(task_id);
create index if not exists agent_jobs_offer_idx on public.agent_jobs(offer_id) where offer_id is not null;
create index if not exists agent_jobs_finished_idx on public.agent_jobs(finished_at) where finished_at is not null;

-- ---------------------------------------------------------------------------
-- Events: append-only
-- ---------------------------------------------------------------------------
create table if not exists public.agent_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  task_id uuid references public.agent_tasks(id) on delete cascade,
  job_id uuid references public.agent_jobs(id) on delete set null,
  mandate_id uuid references public.agent_mandates(id) on delete set null,
  mandate_version integer,
  kind text not null check (kind in ('decision', 'move', 'approval', 'status', 'tool_call')),
  -- The event that started this: an offer round, a mandate change, an owner's answer.
  initiated_by text check (initiated_by is null or length(initiated_by) <= 200),
  inputs jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  idempotency_key text check (idempotency_key is null or length(idempotency_key) <= 300),
  created_at timestamptz not null default now()
);

comment on table public.agent_events is
  'Append-only record of what the agent decided and did (20261021100000). Owner-only; kept 12 months.';

create index if not exists agent_events_task_idx on public.agent_events(task_id, created_at);
create index if not exists agent_events_owner_idx on public.agent_events(owner_id, created_at desc);
create index if not exists agent_events_created_idx on public.agent_events(created_at);

-- Updates are never allowed. Deletes only through the purge and retention
-- functions (which set drvn.agent_purge) or a cascade from the owner.
create or replace function public.guard_agent_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if tg_op = 'UPDATE' then
    -- A cascade from a deleted job or mandate only clears its link.
    if pg_trigger_depth() > 1
       and (to_jsonb(new) - 'job_id' - 'mandate_id') = (to_jsonb(old) - 'job_id' - 'mandate_id') then
      return new;
    end if;
    raise exception '% is append-only', tg_table_name using errcode = '42501';
  end if;
  if pg_trigger_depth() > 1 or current_setting('drvn.agent_purge', true) = 'on' then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$function$;

-- Whatever a decision carried (a reason, a tool's input) is scrubbed of card
-- numbers before it is kept, like chat (agent-data-rules.md §3).
create or replace function public.agent_redact_event()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  begin
    new.inputs := public.agent_redact_cards(new.inputs::text)::jsonb;
    new.result := public.agent_redact_cards(new.result::text)::jsonb;
  exception when others then
    new.inputs := jsonb_build_object('redacted', true);
    new.result := jsonb_build_object('redacted', true);
  end;
  return new;
end;
$function$;

drop trigger if exists agent_events_redact on public.agent_events;
create trigger agent_events_redact
  before insert on public.agent_events
  for each row execute function public.agent_redact_event();

drop trigger if exists agent_events_append_only on public.agent_events;
create trigger agent_events_append_only
  before update or delete on public.agent_events
  for each row execute function public.guard_agent_append_only();

drop trigger if exists agent_mandate_versions_append_only on public.agent_mandate_versions;
create trigger agent_mandate_versions_append_only
  before delete on public.agent_mandate_versions
  for each row execute function public.guard_agent_append_only();

-- ---------------------------------------------------------------------------
-- Conversations (chat only; first used in A3c)
-- ---------------------------------------------------------------------------
create table if not exists public.agent_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

comment on table public.agent_conversations is
  'One agent chat thread per member (20261021100000). Owner-only; kept 12 months from the last message.';

create table if not exists public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.agent_conversations(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('member', 'agent')),
  body text not null check (length(body) between 1 and 8000),
  task_id uuid references public.agent_tasks(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.agent_messages is
  'Messages in the agent chat (20261021100000). Card numbers are removed before storing.';

create index if not exists agent_messages_conversation_idx on public.agent_messages(conversation_id, created_at);

create or replace function public.agent_redact_message()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  new.body := public.agent_redact_cards(new.body);
  return new;
end;
$function$;

drop trigger if exists agent_messages_redact on public.agent_messages;
create trigger agent_messages_redact
  before insert or update of body on public.agent_messages
  for each row execute function public.agent_redact_message();

create index if not exists agent_conversations_last_idx on public.agent_conversations(last_message_at);

-- ---------------------------------------------------------------------------
-- Approvals
-- ---------------------------------------------------------------------------
create table if not exists public.agent_approvals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  task_id uuid not null references public.agent_tasks(id) on delete cascade,
  kind text not null check (kind in ('accept_offer')),
  offer_id uuid references public.offers(id) on delete cascade,
  round_no integer,
  amount_cents integer check (amount_cents is null or amount_cents > 0),
  reason text check (reason is null or length(reason) <= 200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'dismissed', 'superseded')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint agent_approvals_decided check ((status = 'pending') = (decided_at is null))
);

comment on table public.agent_approvals is
  'Confirm cards: what the agent proposed and what the owner chose (20261021100000). Owner-only; kept with the task.';

create or replace function public.agent_redact_approval()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  new.reason := public.agent_redact_cards(new.reason);
  return new;
end;
$function$;

drop trigger if exists agent_approvals_redact on public.agent_approvals;
create trigger agent_approvals_redact
  before insert or update of reason on public.agent_approvals
  for each row execute function public.agent_redact_approval();

create unique index if not exists agent_approvals_one_pending
  on public.agent_approvals(task_id, offer_id, round_no) where status = 'pending';
create index if not exists agent_approvals_owner_idx on public.agent_approvals(owner_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Kill switches
-- ---------------------------------------------------------------------------
create table if not exists public.agent_controls (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('all', 'buyer', 'seller', 'member', 'mandate', 'listing', 'account')),
  subject_id uuid,
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  set_by uuid references public.profiles(id) on delete set null,
  set_at timestamptz not null default now(),
  cleared_by uuid references public.profiles(id) on delete set null,
  cleared_at timestamptz,
  constraint agent_controls_subject check ((scope in ('all', 'buyer', 'seller')) = (subject_id is null))
);

comment on table public.agent_controls is
  'Admin kill switches for the agent (20261021100000). A row with cleared_at null is on. ''member'' stops one member''s agent; ''account'' stops every agent acting for or against that account; ''listing'' every agent on that listing.';

create unique index if not exists agent_controls_one_live
  on public.agent_controls(scope, coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where cleared_at is null;

-- The agent starts paused for everyone. A3a clears this row.
insert into public.agent_controls(scope, subject_id, reason)
select 'all', null, 'Agents are off until the A3a beta turns them on (20261021100000).'
where not exists (select 1 from public.agent_controls where scope = 'all');

-- ---------------------------------------------------------------------------
-- Operational telemetry (separate from product analytics)
-- ---------------------------------------------------------------------------
create table if not exists public.agent_telemetry (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('permission_denied', 'model_error', 'stuck_task', 'stale_job',
    'repeated_decision', 'outbox_reconciled', 'job_dead', 'job_failed')),
  code text check (code is null or length(code) <= 40),
  task_id uuid references public.agent_tasks(id) on delete set null,
  job_id uuid references public.agent_jobs(id) on delete set null,
  owner_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.agent_telemetry is
  'Agent monitoring: kinds, codes and ids, never text, amounts or limits (20261021100000). Kept 30 days.';

create index if not exists agent_telemetry_created_idx on public.agent_telemetry(created_at);
create index if not exists agent_telemetry_kind_idx on public.agent_telemetry(kind, created_at desc);

-- ---------------------------------------------------------------------------
-- Offer rounds: who acted, when it was the agent (A1 left these for A2)
-- ---------------------------------------------------------------------------
alter table public.offer_rounds add column if not exists actor_task_id uuid references public.agent_tasks(id) on delete set null;
alter table public.offer_rounds add column if not exists actor_job_id uuid references public.agent_jobs(id) on delete set null;
alter table public.offer_rounds add column if not exists mandate_version integer;
alter table public.offer_rounds drop constraint if exists offer_rounds_agent_shape;
alter table public.offer_rounds add constraint offer_rounds_agent_shape
  check (actor_task_id is null or (actor_role in ('buyer', 'seller') and mandate_version is not null));

comment on column public.offer_rounds.actor_task_id is
  'Set when the agent made this move (the "via agent" label, A3a). The job and mandate version say under what authority.';

alter table public.offer_round_terms add column if not exists buyer_ceiling_cents integer
  check (buyer_ceiling_cents is null or buyer_ceiling_cents > 0);

-- ---------------------------------------------------------------------------
-- Admin audit can name the agent as a subject (kill switches, mandates).
-- ---------------------------------------------------------------------------
-- Built from the constraint as it stands, so a value another migration added
-- (B1's product_review) is kept. The definition reads either as
-- IN ('a', 'b') or, once rebuilt, as = ANY ('{a,b}'::text[]); both are parsed.
do $$
declare
  v_def text;
  v_values text[];
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.admin_audit_log'::regclass and c.conname = 'admin_audit_log_subject_type_check';
  select array_agg(distinct v order by v) into v_values
  from (
    select (regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g'))[1] as v
    union select unnest(string_to_array(substring(coalesce(v_def, '') from '''[{]([a-z_,]+)[}]'''), ','))
    union select unnest(array['order', 'listing', 'user', 'report', 'dispute', 'payment', 'agent'])
  ) x
  where v is not null;
  alter table public.admin_audit_log drop constraint if exists admin_audit_log_subject_type_check;
  execute format('alter table public.admin_audit_log add constraint admin_audit_log_subject_type_check check (subject_type = any (%L::text[]))', v_values);
end $$;

-- ---------------------------------------------------------------------------
-- Row security: owners read their own; nobody writes from the API.
-- ---------------------------------------------------------------------------
alter table public.agent_mandates enable row level security;
alter table public.agent_mandate_versions enable row level security;
alter table public.agent_tasks enable row level security;
alter table public.agent_jobs enable row level security;
alter table public.agent_events enable row level security;
alter table public.agent_conversations enable row level security;
alter table public.agent_messages enable row level security;
alter table public.agent_approvals enable row level security;
alter table public.agent_controls enable row level security;
alter table public.agent_telemetry enable row level security;

revoke all on public.agent_mandates, public.agent_mandate_versions, public.agent_tasks, public.agent_jobs,
  public.agent_events, public.agent_conversations, public.agent_messages, public.agent_approvals,
  public.agent_controls, public.agent_telemetry
  from public, anon, authenticated, service_role;

grant select on public.agent_mandates, public.agent_mandate_versions, public.agent_tasks, public.agent_events,
  public.agent_conversations, public.agent_messages, public.agent_approvals
  to authenticated;
-- The service role reads for the export worker and the admin console; it
-- changes nothing directly (deletion and retention run through functions).
grant select on public.agent_mandates, public.agent_mandate_versions, public.agent_tasks, public.agent_jobs,
  public.agent_events, public.agent_conversations, public.agent_messages, public.agent_approvals,
  public.agent_controls, public.agent_telemetry
  to service_role;

drop policy if exists "owners read their mandates" on public.agent_mandates;
create policy "owners read their mandates" on public.agent_mandates
  for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists "owners read their mandate versions" on public.agent_mandate_versions;
create policy "owners read their mandate versions" on public.agent_mandate_versions
  for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists "owners read their tasks" on public.agent_tasks;
create policy "owners read their tasks" on public.agent_tasks
  for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists "owners read their events" on public.agent_events;
create policy "owners read their events" on public.agent_events
  for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists "owners read their conversation" on public.agent_conversations;
create policy "owners read their conversation" on public.agent_conversations
  for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists "owners read their messages" on public.agent_messages;
create policy "owners read their messages" on public.agent_messages
  for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists "owners read their approvals" on public.agent_approvals;
create policy "owners read their approvals" on public.agent_approvals
  for select to authenticated using (owner_id = (select auth.uid()));
-- agent_jobs, agent_controls and agent_telemetry: no client policy at all.

commit;
