#!/usr/bin/env bash
# Puts Share Play links on the internet through a Cloudflare Tunnel that publishes ONLY /share/ on
# the Hub (docs/share-play.md). Run it once on the Docker LXC, in the UltimateTV folder:
#
#   bash tools/share/setup-tunnel.sh watch.example.com
#
# You need a free Cloudflare account with a domain on it. The script:
#   1. opens a Cloudflare sign-in (it prints a link: open it on any computer and pick the domain),
#   2. creates a tunnel called ultimatetv-share and points watch.example.com at it,
#   3. writes share-tunnel/config.yml so only paths starting /share/ reach the Hub,
#   4. sets SHARE_URL and adds "share" to COMPOSE_PROFILES in .env, and starts the tunnel.
#
#   bash tools/share/setup-tunnel.sh --off     # stops the tunnel and takes it out of .env
set -euo pipefail

cd "$(dirname "$0")/../.."
DIR="${SHARE_TUNNEL_DIR:-$PWD/share-tunnel}"
IMAGE="cloudflare/cloudflared:latest"
NAME="ultimatetv-share"

set_env() { # set_env KEY VALUE: replaces or adds a line in .env
  touch .env
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}
profiles() { grep -E '^COMPOSE_PROFILES=' .env 2>/dev/null | cut -d= -f2- || true; }

if [[ "${1:-}" == "--off" ]]; then
  docker compose --profile share stop share-tunnel 2>/dev/null || true
  docker compose --profile share rm -f share-tunnel 2>/dev/null || true
  left=$(profiles | tr ',' '\n' | grep -v '^share$' | grep -v '^$' | paste -sd, - || true)
  set_env COMPOSE_PROFILES "$left"
  set_env SHARE_URL ""
  docker compose up -d hub
  echo "Share Play is home-only again. The tunnel still exists in Cloudflare; delete it there (Zero Trust › Networks › Tunnels) if you won't use it again."
  exit 0
fi

HOST="${1:-}"
if [[ ! "$HOST" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo "Usage: bash tools/share/setup-tunnel.sh watch.yourdomain.com" >&2
  exit 1
fi

mkdir -p "$DIR"
# The cloudflared image runs as user 65532; it needs to write its sign-in and tunnel key here.
chown 65532:65532 "$DIR" 2>/dev/null || sudo chown 65532:65532 "$DIR"
chmod 700 "$DIR" 2>/dev/null || sudo chmod 700 "$DIR"
cf() { docker run --rm -it -v "$DIR:/home/nonroot/.cloudflared" "$IMAGE" "$@"; }

if [[ ! -f "$DIR/cert.pem" ]]; then
  echo "Open the link cloudflared prints, sign in to Cloudflare and pick the domain for $HOST."
  cf tunnel login
fi

if ! ls "$DIR"/*.json >/dev/null 2>&1; then
  cf tunnel create "$NAME"
fi
ID=$(basename "$(ls "$DIR"/*.json | head -n1)" .json)
cf tunnel route dns --overwrite-dns "$ID" "$HOST"

# Only /share/ reaches the Hub; anything else (the API, the TV app, the setup page) is a 404 here,
# before it gets anywhere near the house.
cat > "$DIR/config.yml.new" <<YAML
tunnel: $ID
credentials-file: /etc/cloudflared/$ID.json
no-autoupdate: true
ingress:
  - hostname: $HOST
    path: ^/share/
    service: http://hub:8080
  - service: http_status:404
YAML
mv "$DIR/config.yml.new" "$DIR/config.yml" 2>/dev/null || sudo mv "$DIR/config.yml.new" "$DIR/config.yml"

set_env SHARE_URL "https://$HOST"
current=$(profiles)
if ! tr ',' '\n' <<<"$current" | grep -qx share; then set_env COMPOSE_PROFILES "${current:+$current,}share"; fi
docker compose up -d hub share-tunnel

echo
echo "Checking from the internet side (give DNS a minute if this fails)…"
sleep 5
if curl -fsS -o /dev/null "https://$HOST/share/hls.js"; then echo "  https://$HOST/share/ answers: good"; else echo "  https://$HOST/share/ didn't answer yet: try again in a minute"; fi
code=$(curl -s -o /dev/null -w '%{http_code}' "https://$HOST/api/health" || true)
if [[ "$code" == "404" ]]; then echo "  https://$HOST/api/health is a 404: good, nothing else of the Hub is published"; else echo "  WARNING: https://$HOST/api/health answered $code. Only /share/ should be published: check $DIR/config.yml."; fi
echo
echo "New Share Play links now use https://$HOST. Turn it off again with: bash tools/share/setup-tunnel.sh --off"
