#!/usr/bin/env bash
# Takes the Hub on a trip with the TV box, and brings it home again. Run it on the box:
#
#   sudo bash /opt/ultimatetv/tools/hub/travel.sh away     at home, before you pack the box
#   sudo bash /opt/ultimatetv/tools/hub/travel.sh home     back home, with the box on the home network
#   sudo bash /opt/ultimatetv/tools/hub/travel.sh status   where the Hub is now
#   sudo bash /opt/ultimatetv/tools/hub/travel.sh cancel   call the trip off: the home Hub carries on
#                                                          with the data it had, the box's is dropped
#
# "away" builds a Hub on the box (Docker), takes the home Hub's data (profiles, PINs, settings,
# channels, pairing, scare clips) and points the TV app at the box's own Hub. The home Hub stands
# by meanwhile: no recordings or guide refreshes, so the two never use the IPTV connection at once.
# "home" sends the box's data (what you watched, settings you changed) back and points the TV app
# at the home Hub again. See docs/travel.md.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BOX_ENV=/etc/ultimatetv/box.env
STATE=/etc/ultimatetv/travel.env
WORK=/var/lib/ultimatetv/travel
LOCAL_PORT="${LOCAL_PORT:-8095}"
LOCAL_HUB="http://127.0.0.1:$LOCAL_PORT"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run this with sudo"
[ -f "$BOX_ENV" ] || die "$BOX_ENV is missing: is this the TV box?"

box_hub() { sed -n 's/^HUB_URL=//p' "$BOX_ENV" | tail -1; }
set_box_hub() {
  sed -i "s|^HUB_URL=.*|HUB_URL=$1|" "$BOX_ENV"
  say "The TV app now uses the Hub at $1; restarting it"
  systemctl restart sddm || warn "couldn't restart the TV session: reboot the box"
}
load_state() {
  [ -f "$STATE" ] || die "the Hub isn't away (no $STATE)"
  # shellcheck disable=SC1090
  . "$STATE"
}
compose() { (cd "$APP_DIR" && docker compose "$@"); }
health() { curl -fsS --max-time 5 "$1/api/health" 2> /dev/null; }
wait_health() {
  local url="$1" want="${2:-}" h
  for _ in $(seq 1 90); do
    if h="$(health "$url")" && { [ -z "$want" ] || grep -q "$want" <<< "$h"; }; then return 0; fi
    sleep 2
  done
  return 1
}

# Docker and the Hub's image on the box. Built before anything moves, so the home Hub stays in use
# while this (slow) part runs.
build_local_hub() {
  if ! command -v docker > /dev/null || ! docker compose version > /dev/null 2>&1 || ! docker buildx version > /dev/null 2>&1; then
    say "Installing Docker"
    if command -v pacman > /dev/null; then pacman -S --needed --noconfirm docker docker-compose docker-buildx
    else DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose docker-buildx; fi
  fi
  systemctl enable --now docker > /dev/null
  local gid
  gid="$(getent group render | cut -d: -f3)"
  # The NAS shares, when the box mounts them (docs/travel.md); empty folders otherwise.
  mkdir -p /mnt/nas /mnt/nas2
  if [ ! -f "$APP_DIR/.env" ] || ! grep -q '^COMPOSE_FILE=' "$APP_DIR/.env"; then
    cat >> "$APP_DIR/.env" << EOF
# The Hub on the TV box (tools/hub/travel.sh).
COMPOSE_FILE=docker-compose.yml:docker-compose.box.yml
HUB_PORT=$LOCAL_PORT
RENDER_GID=${gid:-989}
TZ=$(timedatectl show -p Timezone --value 2> /dev/null || echo Europe/London)
EOF
  fi
  say "Building the Hub on the box (the first time takes a few minutes)"
  GIT_COMMIT="$(git -C "$APP_DIR" rev-parse --short HEAD 2> /dev/null || true)" \
    BUILD_DATE="$(git -C "$APP_DIR" log -1 --format=%cI 2> /dev/null || true)" \
    compose build hub
}

away() {
  [ ! -f "$STATE" ] || die "the Hub is already away (since $(sed -n 's/^AWAY_SINCE=//p' "$STATE")). Run: $0 home"
  local home_hub
  home_hub="$(box_hub)"
  case "$home_hub" in *127.0.0.1* | *localhost*) die "the TV app already uses a Hub on this box ($home_hub)" ;; esac
  health "$home_hub" > /dev/null || die "can't reach the home Hub at $home_hub"

  build_local_hub

  say "On the TV, open Settings › Phones and remotes and type the 8-letter code it shows."
  local code token pair
  read -rp "Code: " code
  pair="$(curl -fsS --max-time 10 -H 'Content-Type: application/json' -d "{\"code\":\"$code\",\"name\":\"Travel ($(hostname))\"}" "$home_hub/api/pair" 2>&1)" \
    || die "the home Hub didn't take that code: $pair"
  token="$(node -p 'JSON.parse(process.argv[1]).token' "$pair")"

  install -d -m 700 "$WORK"
  local archive headers key
  archive="$WORK/from-home-$(date +%Y%m%d-%H%M).tar.gz"
  headers="$WORK/headers"
  say "Taking the home Hub's data"
  curl -fsS --max-time 1800 -H "X-Device-Token: $token" -D "$headers" -o "$archive" "$home_hub/api/hub/move-out" \
    || die "the home Hub didn't hand over its data (see above); nothing has moved"
  key="$(sed -n 's/^[Xx]-[Mm]ove-[Kk]ey: *\([^[:space:]]*\).*/\1/p' "$headers")"
  rm -f "$headers"
  [ -n "$key" ] || die "the home Hub didn't send its move key"
  # Written straight away: without the key the home Hub can't be brought back.
  install -m 600 /dev/null "$STATE"
  cat > "$STATE" << EOF
# The Hub is away on the TV box (tools/hub/travel.sh). Keep this file: it brings the home Hub back.
HOME_HUB=$home_hub
MOVE_KEY=$key
TOKEN=$token
AWAY_SINCE=$(date -Iseconds)
EOF
  say "Home Hub data saved ($(du -h "$archive" | cut -f1)); starting the Hub on the box with it"

  compose create hub
  docker cp "$archive" ultimatetv-hub:/data/restore.tar.gz
  compose up -d hub
  wait_health "$LOCAL_HUB" || die "the box's Hub didn't start: docker logs ultimatetv-hub. The home Hub is standing by; '$0 cancel' brings it back as it was."
  set_box_hub "$LOCAL_HUB"
  local ip
  ip="$(ip -4 route get 1.1.1.1 2> /dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')"
  say "Done. The Hub now runs on this box. Phones reach it at http://${ip:-<box address>}:$LOCAL_PORT"
  say "When you're home again: sudo bash $APP_DIR/tools/hub/travel.sh home"
}

home() {
  load_state
  local moved
  moved="$(curl -fsS --max-time 5 "$HOME_HUB/api/hub/move" 2> /dev/null)" || die "can't reach the home Hub at $HOME_HUB: is the box on the home network?"
  grep -q '"movedAway":true' <<< "$moved" || die "the home Hub at $HOME_HUB isn't waiting for its data ($moved)"

  say "Stopping the box's Hub and packing its data"
  compose stop hub
  local vol archive items=()
  vol="$(docker inspect ultimatetv-hub -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}')"
  [ -f "$vol/hub.db" ] || die "can't find the box Hub's data (in $vol)"
  for f in hub.db hub.db-wal hub.db-shm scare-clips notify-media probe-reports; do
    [ -e "$vol/$f" ] && items+=("$f")
  done
  install -d -m 700 "$WORK"
  archive="$WORK/to-home-$(date +%Y%m%d-%H%M).tar.gz"
  tar -czf "$archive" -C "$vol" "${items[@]}"

  say "Sending it to the home Hub ($(du -h "$archive" | cut -f1))"
  curl -fsS --max-time 1800 -H "X-Move-Key: $MOVE_KEY" -H "X-Device-Token: $TOKEN" -H 'Content-Type: application/gzip' --data-binary "@$archive" "$HOME_HUB/api/hub/move-in" > /dev/null \
    || { compose start hub > /dev/null; die "the home Hub didn't take the data; the box's Hub is running again"; }
  sleep 3
  wait_health "$HOME_HUB" || warn "the home Hub hasn't come back yet: check it with 'docker logs ultimatetv-hub' on the Docker LXC"
  if health "$HOME_HUB" | grep -q '"movedAway":true'; then warn "the home Hub still says it moved away"; fi
  mv "$STATE" "$WORK/travel-$(date +%Y%m%d-%H%M).env.done"
  chmod 600 "$WORK"/*.done
  set_box_hub "$HOME_HUB"
  say "Done. The Hub is home. The box's own Hub is stopped (its data stays in Docker until the next trip)."
}

cancel() {
  load_state
  say "Calling the trip off: the home Hub carries on with the data it had. Anything changed on the box's Hub is dropped."
  read -rp "Go ahead? [y/N] " ok
  [ "$ok" = y ] || [ "$ok" = Y ] || exit 1
  curl -fsS --max-time 10 -X DELETE -H "X-Move-Key: $MOVE_KEY" "$HOME_HUB/api/hub/move" > /dev/null || die "can't reach the home Hub at $HOME_HUB"
  compose stop hub 2> /dev/null || true
  mv "$STATE" "$WORK/travel-$(date +%Y%m%d-%H%M).env.cancelled"
  wait_health "$HOME_HUB" || warn "the home Hub hasn't come back yet"
  set_box_hub "$HOME_HUB"
}

status() {
  if [ -f "$STATE" ]; then
    # shellcheck disable=SC1090
    . "$STATE"
    echo "The Hub is away on this box since $AWAY_SINCE (home Hub: $HOME_HUB)."
    health "$LOCAL_HUB" > /dev/null && echo "The box's Hub is running." || echo "The box's Hub isn't answering: docker logs ultimatetv-hub"
  else
    echo "The Hub is at home: $(box_hub)"
  fi
}

case "${1:-}" in
  away) away ;;
  home) home ;;
  cancel) cancel ;;
  status) status ;;
  *) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
