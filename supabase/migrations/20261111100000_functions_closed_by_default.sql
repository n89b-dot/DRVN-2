-- Architecture remediation plan 2, item A3: a new database function is closed
-- unless a migration opens it.
--
-- Until now nothing set default privileges for functions, so a function was
-- born callable by everyone and each migration had to take that away again:
--
--   revoke all on function public.f(...) from public, anon, authenticated;
--
-- Forget the line and the function is exposed. Hundreds of functions each
-- carry one.
-- This turns the rule round: what a migration creates from here on is not
-- callable by a signed-out visitor, a signed-in member or any other role
-- until it is granted. The server role keeps what the platform gives it.
--
-- Two statements, because there are two sources of the open default:
--
--   1. PostgreSQL's own: every new function is executable by PUBLIC. Only a
--      default with no schema can take that away (a default for one schema can
--      add to the built-in privileges, never remove from them), so the first
--      statement is global to the role that runs it.
--   2. Supabase's: in schema `public`, every new function is also granted to
--      anon, authenticated and service_role. The second statement takes anon
--      and authenticated back out. service_role stays: the application's
--      server calls functions with it, and it is not reachable by a client.
--
-- Both are written for "the role running this migration", with no FOR ROLE:
-- that role is supabase_admin where CI builds the database and postgres on a
-- hosted project and a local stack, and postgres may not change another
-- role's defaults. Whichever role applies migrations is the role that creates
-- the functions, so each environment gets the rule for the role that needs it.
--
-- Nothing existing changes: default privileges apply to objects created after
-- them. Every function already in the database keeps exactly the permissions
-- it has. The explicit `revoke` lines in later migrations stay welcome; they
-- are no longer what stands between a new function and the public.
--
-- Guard: supabase/tests/functions_closed_by_default_guard.sql.

begin;

alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

commit;
