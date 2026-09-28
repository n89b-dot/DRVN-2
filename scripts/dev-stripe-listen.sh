#!/bin/zsh
# Forwards Stripe TEST events to the local dev server, owned by launchd
# (~/Library/LaunchAgents/cc.drvn2.stripe.plist, KeepAlive) beside the dev
# server's agent.
#
# Why: Stripe can't reach localhost, so payment_intent.succeeded, refunds,
# disputes and Connect account updates never arrived on dev — a test purchase
# stayed "pending" until the money worker's 10-minute capture check. The
# CLI's listen secret for this account is the STRIPE_WEBHOOK_SECRET already
# in .env.local, so no app config changes.
#
# Install (once; launchd can't open scripts inside ~/Desktop, so it runs a
# copy from ~/bin with PROJECT_DIR set by the plist):
#   cp scripts/dev-stripe-listen.sh ~/bin/drvn2-stripe-listen.sh
#   cp scripts/launchd/cc.drvn2.stripe.plist ~/Library/LaunchAgents/
#   launchctl bootstrap gui/$UID ~/Library/LaunchAgents/cc.drvn2.stripe.plist
# Logs: ~/Library/Logs/drvn2-stripe.log

set -u
PORT="${PORT:-3005}"
PROJECT_DIR="${PROJECT_DIR:-${0:A:h:h}}"
cd "$PROJECT_DIR" || exit 1
export PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

# Read through node: under launchd, macOS lets node read ~/Desktop, not zsh.
key="$(node -e 'const l=require("fs").readFileSync(".env.local","utf8").split("\n").find(x=>x.startsWith("STRIPE_SECRET_KEY="));process.stdout.write(l?l.slice(18).trim().replace(/^"|"$/g,""):"")' 2>/dev/null)"
case "$key" in
  sk_test_*) ;;
  *) echo "$(date '+%F %T') no Stripe TEST key in .env.local — not forwarding"; sleep 300; exit 0 ;;
esac

exec stripe listen --api-key "$key" --forward-to "localhost:$PORT/api/stripe/webhook"
