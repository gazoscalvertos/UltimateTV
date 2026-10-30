#!/usr/bin/env bash
# Puts one of the Hub's backups back (see docs/backup.md). Run it on the Docker LXC:
#
#   bash tools/hub/restore.sh                      lists the backups the Hub keeps
#   bash tools/hub/restore.sh latest               restores the newest one
#   bash tools/hub/restore.sh ultimatetv-hub-2026-10-30-0330.tar.gz
#   bash tools/hub/restore.sh /root/ultimatetv-hub-2026-10-30-0330.tar.gz   a copy from elsewhere
#
# The backup goes into the Hub's data as restore.tar.gz and the Hub restarts; it unpacks it before
# it opens its database and keeps what it replaced in data/before-restore-<time>. On a new server,
# start the Hub first (tools/hub/update.sh or docker compose up -d --build), then restore.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

hub=ultimatetv-hub
say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

docker inspect "$hub" > /dev/null 2>&1 || die "the Hub's container isn't here. Start it first: docker compose up -d --build"
[ "$(docker inspect -f '{{.State.Running}}' "$hub")" = true ] || docker start "$hub" > /dev/null

# Where the Hub keeps its backups, as the Hub sees it.
dir="$(docker exec "$hub" node -e '
  import("/app/hub/dist/backup.js").then(({ backupDir }) => console.log(backupDir(process.env.DATA_DIR ?? "/data", process.env.MEDIA_ROOT ?? "/mnt/nas").dir));
' 2> /dev/null || true)"
list() { [ -n "$dir" ] && docker exec "$hub" sh -c "ls -1 '$dir' 2>/dev/null" | grep -E '^ultimatetv-hub-[0-9-]+\.tar\.gz$' | sort -r || true; }

choice="${1:-}"
if [ -z "$choice" ]; then
  backups="$(list)"
  [ -n "$backups" ] || die "the Hub has no backups${dir:+ in $dir} yet"
  echo "Backups in $dir (newest first):"
  printf '%s\n' "$backups" | sed 's/^/  /'
  echo
  echo "Restore one with: bash $0 latest   (or give its name)"
  exit 0
fi

if [ -f "$choice" ]; then
  say "Copying $choice into the Hub"
  docker cp "$choice" "$hub:/data/restore.tar.gz.in"
else
  [ "$choice" = latest ] && choice="$(list | head -n 1)"
  [ -n "$choice" ] || die "the Hub has no backups${dir:+ in $dir} yet"
  case "$choice" in ultimatetv-hub-*.tar.gz) ;; *) die "that isn't a backup's name or a file here: $choice" ;; esac
  say "Restoring $choice from $dir"
  docker exec "$hub" cp "$dir/$choice" /data/restore.tar.gz.in || die "couldn't find $choice in $dir"
fi
docker exec "$hub" sh -c 'tar -tzf /data/restore.tar.gz.in | grep -qx "\(\./\)\?hub.db"' \
  || { docker exec "$hub" rm -f /data/restore.tar.gz.in; die "that isn't a Hub backup (there's no hub.db in it)"; }
docker exec "$hub" mv /data/restore.tar.gz.in /data/restore.tar.gz
say "Restarting the Hub with it"
docker restart "$hub" > /dev/null

port="$(sed -n 's/^HUB_PORT=//p' .env 2> /dev/null)"
port="${port:-8080}"
for _ in $(seq 1 30); do
  if health="$(curl -fsS "http://127.0.0.1:$port/api/health" 2> /dev/null)"; then
    say "The Hub is back: $health"
    echo "What it replaced is in the Hub's data as before-restore-<time>. Reload the TV app (Settings › About)."
    exit 0
  fi
  sleep 2
done
die "the Hub didn't answer on port $port. Check: docker logs $hub"
