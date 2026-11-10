#!/usr/bin/env bash
# Run against an explicitly configured disposable database only.
set -uo pipefail
: "${PGHOST:?Set an explicit disposable loopback database host}"
: "${PGPORT:?Set an explicit disposable database port}"
case "$PGHOST:$PGPORT" in
  127.0.0.1:54322|localhost:54322|127.0.0.1:55440|localhost:55440|127.0.0.1:55441|localhost:55441|127.0.0.1:55442|localhost:55442) ;;
  127.0.0.1:5432|localhost:5432) [ "${CI:-}" = "true" ] || exit 1 ;;
  *) echo "SQL guards require the isolated local or CI database" >&2; exit 1 ;;
esac
failed=0
# Guards run in the stub payments world, as CI's browser suite does: a
# database with no job_config.payments_mode row enforces payout readiness
# (20261107210000), and the guards' fixture sellers never onboarded with
# Stripe. listing_write_boundary_guard.sql removes the row inside its own
# transaction to prove the enforced rule.
if ! psql -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -U "${PGUSER:-supabase_admin}" -d "${PGDATABASE:-postgres}" -v ON_ERROR_STOP=1 -q \
  -c "insert into public.job_config (key, value) values ('payments_mode', 'stub') on conflict (key) do update set value = excluded.value"; then
  echo "Could not record the stub payments mode for the guards" >&2
  exit 1
fi

# Guards run with strict notification kinds (work review #153): an insert of a
# kind private.notification_member_text does not classify is refused, so a
# guard that raises a new kind fails until someone says whose words it carries.
# A database setting, read by each guard's own session; production never sets it.
if ! psql -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -U "${PGUSER:-supabase_admin}" -d "${PGDATABASE:-postgres}" -v ON_ERROR_STOP=1 -q \
  -c "do \$\$ begin execute format('alter database %I set drvn.strict_notification_kinds = %L', current_database(), 'on'); end \$\$"; then
  echo "Could not switch on strict notification kinds for the guards" >&2
  exit 1
fi

# JUnit for the Intelligence OS (docs/ids.md): one <testcase> per guard file,
# named by its basename without .sql; a failure's body is the guard's FAIL
# lines verbatim (or the end of its output when it printed none). Writing it
# never changes which guards pass or the exit code.
junit="${SQL_GUARDS_JUNIT:-test-results/sql-guards.xml}"
cases=$(mktemp)
trap 'rm -f "$cases"' EXIT
total=0
failures=0
xml_escape() {
  # Drop control characters XML 1.0 can't hold (tab and newline stay), then escape.
  LC_ALL=C tr -d '\000-\010\013\014\016-\037' | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'
}

for file in supabase/tests/*_guard.sql; do
  printf '\nRunning %s\n' "$file"
  started=$(date +%s)
  output=$(psql -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -U "${PGUSER:-supabase_admin}" -d "${PGDATABASE:-postgres}" -v ON_ERROR_STOP=1 -f "$file" 2>&1)
  result=$?
  seconds=$(( $(date +%s) - started ))
  printf '%s\n' "$output"
  name=$(basename "$file" .sql)
  total=$((total + 1))
  if [ "$result" -ne 0 ] || ! grep -Eqi 'all .*checks (passed|green)' <<< "$output"; then
    failed=1
    failures=$((failures + 1))
    printf 'FAILED: %s\n' "$file" >&2
    body=$(grep 'FAIL' <<< "$output" || true)
    [ -n "$body" ] || body=$(tail -n 20 <<< "$output")
    {
      printf '  <testcase classname="sql-guards" name="%s" file="%s" time="%s">\n' "$name" "$file" "$seconds"
      printf '    <failure message="%s">' "$(head -n 1 <<< "$body" | xml_escape)"
      printf '%s' "$body" | xml_escape
      printf '</failure>\n  </testcase>\n'
    } >> "$cases"
  else
    printf '  <testcase classname="sql-guards" name="%s" file="%s" time="%s"/>\n' "$name" "$file" "$seconds" >> "$cases"
  fi
done

mkdir -p "$(dirname "$junit")"
{
  printf '<?xml version="1.0" encoding="UTF-8"?>\n'
  printf '<testsuites name="sql-guards" tests="%s" failures="%s">\n' "$total" "$failures"
  printf '<testsuite name="sql-guards" tests="%s" failures="%s" errors="0" skipped="0">\n' "$total" "$failures"
  cat "$cases"
  printf '</testsuite>\n</testsuites>\n'
} > "$junit"
printf '\nJUnit: %s (%s guards, %s failed)\n' "$junit" "$total" "$failures"
exit "$failed"
