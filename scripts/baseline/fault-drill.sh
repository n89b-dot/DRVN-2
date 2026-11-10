#!/usr/bin/env bash
# Plan 2 item A6, rule R6: the comparison is trusted only after it has been
# seen to fail. Each fault below is done to database B on purpose, the four
# comparisons are run, the fault is undone, and at the end the comparison must
# be empty again. A fault that no comparison reports fails the drill.
#
#   bash scripts/baseline/fault-drill.sh <url of A> <url of B (a throwaway built from the baseline)> [out dir]
#
# B must be a throwaway: this script changes it. It refuses anything that is
# not 127.0.0.1 on a disposable port (or 5432 in CI).
set -uo pipefail

A="${1:?url of the database built from the migration files}"
B="${2:?url of the THROWAWAY database built from the baseline}"
out="${3:-$(mktemp -d)}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$out"

case "$B" in
  *@127.0.0.1:55440/*|*@127.0.0.1:55441/*|*@127.0.0.1:55442/*) ;;
  *@127.0.0.1:5432/*|*@localhost:5432/*) [ "${CI:-}" = "true" ] || { echo "fault-drill: port 5432 is accepted only in CI." >&2; exit 2; } ;;
  *) echo "fault-drill: B must be a disposable database on 127.0.0.1 (55440, 55441 or 55442). It is changed on purpose." >&2; exit 2 ;;
esac

b() { psql "$B" -X -At -q -v ON_ERROR_STOP=1 "$@"; }
# A does not change during the drill, so it is captured once.
compare() { bash "$root/scripts/baseline/compare.sh" capture "$B" "$1" >"$1.log" 2>&1 && bash "$root/scripts/baseline/compare.sh" compare "$out/A" "$1" >>"$1.log" 2>&1; }

# Definitions the undo steps need, read before anything is changed.
policy="members never delete media or evidence"
policy_sql="$(b -c "select format('create policy %I on storage.objects as %s for %s to %s%s%s', pol.polname, case when pol.polpermissive then 'permissive' else 'restrictive' end, case pol.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'all' end, (select string_agg(case when x = 0 then 'public' else quote_ident((select rolname from pg_roles where oid = x)) end, ', ') from unnest(pol.polroles) x), coalesce(' using (' || pg_get_expr(pol.polqual, pol.polrelid) || ')', ''), coalesce(' with check (' || pg_get_expr(pol.polwithcheck, pol.polrelid) || ')', '')) from pg_policy pol where pol.polrelid = 'storage.objects'::regclass and pol.polname = '$policy'")"
trigger_sql="$(b -c "select pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created'")"
index_sql="$(b -c "select pg_get_indexdef('public.listings_active_created_idx'::regclass)")"
b -c "select pg_get_functiondef('private.account_deletion_lock_key(uuid)'::regprocedure)" >"$out/function-original.sql"
sed 's/account-deletion:/account-deletion-fault:/' "$out/function-original.sql" >"$out/function-fault.sql"
reason="$(b -c "select reason from private.reserved_usernames where username = 'admin'")"
[ -n "$policy_sql" ] && [ -n "$trigger_sql" ] && [ -n "$index_sql" ] && [ -n "$reason" ] && ! cmp -s "$out/function-original.sql" "$out/function-fault.sql" \
  || { echo "fault-drill: could not read what the undo steps need from B; is it built from the baseline?" >&2; exit 2; }

# name | SQL that does it | SQL that undoes it
faults=(
  "a function closed to visitors is opened to anon (one revoke removed)|grant execute on function private.scheduled_job_inventory() to anon|revoke execute on function private.scheduled_job_inventory() from anon"
  "a function left executable through PUBLIC only|grant execute on function private.scheduled_job_inventory() to public|revoke execute on function private.scheduled_job_inventory() from public"
  "a column-level grant removed|revoke select (paid_at) on table public.seller_carry_payouts from authenticated|grant select (paid_at) on table public.seller_carry_payouts to authenticated"
  "a table visitors cannot read is opened to anon|grant select on table public.admin_audit_log to anon|revoke select on table public.admin_audit_log from anon"
  "one storage rule dropped|drop policy \"$policy\" on storage.objects|$policy_sql"
  "the sign-up trigger dropped|drop trigger on_auth_user_created on auth.users|$trigger_sql"
  "one scheduled job's time changed|select cron.alter_job((select jobid from cron.job where jobname = 'drvn-ledger-reconciliation'), schedule := '51 5 * * *')|select cron.alter_job((select jobid from cron.job where jobname = 'drvn-ledger-reconciliation'), schedule := '50 5 * * *')"
  "one scheduled job removed|select cron.unschedule('drvn-ledger-reconciliation')|select cron.schedule('drvn-ledger-reconciliation', '50 5 * * *', \$job\$select public.invoke_remediation_worker('ledger-reconciliation');\$job\$)"
  "the payout hold changed by a day|update public.settlement_settings set payout_hold_days = payout_hold_days + 1|update public.settlement_settings set payout_hold_days = payout_hold_days - 1"
  "one reserved username deleted|delete from private.reserved_usernames where username = 'admin'|insert into private.reserved_usernames (username, reason) values ('admin', '$reason')"
  "one index dropped|drop index public.listings_active_created_idx|$index_sql"
  "one line of one function changed|\\i $out/function-fault.sql|\\i $out/function-original.sql"
  "a storage bucket made public|update storage.buckets set public = true where id = 'message-photos'|update storage.buckets set public = false where id = 'message-photos'"
  "row-level security switched off on one table|alter table public.orders disable row level security|alter table public.orders enable row level security"
  "a table added outside our schemas|create table storage.drvn_fault_drill (id int)|drop table storage.drvn_fault_drill"
  "one reserved username added|insert into private.reserved_usernames (username, reason) values ('drvnfaultdrill', '$reason')|delete from private.reserved_usernames where username = 'drvnfaultdrill'"
)

bash "$root/scripts/baseline/compare.sh" capture "$A" "$out/A" >"$out/A.log" 2>&1 || { echo "fault-drill: could not read A:" >&2; cat "$out/A.log" >&2; exit 2; }
compare "$out/before" || { echo "fault-drill: A and B differ before any fault was made. Fix that first:" >&2; cat "$out/before.log" >&2; exit 2; }
echo "Before any fault: all four comparisons identical."

missed=0
n=0
for fault in "${faults[@]}"; do
  n=$((n + 1))
  IFS='|' read -r name do_sql undo_sql <<<"$fault"
  if ! printf '%s\n' "$do_sql;" | b -f - >"$out/fault-$n.do.log" 2>&1; then echo "fault-drill: could not make fault $n ($name):"; cat "$out/fault-$n.do.log"; exit 2; fi
  if compare "$out/fault-$n"; then
    caught="NOT REPORTED"; missed=$((missed + 1))
  else
    caught="reported by comparison $(grep '^DIFFERENT' "$out/fault-$n.log" | sed -E 's/^DIFFERENT +([0-9]).*/\1/' | paste -sd, -)"
  fi
  if ! printf '%s\n' "$undo_sql;" | b -f - >"$out/fault-$n.undo.log" 2>&1; then echo "fault-drill: could not undo fault $n ($name):"; cat "$out/fault-$n.undo.log"; exit 2; fi
  # B must be whole again before the next fault, or that fault's report could be this one's residue.
  if ! compare "$out/fault-$n.undone"; then echo "fault-drill: B was not restored after fault $n ($name); the drill's undo step is wrong, or the fault changed nothing:"; cat "$out/fault-$n.undone.log"; exit 2; fi
  printf '%2d. %-62s %s\n' "$n" "$name" "$caught"
done

echo "After each fault was undone, all four comparisons were identical again."
echo "Results kept in $out"
[ "$missed" -eq 0 ] || { echo "fault-drill: $missed fault(s) went unreported. The comparison cannot be trusted."; exit 1; }
echo "Every one of the ${#faults[@]} faults was reported."
