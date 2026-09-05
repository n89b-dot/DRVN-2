#!/usr/bin/env bash
# Run against an explicitly configured disposable database only.
set -uo pipefail
failed=0
for file in supabase/tests/*_guard.sql; do
  printf '\nRunning %s\n' "$file"
  output=$(psql -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -U "${PGUSER:-supabase_admin}" -d "${PGDATABASE:-postgres}" -v ON_ERROR_STOP=1 -f "$file" 2>&1)
  result=$?
  printf '%s\n' "$output"
  if [ "$result" -ne 0 ] || ! grep -Eqi 'all .*checks (passed|green)' <<< "$output"; then
    failed=1
    printf 'FAILED: %s\n' "$file" >&2
  fi
done
exit "$failed"
