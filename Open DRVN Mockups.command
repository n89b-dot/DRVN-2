#!/bin/zsh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${DRVN_PORT:-3002}"
BASE_URL="http://localhost:${PORT}"

ROUTES=(
  "/"
  "/home-alt"
  "/home-brutalist"
  "/home-anthropic"
  "/mockup"
  "/design-system"
)

open_mockups() {
  for route in "${ROUTES[@]}"; do
    open "${BASE_URL}${route}"
  done
}

server_is_ready() {
  curl -fsS -I --max-time 2 "${BASE_URL}" >/dev/null 2>&1
}

cd "${PROJECT_DIR}"

echo "DRVN mockup launcher"
echo "Project: ${PROJECT_DIR}"
echo "Local URL: ${BASE_URL}"
echo

if server_is_ready; then
  echo "Server is already running. Opening mockups..."
  open_mockups
  exit 0
fi

echo "Server is not running. Starting it now..."
npm run dev:mockups &
SERVER_PID=$!

echo "Waiting for ${BASE_URL}..."
for _ in {1..60}; do
  if server_is_ready; then
    echo "Server is ready. Opening mockups..."
    open_mockups
    echo
    echo "Keep this terminal window open while viewing the mockups."
    wait "${SERVER_PID}"
    exit 0
  fi
  sleep 1
done

echo "Timed out waiting for the mockup server."
echo "Check the output above for errors."
wait "${SERVER_PID}"
