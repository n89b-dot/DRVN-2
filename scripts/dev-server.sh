#!/bin/zsh
# Long-running dev server for DRVN 2, intended to be owned by launchd
# (~/Library/LaunchAgents/cc.drvn2.dev.plist) so localhost:3005 is always up.
#
# Run it by hand for the same behaviour without the agent:
#   ./scripts/dev-server.sh
#
# Why a wrapper rather than pointing launchd straight at npm: Next 16 keeps a
# lockfile under .next/dev and refuses to start if it thinks another dev server
# is alive. After a hard kill or a crash that lock can outlive the process, and
# launchd's KeepAlive would then restart into the same refusal forever. We clear
# a lock whose PID is gone before starting.

set -u
# A glob with no matches is normal here, not an error.
setopt NULL_GLOB

PORT="${PORT:-3005}"
PROJECT_DIR="${PROJECT_DIR:-${0:A:h:h}}"
cd "$PROJECT_DIR" || exit 1

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# Clear a stale Next dev lock (present, but its owning process is gone).
for lock in .next/dev/lock .next/dev/*.lock; do
  [[ -f "$lock" ]] || continue
  lock_pid="$(tr -dc '0-9' < "$lock" 2>/dev/null | head -c 10)"
  if [[ -z "$lock_pid" ]] || ! kill -0 "$lock_pid" 2>/dev/null; then
    echo "[dev-server] clearing stale lock $lock (pid ${lock_pid:-none})"
    rm -f "$lock"
  fi
done

# Anything else squatting on the port is almost always a dev server we lost
# track of. Leave it alone and let launchd retry rather than killing a process
# we can't identify.
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[dev-server] port $PORT already in use — not starting a second server"
  exit 0
fi

echo "[dev-server] starting Next dev on :$PORT in $PROJECT_DIR"
exec npm run dev -- -p "$PORT"
