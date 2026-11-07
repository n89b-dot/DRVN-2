#!/usr/bin/env bash
# Start the pinned local Supabase stack for a CI job, with a time limit on
# every attempt.
#
# Why: `supabase start` pulls a dozen images and waits on their health checks.
# On a shared runner a pull or a health wait can stall indefinitely (ECR rate
# limits, a wedged container). The retry loop used to let one stalled attempt
# run until the job's own timeout-minutes killed it — on 2026-10-18 the
# stripe-integration job sat in this step for 40 minutes and was cancelled
# (PR #23, run 39091052694), failing release-gate for a merge that was
# otherwise green. Bounding each attempt turns that stall into a retry.
#
# Usage: scripts/ci-supabase-start.sh <comma-separated services to exclude>
# Env:   SUPABASE_START_TIMEOUT   seconds allowed per attempt (default 480)
#        SUPABASE_START_ATTEMPTS  number of attempts (default 3)
#        SUPABASE_START_BACKOFF   seconds × attempt number to wait before a
#                                 retry (default 10)
#        SUPABASE_START_GRACE     seconds between TERM and KILL when an
#                                 attempt expires (default 30)
#        SUPABASE_START_DIAG_TIMEOUT  seconds allowed for the `docker ps`
#                                 diagnostics after a failed attempt (default 30)
#
# A retry must never hide the failure it recovers from: every failed attempt
# is a ::warning:: annotation (exit code, or the timeout), and a start that
# only succeeded on a later attempt says so in an annotation and in the job
# summary. tests/ci/ci-supabase-start.test.ts drives this script with stub
# `npx`/`docker` binaries.
#
# The bound is plain bash (no GNU `timeout`), so the script behaves the same
# on the Ubuntu runner and on a macOS checkout.
set -u

exclude="${1:?usage: ci-supabase-start.sh <services-to-exclude>}"
cli="supabase@2.116.0"
limit="${SUPABASE_START_TIMEOUT:-480}"
attempts="${SUPABASE_START_ATTEMPTS:-3}"
backoff="${SUPABASE_START_BACKOFF:-10}"
grace="${SUPABASE_START_GRACE:-30}"
diag_limit="${SUPABASE_START_DIAG_TIMEOUT:-30}"
failures=""

# True while any process is left in process group $1.
group_alive() {
  kill -0 -- "-$1" 2>/dev/null
}

# Stop every process left in group $1: TERM, up to $grace seconds for them to
# go, then KILL, then confirm. The group leader exiting proves nothing — npx
# can exit on TERM while the CLI or a docker call it spawned ignores TERM and
# keeps running into the cleanup and the next attempt.
reap_group() {
  local pgid=$1 waited=0
  group_alive "$pgid" || return 0
  kill -TERM -- "-$pgid" 2>/dev/null
  while group_alive "$pgid" && [ "$waited" -lt "$grace" ]; do
    sleep 1
    waited=$((waited + 1))
  done
  if group_alive "$pgid"; then
    kill -KILL -- "-$pgid" 2>/dev/null
    waited=0
    while group_alive "$pgid" && [ "$waited" -lt 10 ]; do
      sleep 1
      waited=$((waited + 1))
    done
  fi
  if group_alive "$pgid"; then
    echo "::warning::process group $pgid survived KILL"
    return 1
  fi
  return 0
}

# Run a command in its own process group with a limit of $1 seconds and kill
# the whole group when the limit passes (npx spawns the CLI as a child;
# signalling only npx would leave the CLI and its docker calls running).
# Returns 124 on expiry, only after every process in the group is gone.
run_bounded() {
  local seconds=$1
  shift
  local marker
  marker=$(mktemp)
  rm -f "$marker"
  set -m
  "$@" &
  local pid=$!
  # The watchdog TERMs the group at the limit, and KILLs it after the grace
  # period in case the leader itself ignores TERM (so `wait` below returns).
  (
    sleep "$seconds"
    touch "$marker"
    kill -TERM -- "-$pid" 2>/dev/null
    sleep "$grace"
    kill -KILL -- "-$pid" 2>/dev/null
  ) >/dev/null 2>&1 &
  local watchdog=$!
  set +m
  local code
  wait "$pid"
  code=$?
  kill -KILL -- "-$watchdog" 2>/dev/null
  wait "$watchdog" 2>/dev/null
  if [ -e "$marker" ]; then
    rm -f "$marker"
    # The leader is gone, but a descendant that ignored TERM may not be:
    # finish the group-wide TERM-then-KILL before anyone retries.
    reap_group "$pid"
    return 124
  fi
  # A failed command must not leave stragglers behind either.
  if [ "$code" -ne 0 ]; then
    reap_group "$pid"
  fi
  return "$code"
}

for attempt in $(seq 1 "$attempts"); do
  echo "::group::supabase start — attempt $attempt of $attempts (limit ${limit}s)"
  started=$(date +%s)
  run_bounded "$limit" npx --yes "$cli" start -x "$exclude"
  code=$?
  echo "attempt $attempt finished in $(( $(date +%s) - started ))s with exit $code"
  echo "::endgroup::"
  if [ "$code" -eq 0 ]; then
    if [ -n "$failures" ]; then
      note="supabase start succeeded on attempt $attempt of $attempts after earlier failures:${failures}"
      echo "::warning::$note"
      if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
        printf '### Supabase start needed a retry\n\n%s\n' "$note" >> "$GITHUB_STEP_SUMMARY"
      fi
    fi
    exit 0
  fi

  if [ "$code" -eq 124 ]; then
    reason="exceeded ${limit}s and was killed"
  else
    reason="exited $code"
  fi
  failures="$failures attempt $attempt $reason;"
  echo "::warning::supabase start attempt $attempt of $attempts $reason"
  echo "::group::container state after failed attempt $attempt"
  # Bounded: a wedged Docker daemon must not hang the job here. The cleanup
  # and the retry still run if it times out.
  run_bounded "$diag_limit" docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
  diag=$?
  if [ "$diag" -eq 124 ]; then
    echo "::warning::docker ps did not answer within ${diag_limit}s; continuing to cleanup"
  fi
  echo "::endgroup::"

  # The cleanup is bounded too: a wedged stop must not eat the job either.
  run_bounded "$limit" npx --yes "$cli" stop --no-backup || true
  if [ "$attempt" -lt "$attempts" ]; then
    sleep $((attempt * backoff))
  fi
done

echo "::error::supabase start failed after $attempts attempts:${failures}"
exit 1
