#!/usr/bin/env bash
# Plan 2 item A6: is database B (built from the baseline alone) the database A
# (built from the migration files)? Four comparisons, each of which must come
# back empty; docs/plans/2026-11-a6-baseline-analysis.md section 5 says why
# these four. It reads databases and changes none.
#
#   bash scripts/baseline/compare.sh capture <database url> <dir>
#       Writes what the comparisons need from one database into <dir>.
#   bash scripts/baseline/compare.sh compare <dir of A> <dir of B>
#       Compares two captures. Exit 0 only when all four are empty.
#   bash scripts/baseline/compare.sh both <url of A> <url of B> [out dir]
#       Captures both, then compares.
#
# Two captures can come from two databases that are never up together (two
# local stacks in one CI job), or from different machines (a hosted database
# read with a read-only login, against a stack build's capture).
#
# What is not a difference, and nothing else is excused:
#   - public.product_grow_runs holds 1 row in A and 0 in B: a log line the
#     migrations write by running the product grower once.
#   - public.worker_runs is not counted: scheduled jobs write to it while a
#     database is up (23 minutes past each hour), so its count is the time of
#     day, not the build.
set -uo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
ACCEPTED_ROW_DIFFERENCE="public.product_grow_runs|1|0"
UNCOUNTED_TABLE="public.worker_runs"

say() { printf '%s\n' "$*"; }

capture() {
  local url="$1" dir="$2"
  mkdir -p "$dir"
  # 1. Schema, permissions, jobs, storage and reference rows, as the snapshot folder.
  node "$root/scripts/baseline/render-snapshot.mjs" "$url" "$dir/snapshot" >"$dir/snapshot.log" 2>&1 || { say "capture: the snapshot failed:"; cat "$dir/snapshot.log"; return 2; }
  # 2. Everything outside public and private.
  psql "$url" -X -At -q -v ON_ERROR_STOP=1 -f "$root/scripts/baseline/outside-catalog.sql" >"$dir/outside.txt" 2>"$dir/outside.err" || { say "capture: the outside-catalog query failed:"; cat "$dir/outside.err"; return 2; }
  # 3. Row counts of every table of ours.
  local list="select string_agg(format('select %L as t, count(*) as n from %I.%I', n.nspname || '.' || c.relname, n.nspname, c.relname), ' union all ' order by n.nspname, c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'private') and c.relkind = 'r' and n.nspname || '.' || c.relname <> '$UNCOUNTED_TABLE'"
  psql "$url" -X -At -q -v ON_ERROR_STOP=1 -c "$(psql "$url" -X -At -q -v ON_ERROR_STOP=1 -c "$list") order by 1" >"$dir/rows.txt" 2>"$dir/rows.err" || { say "capture: the row counts failed:"; cat "$dir/rows.err"; return 2; }
  #    …and what the reference tables' rows say, read without the snapshot's code.
  psql "$url" -X -At -q -v ON_ERROR_STOP=1 -c "$(node "$root/scripts/baseline/render-snapshot.mjs" --row-hash-sql)" >>"$dir/rows.txt" 2>"$dir/rows.err" || { say "capture: the reference rows could not be read:"; cat "$dir/rows.err"; return 2; }
  LC_ALL=C sort -o "$dir/rows.txt" "$dir/rows.txt"
  # 4. A second opinion from a tool that shares no code with the snapshot:
  #    pg_dump with privileges, as a sorted list of lines. Sorted, because the
  #    order in which roles were granted is history, not state.
  pg_dump --schema-only --no-owner -n public -n private "$url" 2>"$dir/dump.err" | grep -v -E '^\\(un)?restrict|^-- Dumped (from|by) ' | LC_ALL=C sort >"$dir/dump.sorted"
  [ -s "$dir/dump.sorted" ] || { say "capture: pg_dump failed:"; cat "$dir/dump.err"; return 2; }
  say "Captured $(find "$dir/snapshot" -type f | wc -l | tr -d ' ') snapshot files, $(wc -l <"$dir/outside.txt" | tr -d ' ') outside rows, $(wc -l <"$dir/rows.txt" | tr -d ' ') tables, $(wc -l <"$dir/dump.sorted" | tr -d ' ') dump lines into $dir"
}

compare() {
  local a="$1" b="$2" failed=0
  for dir in "$a" "$b"; do
    for part in snapshot outside.txt rows.txt dump.sorted; do
      [ -e "$dir/$part" ] && { [ -d "$dir/$part" ] || [ -s "$dir/$part" ]; } || { say "compare: $dir has no $part; that is not a capture of a database."; return 2; }
    done
  done
  verdict() { # name, diff file
    if [ -s "$2" ]; then say "DIFFERENT  $1  ($(grep -c '^[<>]' "$2") lines; see $2)"; head -20 "$2"; failed=1; else say "identical  $1"; fi
  }
  diff -r "$a/snapshot" "$b/snapshot" >"$b/1-snapshot.diff" 2>&1
  verdict "1. snapshot ($(find "$a/snapshot" -type f | wc -l | tr -d ' ') files: functions, tables, permissions, policies, triggers, jobs, buckets, reference rows)" "$b/1-snapshot.diff"
  diff "$a/outside.txt" "$b/outside.txt" >"$b/2-outside.diff" 2>&1
  verdict "2. everything outside our two schemas ($(wc -l <"$a/outside.txt" | tr -d ' ') catalog rows)" "$b/2-outside.diff"
  { LC_ALL=C join -t '|' "$a/rows.txt" "$b/rows.txt" | awk -F'|' '$2 != $3' | grep -v -x -F "$ACCEPTED_ROW_DIFFERENCE"; diff <(cut -d'|' -f1 "$a/rows.txt") <(cut -d'|' -f1 "$b/rows.txt"); } >"$b/3-rows.diff" 2>&1
  # Lines from `join` carry no < or >; count any line as a difference.
  if [ -s "$b/3-rows.diff" ]; then say "DIFFERENT  3. rows in every table, and the content of the reference tables  ($(wc -l <"$b/3-rows.diff" | tr -d ' ') lines; see $b/3-rows.diff)"; head -20 "$b/3-rows.diff"; failed=1
  else say "identical  3. rows in every table, and the content of the reference tables ($(wc -l <"$a/rows.txt" | tr -d ' ') lines; accepted: $ACCEPTED_ROW_DIFFERENCE; not counted: $UNCOUNTED_TABLE)"; fi
  diff "$a/dump.sorted" "$b/dump.sorted" >"$b/4-pg_dump.diff" 2>&1
  verdict "4. pg_dump with privileges ($(wc -l <"$a/dump.sorted" | tr -d ' ') lines)" "$b/4-pg_dump.diff"
  return "$failed"
}

case "${1:-}" in
  capture) [ $# -eq 3 ] || { say "usage: compare.sh capture <database url> <dir>"; exit 2; }; capture "$2" "$3" ;;
  compare) [ $# -eq 3 ] || { say "usage: compare.sh compare <dir of A> <dir of B>"; exit 2; }; compare "$2" "$3" ;;
  both)
    [ $# -ge 3 ] || { say "usage: compare.sh both <url of A> <url of B> [out dir]"; exit 2; }
    out="${4:-$(mktemp -d)}"
    capture "$2" "$out/A" >/dev/null || { capture "$2" "$out/A"; exit 2; }
    capture "$3" "$out/B" >/dev/null || { capture "$3" "$out/B"; exit 2; }
    compare "$out/A" "$out/B"; status=$?
    say "Results kept in $out"
    exit "$status" ;;
  *) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
