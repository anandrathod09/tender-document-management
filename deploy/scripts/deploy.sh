#!/usr/bin/env bash
# Updates the live server to the latest code on main:
#   backup -> pull -> install -> build -> database migrations -> restart -> health check.
# Run as the tdm user from anywhere:  /opt/tender-manager/deploy/scripts/deploy.sh
# The restart needs sudo for systemctl (see deploy/README.md, step 9).
set -euo pipefail

APP_DIR=/opt/tender-manager
BRANCH=${BRANCH:-main}

cd "$APP_DIR"
echo "==> Backup before updating"
"$APP_DIR/deploy/scripts/backup.sh"

echo "==> Fetching $BRANCH"
git fetch --quiet origin "$BRANCH"
git checkout --quiet "$BRANCH"
git reset --quiet --hard "origin/$BRANCH"
git log --oneline -1

echo "==> Installing packages"
npm ci --no-audit --no-fund

echo "==> Building"
npm run build

echo "==> Database migrations"
(cd apps/api && node dist/db/migrate.js)

echo "==> Restarting the API"
sudo systemctl restart tender-manager-api

echo "==> Health check"
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:4000/api/health >/dev/null 2>&1; then
    echo "API is up."
    exit 0
  fi
  sleep 1
done
echo "The API did not come back. See: journalctl -u tender-manager-api -n 100" >&2
exit 1
