#!/bin/zsh
# Background jobs for the local dev server, intended to be owned by launchd
# (~/Library/LaunchAgents/cc.drvn2.jobs.plist, StartInterval 120) beside the
# dev server's own agent (cc.drvn2.dev).
#
# Why: in a hosted environment pg_cron calls the /api/jobs/* routes through
# pg_net (job_config). The shared dev database cannot reach localhost, so on
# dev those calls go nowhere: holds never expire, sellers are never paid out,
# saved-search alerts never send, deletions and exports never finish. This
# script calls the same routes on the same schedule the database uses.
#
# Each job runs when its interval has passed since its last run (state in
# $STATE_DIR), so a missed tick catches up once rather than piling up.
# Run it by hand for one pass: ./scripts/dev-jobs.sh
#
# Install (once; launchd can't open scripts inside ~/Desktop, so it runs a
# copy from ~/bin with PROJECT_DIR set by the plist):
#   cp scripts/dev-jobs.sh ~/bin/drvn2-jobs.sh
#   cp scripts/launchd/cc.drvn2.jobs.plist ~/Library/LaunchAgents/
#   launchctl bootstrap gui/$UID ~/Library/LaunchAgents/cc.drvn2.jobs.plist
# Logs: ~/Library/Logs/drvn2-jobs.log

set -u
PORT="${PORT:-3005}"
PROJECT_DIR="${PROJECT_DIR:-${0:A:h:h}}"
STATE_DIR="${STATE_DIR:-$HOME/Library/Application Support/drvn2-jobs}"
cd "$PROJECT_DIR" || exit 1
mkdir -p "$STATE_DIR"

# Read through node: under launchd, macOS lets the node binary (which the dev
# server already runs as) read files in ~/Desktop, but not zsh or grep.
export PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
secret="$(node -e 'const l=require("fs").readFileSync(".env.local","utf8").split("\n").find(x=>x.startsWith("CRON_SECRET="));process.stdout.write(l?l.slice(12).trim().replace(/^"|"$/g,""):"")' 2>/dev/null)"
if [[ -z "$secret" ]]; then
  echo "$(date '+%F %T') CRON_SECRET missing from .env.local — nothing run"
  exit 0
fi

# route  interval-seconds  (matches cron.job on the shared project; listing
# imports has no database schedule, so it runs daily here as its route asks)
jobs=(
  "search 120"
  "account-deletions 300"
  "transfers 600"
  "saved-searches 1800"
  "media-gc 86400"
  "listing-imports 86400"
)

now=$(date +%s)
for entry in "${jobs[@]}"; do
  route="${entry%% *}"
  interval="${entry##* }"
  stamp="$STATE_DIR/$route"
  last=$(cat "$stamp" 2>/dev/null || echo 0)
  (( now - last < interval )) && continue
  code=$(curl -s -o /dev/null -m 280 -w '%{http_code}' -X POST \
    -H "Authorization: Bearer $secret" "http://localhost:$PORT/api/jobs/$route")
  echo "$(date '+%F %T') $route → HTTP $code"
  # Only a response from the app counts as a run; a dead server retries next tick.
  [[ "$code" != "000" ]] && echo "$now" > "$stamp"
done
exit 0
