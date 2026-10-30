#!/usr/bin/env bash
# The box's update, installed as /usr/local/bin/ultimatetv-update by install.sh. It runs every
# Monday at 4 am (ultimatetv-update-auto.service, with --auto) and from Settings › About › Update
# the box or the phone (ultimatetv-update.service).
#
# Before changing anything it keeps a way back: a snapper snapshot of the root (when it's btrfs) and
# a copy of the kernel files in /boot (which the snapshot doesn't cover). Then OS packages, then the
# app. The TV session restarts, and ultimatetv-healthcheck decides whether the update stays: if the
# app doesn't start, can't reach the Hub, mpv can't play or the CEC adapter has gone, it rolls back
# (ultimatetv-rollback) and that commit isn't installed automatically again.
#
#   --auto   the weekly update: skips a commit that was rolled back before
#
# State lives in /var/lib/ultimatetv/update (see rollback.sh). For the tests, UTV_ETC, UTV_STATE,
# UTV_BOOT, UTV_DEV, UTV_LOCK and UTV_BIN move the paths it uses.

set -euo pipefail

etc="${UTV_ETC:-/etc/ultimatetv}"
state="${UTV_STATE:-/var/lib/ultimatetv/update}"
boot="${UTV_BOOT:-/boot}"
dev="${UTV_DEV:-/dev}"
bin="${UTV_BIN:-/usr/local/bin}"

log() {
  local line
  line="$(date -u +%FT%TZ) update: $*"
  echo "$line"
  echo "$line" >>"$state/update.log"
}

# key=value, for last.env (the update that can be undone) and its health check.
write_last() {
  local tmp="$state/last.env.tmp"
  {
    echo "status=$1"
    echo "snapshot=$snapshot"
    echo "from=$from"
    echo "to=${to:-}"
    echo "at=$started"
    echo "done=${done_at:-}"
    echo "auto=$auto"
    echo "cec=$cec"
  } >"$tmp"
  chmod 644 "$tmp"
  mv "$tmp" "$state/last.env"
}

# The update stopped part way. Before the new app was installed nothing needs undoing (the old app
# still runs); after, the box may be half updated, so it rolls back straight away.
stop() {
  local reason="$1"
  log "Failed: $reason"
  write_last failed
  if [ "$stage" = install ]; then
    UTV_LOCK_HELD=1 "$bin/ultimatetv-rollback" --reason "$reason" || log "The roll back failed too: see the lines above"
  fi
  exit 1
}

main() {
  # shellcheck disable=SC1091
  . "$etc/update.env" # APP_DIR, BRANCH, TV_USER
  auto=0
  [ "${1:-}" = --auto ] && auto=1
  install -d -m 755 "$state"
  # One update or roll back at a time (Monday's timer and a press of Update now, say).
  exec 9>"${UTV_LOCK:-/run/ultimatetv-update.lock}"
  flock -n 9 || { echo "An update or roll back is already running"; exit 0; }

  from="$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
  to=""
  if [ "$auto" = 1 ]; then
    to="$(git -C "$APP_DIR" ls-remote origin "refs/heads/$BRANCH" 2>/dev/null | cut -f1 || true)"
    if [ -n "$to" ] && grep -qx "$to" "$state/bad-commits" 2>/dev/null; then
      log "Skipped: ${to:0:7} was rolled back after an earlier update. A newer commit installs as usual; Update the box in Settings installs this one anyway."
      exit 0
    fi
  fi
  started="$(date -u +%FT%TZ)"
  snapshot=""
  done_at=""
  stage=prepare
  log "Starting ($([ "$auto" = 1 ] && echo weekly || echo asked for)) from ${from:0:7}"

  # The way back. /boot is the EFI partition, outside the snapshot: keep its kernel and initramfs.
  rm -rf "${state:?}/boot"
  install -d -m 755 "$state/boot"
  cp -a "$boot"/vmlinuz-* "$boot"/initramfs-*.img "$boot"/*-ucode.img "$state/boot/" 2>/dev/null || true
  if command -v snapper >/dev/null && snapper -c root list >/dev/null 2>&1; then
    snapshot="$(snapper -c root create --description "before UltimateTV update" --cleanup-algorithm number --print-number)"
    log "Snapshot $snapshot taken"
  else
    log "No snapper snapshots here (the root isn't btrfs): a roll back can only put the app back, not the OS packages"
  fi
  # The health check only expects the CEC adapter if it was there before.
  cec=0
  if compgen -G "$dev/cec*" >/dev/null; then cec=1; fi
  write_last updating

  stage=packages
  if command -v pacman >/dev/null; then
    pacman -Syu --noconfirm || stop "The system updates didn't install"
  else
    { apt-get update && DEBIAN_FRONTEND=noninteractive apt-get -y upgrade; } || stop "The system updates didn't install"
  fi

  # Pull the new app before running its installer, so the update runs the new installer.
  stage=fetch
  # The refspec also covers a box switched to another branch (the checkout is single branch).
  git -C "$APP_DIR" fetch --depth 1 origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" || stop "Couldn't download the app from GitHub"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH" || stop "Couldn't switch to the new version of the app"
  to="$(git -C "$APP_DIR" rev-parse HEAD)"

  stage=install
  local installer="$APP_DIR/tools/box/install.sh"
  SKIP_PACKAGES=1 KEEP_CHECKOUT=1 HUB_URL="$(sed -n 's/^HUB_URL=//p' "$etc/box.env" 2>/dev/null)" TV_USER="$TV_USER" APP_DIR="$APP_DIR" BRANCH="$BRANCH" \
    bash "$installer" || stop "The new version (${to:0:7}) didn't install"
  # On a trip the Hub runs on the box too (tools/hub/travel.sh): update it with the app.
  if [ -f "$etc/travel.env" ]; then
    (cd "$APP_DIR" && GIT_COMMIT="$(git rev-parse --short HEAD)" BUILD_DATE="$(git log -1 --format=%cI)" docker compose up -d --build hub) || log "The box's Hub didn't update"
  fi

  stage=finished
  done_at="$(date +%s)"
  write_last checking
  log "Installed ${to:0:7}. Restarting the TV app; the health check follows."
  systemctl restart sddm
  systemctl start --no-block ultimatetv-healthcheck.service
}

# All in one function so that the installer replacing this file mid-run can't change what runs.
main "$@"
exit 0
