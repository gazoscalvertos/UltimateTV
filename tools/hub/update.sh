#!/usr/bin/env bash
# Updates the Hub: pulls the latest code, rebuilds the image with its version recorded, restarts
# it and checks it came back. Run it on the Docker LXC from anywhere:
#
#   bash /containers/UltimateTV/tools/hub/update.sh
#
# The TV picks up the new app the next time it loads (Settings › About › Reload the app, or wait).
#
# Run as root (sudo), it also installs a small helper so the phone's Settings page can start this
# same update: the Hub leaves a request file in its data volume and a systemd path unit runs it.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

before="$(git rev-parse --short HEAD)"
git pull --ff-only
GIT_COMMIT="$(git rev-parse --short HEAD)"
BUILD_DATE="$(git log -1 --format=%cI)"
export GIT_COMMIT BUILD_DATE
[ "$before" = "$GIT_COMMIT" ] && echo "Already on $GIT_COMMIT; rebuilding anyway." || echo "Updating $before -> $GIT_COMMIT"

docker compose up -d --build

# The phone's "Update the Hub" button: a path unit watches for the Hub's request file and runs this
# script through a runner kept outside the repository (so a pull can't change it mid-run).
install_helper() {
  if [ "$(id -u)" != 0 ] || ! command -v systemctl > /dev/null; then
    echo "Tip: run this with sudo once so the phone's Settings page can update the Hub too."
    return 0
  fi
  local vol dir repo runner
  vol="$(docker inspect ultimatetv-hub -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' 2> /dev/null || true)"
  if [ -z "$vol" ] || [ ! -d "$vol" ]; then
    echo "Couldn't find the Hub's data folder, so the phone can't update the Hub yet." >&2
    return 0
  fi
  dir="$vol/update"
  repo="$(pwd)"
  runner=/usr/local/lib/ultimatetv/hub-update-runner.sh
  mkdir -p "$dir" /usr/local/lib/ultimatetv
  cat > "$runner.new" << EOF
#!/usr/bin/env bash
# Written by tools/hub/update.sh: runs an update the Hub asked for.
D='$dir'
rm -f "\$D/request"
touch "\$D/running"
if bash '$repo/tools/hub/update.sh' > "\$D/last.log" 2>&1; then r=ok; else r=failed; fi
echo "\$r \$(date -Iseconds)" > "\$D/result"
rm -f "\$D/running"
EOF
  chmod 755 "$runner.new"
  mv -f "$runner.new" "$runner"
  cat > /etc/systemd/system/ultimatetv-hub-update.service << EOF
[Unit]
Description=Update the UltimateTV Hub (asked for from the phone)

[Service]
Type=oneshot
ExecStart=$runner
TimeoutStartSec=30min
EOF
  cat > /etc/systemd/system/ultimatetv-hub-update.path << EOF
[Unit]
Description=Watch for the UltimateTV Hub asking to be updated

[Path]
PathExists=$dir/request
Unit=ultimatetv-hub-update.service

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now ultimatetv-hub-update.path
  date -Iseconds > "$dir/helper"
}
install_helper

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
