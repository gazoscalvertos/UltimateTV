#!/usr/bin/env bash
# The check after a box update, installed as /usr/local/bin/ultimatetv-healthcheck by install.sh.
# ultimatetv-update starts it as soon as the update is in, and ultimatetv-healthcheck.service runs it
# at every boot in case the box restarted before it finished. It does nothing unless an update is
# waiting to be checked (status=checking in last.env).
#
# Within a few minutes (HEALTH_WAIT seconds, 240 by default) it wants:
#   app   the TV app started and wrote its heartbeat (~tv/.local/state/ultimatetv-health) since
#   hub   the app reaches the Hub (only counted when the box itself can reach it: a Hub that's down
#         isn't the update's fault)
#   mpv   mpv plays a test clip (hardware decoding when it can)
#   cec   the CEC adapter is there (only when it was there before the update)
# All pass: the update stays. One fails: it rolls back (ultimatetv-rollback), unless box.env has
# AUTO_ROLLBACK=0, in which case it only says so. Either way the result is in health.env, beside
# last.env, for Settings › About, the phone and the Hub's diagnostics.
#
# For the tests, UTV_ETC, UTV_STATE, UTV_DEV, UTV_BIN, UTV_HEARTBEAT, UTV_CLIP and UTV_POLL move the
# paths and timings it uses.

set -euo pipefail

etc="${UTV_ETC:-/etc/ultimatetv}"
state="${UTV_STATE:-/var/lib/ultimatetv/update}"
dev="${UTV_DEV:-/dev}"
bin="${UTV_BIN:-/usr/local/bin}"
clip="${UTV_CLIP:-/usr/local/share/ultimatetv/test-clip.mkv}"
poll="${UTV_POLL:-10}"

log() {
  local line
  line="$(date -u +%FT%TZ) health: $*"
  echo "$line"
  echo "$line" >>"$state/update.log"
}

# One value from a key=value file, without running it (the heartbeat is the tv user's file).
value() { sed -n "s/^$2=//p" "$1" 2>/dev/null | head -n 1 || true; }

main() {
  # shellcheck disable=SC1091
  . "$etc/update.env" # APP_DIR, BRANCH, TV_USER
  local last="$state/last.env"
  [ -f "$last" ] || exit 0
  [ "$(value "$last" status)" = checking ] || exit 0
  local done_at cec_before wait hub_url auto_rollback home beat
  done_at="$(value "$last" "done")"
  [[ "$done_at" =~ ^[0-9]+$ ]] || done_at=0
  cec_before="$(value "$last" cec)"
  wait="$(value "$etc/box.env" HEALTH_WAIT)"
  [[ "$wait" =~ ^[0-9]+$ ]] || wait=240
  hub_url="$(value "$etc/box.env" HUB_URL)"
  auto_rollback="$(value "$etc/box.env" AUTO_ROLLBACK)"
  home="$(getent passwd "$TV_USER" | cut -d: -f6 || true)"
  beat="${UTV_HEARTBEAT:-$home/.local/state/ultimatetv-health}"
  log "Checking the update to $(value "$last" to | cut -c1-7)"

  # Wait for the app (and the CEC adapter, when it was there before) or until time's up.
  local deadline=$((SECONDS + wait)) app_ok=0 cec_ok=1 at
  [ "$cec_before" = 1 ] && cec_ok=0
  while :; do
    at="$(value "$beat" at)"
    if [[ "$at" =~ ^[0-9]+$ ]] && [ "$at" -ge "$done_at" ]; then app_ok=1; fi
    if [ "$cec_ok" = 0 ] && compgen -G "$dev/cec*" >/dev/null; then cec_ok=1; fi
    if [ "$app_ok" = 1 ] && [ "$cec_ok" = 1 ]; then break; fi
    [ "$SECONDS" -ge "$deadline" ] && break
    sleep "$poll"
  done

  local checks=() failed=()
  if [ "$app_ok" = 1 ]; then
    checks+=("app=1 The TV app started")
  else
    checks+=("app=0 The TV app didn't start within $((wait / 60)) minutes")
    failed+=("the TV app didn't start")
  fi

  if [ "$app_ok" = 1 ] && [ "$(value "$beat" hub)" = 1 ]; then
    checks+=("hub=1 The app reaches the Hub")
  elif [ -n "$hub_url" ] && curl -fsS --max-time 5 "$hub_url/api/health" >/dev/null 2>&1; then
    if [ "$app_ok" = 1 ]; then
      checks+=("hub=0 The app can't reach the Hub, though the box can")
      failed+=("the app can't reach the Hub")
    else
      checks+=("hub=0 Not checked: the app didn't start")
    fi
  else
    checks+=("hub=1 Not counted: the Hub isn't answering anyone, which isn't the update's fault")
  fi

  local media=(av://lavfi:testsrc2=duration=2:size=1280x720:rate=25)
  [ -f "$clip" ] && media=("$clip")
  if timeout 60 mpv --no-config --really-quiet --vo=null --ao=null --hwdec=auto-copy-safe --frames=50 "${media[@]}" >/dev/null 2>&1; then
    checks+=("mpv=1 mpv plays a test clip")
  else
    checks+=("mpv=0 mpv couldn't play a test clip")
    failed+=("mpv couldn't play a test clip")
  fi

  if [ "$cec_before" = 1 ]; then
    if [ "$cec_ok" = 1 ]; then checks+=("cec=1 The CEC adapter is there"); else
      checks+=("cec=0 The CEC adapter was there before the update and has gone")
      failed+=("the CEC adapter has gone")
    fi
  else
    checks+=("cec=1 Not checked: there was no CEC adapter before the update")
  fi

  local ok=1 summary="Everything works after the update"
  if [ "${#failed[@]}" -gt 0 ]; then
    ok=0
    local joined
    joined="$(IFS=,; echo "${failed[*]}")"
    summary="After the update ${joined//,/, }"
  fi
  {
    echo "at=$(date -u +%FT%TZ)"
    echo "ok=$ok"
    echo "summary=$summary"
    for c in "${checks[@]}"; do echo "check.${c%% *} ${c#* }"; done
  } >"$state/health.env.tmp"
  chmod 644 "$state/health.env.tmp"
  mv "$state/health.env.tmp" "$state/health.env"
  for c in "${checks[@]}"; do log "  ${c%%=*}: ${c#* }"; done

  if [ "$ok" = 1 ]; then
    sed -i 's/^status=.*/status=ok/' "$last"
    log "Passed: the update stays"
    return
  fi
  sed -i 's/^status=.*/status=failed/' "$last"
  log "Failed: $summary"
  if [ "$auto_rollback" = 0 ]; then
    log "AUTO_ROLLBACK=0 in box.env: leaving it. Roll back from Settings › About or the phone."
    return
  fi
  "$bin/ultimatetv-rollback" --reason "$summary"
}

main "$@"
exit 0
