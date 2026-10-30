#!/usr/bin/env bash
# Undoes the box's last update, installed as /usr/local/bin/ultimatetv-rollback by install.sh. The
# health check runs it when an update leaves the box broken; Settings › About › Roll back last update
# and the phone run it through ultimatetv-rollback.service (with --manual).
#
# With a snapper snapshot from before the update (a btrfs root), the whole system goes back: the app,
# OS packages and settings (snapper undochange), and the kernel files in /boot from the copy the
# update kept. Without one, only the app goes back to the commit it ran before. Then the box reboots.
# The commit that was rolled back goes in bad-commits, so the weekly update doesn't install it again.
#
#   --manual        asked for in Settings or on the phone (no alert; still skips that commit)
#   --reason TEXT   why, for the log, Settings › About and the alert
#   --no-reboot     leave the reboot to whoever ran it
#
# /var/lib/ultimatetv/update (this script's state) is on the root, so the snapshot would undo it
# too: it's kept aside and put back after. Files there:
#   last.env      the update that can be undone: snapshot, from, to, status
#   health.env    the last health check's result
#   rollback.env  the last roll back: when, why, from, to, how, ok
#   bad-commits   commits not to install automatically again
#   update.log    what update, health check and roll back did
#   boot/         the kernel files from before the update
#
# For the tests, UTV_ETC, UTV_STATE, UTV_BOOT, UTV_LOCK and UTV_KEEP move the paths it uses.

set -euo pipefail

etc="${UTV_ETC:-/etc/ultimatetv}"
state="${UTV_STATE:-/var/lib/ultimatetv/update}"
boot="${UTV_BOOT:-/boot}"

log() {
  local line
  line="$(date -u +%FT%TZ) rollback: $*"
  echo "$line"
  echo "$line" >>"$state/update.log"
}

value() { sed -n "s/^$2=//p" "$1" 2>/dev/null | head -n 1 || true; }

main() {
  local manual=0 reason="" reboot=1
  while [ $# -gt 0 ]; do
    case "$1" in
      --manual) manual=1 ;;
      --reason) reason="${2:-}"; shift ;;
      --no-reboot) reboot=0 ;;
      *) echo "unknown option $1" >&2; exit 2 ;;
    esac
    shift
  done
  [ -n "$reason" ] || reason="$([ "$manual" = 1 ] && echo "Asked for in Settings" || echo "The update failed its health check")"
  # shellcheck disable=SC1091
  . "$etc/update.env" # APP_DIR, BRANCH, TV_USER
  install -d -m 755 "$state"
  # The update holds the lock already when it rolls back its own failed install.
  if [ "${UTV_LOCK_HELD:-0}" != 1 ]; then
    exec 9>"${UTV_LOCK:-/run/ultimatetv-update.lock}"
    flock -w 900 9 || { log "An update is still running: try again when it's done"; exit 1; }
  fi
  local last="$state/last.env"
  if [ ! -f "$last" ]; then
    log "Nothing to roll back: no update since the last roll back (or since this was installed)"
    exit 1
  fi
  local snapshot from to
  snapshot="$(value "$last" snapshot)"
  from="$(value "$last" from)"
  to="$(value "$last" to)"
  log "Rolling back${to:+ ${to:0:7}}${from:+ to ${from:0:7}}: $reason"

  # Keep this script's state out of the way of the snapshot.
  local keep
  keep="$(mktemp -d "${UTV_KEEP:-/run}/ultimatetv-rollback.XXXXXX")"
  cp -a "$state/." "$keep/"

  local how="" ok=1
  if [[ "$snapshot" =~ ^[0-9]+$ ]] && command -v snapper >/dev/null; then
    how=snapshot
    if ! snapper -c root undochange "$snapshot..0"; then
      ok=0
      echo "snapper couldn't undo everything" >>"$keep/update.log"
    fi
    if compgen -G "$keep/boot/*" >/dev/null; then
      cp -a "$keep/boot/." "$boot/" || { ok=0; echo "couldn't put the kernel files back in /boot" >>"$keep/update.log"; }
    fi
  elif [[ "$from" =~ ^[0-9a-f]{7,40}$ ]]; then
    how=app
    local installer="$APP_DIR/tools/box/install.sh"
    if ! { git -C "$APP_DIR" fetch --depth 1 origin "$from" &&
      git -C "$APP_DIR" reset --hard "$from" &&
      SKIP_PACKAGES=1 KEEP_CHECKOUT=1 HUB_URL="$(value "$etc/box.env" HUB_URL)" TV_USER="$TV_USER" APP_DIR="$APP_DIR" BRANCH="$BRANCH" \
        bash "$installer"; }; then
      ok=0
    fi
  else
    rm -rf "$keep"
    log "Can't roll back: there's no snapshot and the app's previous commit isn't known"
    exit 1
  fi

  # Put the state back as it was just now, then record what happened.
  rm -rf "$state"
  install -d -m 755 "$state"
  cp -a "$keep/." "$state/"
  rm -rf "$keep"
  if [ -n "$to" ] && [ "$to" != "$from" ] && ! grep -qx "$to" "$state/bad-commits" 2>/dev/null; then
    echo "$to" >>"$state/bad-commits"
  fi
  {
    echo "at=$(date -u +%FT%TZ)"
    echo "reason=$reason"
    echo "from=$to"
    echo "to=$from"
    echo "how=$how"
    echo "manual=$manual"
    echo "ok=$ok"
  } >"$state/rollback.env"
  rm -f "$last"
  chmod 644 "$state"/*.env "$state/bad-commits" 2>/dev/null || true
  if [ "$ok" = 1 ]; then log "Done ($how)"; else log "Finished with errors ($how): see the lines above"; fi
  if [ "$reboot" = 1 ] && { [ "$how" = snapshot ] || [ "$ok" = 1 ]; }; then
    log "Rebooting"
    systemctl reboot
  fi
  [ "$ok" = 1 ]
}

main "$@"
exit $?
