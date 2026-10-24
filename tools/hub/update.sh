#!/usr/bin/env bash
# Updates the Hub: pulls the latest code, rebuilds the image with its version recorded, restarts
# it and checks it came back. Run it on the Docker LXC from anywhere:
#
#   bash /containers/UltimateTV/tools/hub/update.sh
#
# The TV picks up the new app the next time it loads (Settings › About › Reload the app, or wait).

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

before="$(git rev-parse --short HEAD)"
git pull --ff-only
GIT_COMMIT="$(git rev-parse --short HEAD)"
BUILD_DATE="$(git log -1 --format=%cI)"
export GIT_COMMIT BUILD_DATE
[ "$before" = "$GIT_COMMIT" ] && echo "Already on $GIT_COMMIT; rebuilding anyway." || echo "Updating $before -> $GIT_COMMIT"

docker compose up -d --build

port="$(sed -n 's/^HUB_PORT=//p' .env 2>/dev/null)"
port="${port:-8080}"
for _ in $(seq 1 30); do
  if health="$(curl -fsS "http://127.0.0.1:$port/api/health" 2>/dev/null)"; then
    echo "Hub is up: $health"
    exit 0
  fi
  sleep 2
done
echo "The Hub didn't answer on port $port. Check: docker logs ultimatetv-hub" >&2
exit 1
