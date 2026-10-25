-- AG-7: a member-level agent setting — Off · Suggest · Act within my limits
-- (PRD §4.9; readiness 64). One column on the member's own profile:
--   * 'act'     — today's behaviour: mandates can be started, the chat and
--                 price-drop suggestions work.
--   * 'suggest' — suggestions and the chat work; no mandate can be started.
--   * 'off'     — nothing: the entry points are disabled in the app.
-- The worker needs no change: it only ever acts on a live mandate, and the
-- app refuses to start one unless the mode is 'act' (and ends the live ones
-- when the member turns it down). The column has no client select grant,
-- like default_offer_floor_pct: the member reads it server-side, and nobody
-- else needs to know how someone configured their agent.
-- Idempotent.

begin;

alter table public.profiles
  add column if not exists agent_mode text not null default 'act';

alter table public.profiles drop constraint if exists profiles_agent_mode_check;
alter table public.profiles add constraint profiles_agent_mode_check
  check (agent_mode in ('off', 'suggest', 'act'));

comment on column public.profiles.agent_mode is
  'AG-7: how far the member''s agent may go — off, suggest (no mandates), act (20261026130000). Owner-written; no client select grant.';

-- The owner sets it through the existing "users update own profile" policy;
-- 0017 replaced the table-wide update grant with a column list, so the new
-- column is added to it here. Reads stay server-side.
grant update (agent_mode) on public.profiles to authenticated;

commit;
