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
