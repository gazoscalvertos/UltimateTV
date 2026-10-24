#!/usr/bin/env bash
# UltimateTV box probe: reports what a Linux box plugged into the TV can do.
# Read-only. Missing tools are reported, never installed.
#
#   bash probe.sh [output.md]
#   HUB_URL=http://192.168.0.19:8095 bash probe.sh   # also checks the Hub
#
# Run it from the box's own desktop session (not over SSH) so the display checks can see the screen.

set -u

out="${1:-box-probe-$(hostname 2>/dev/null || echo box)-$(date +%Y%m%d-%H%M).md}"
missing=()

have() { command -v "$1" >/dev/null 2>&1; }
need() { have "$1" || { missing+=("$1 ($2)"); return 1; }; }
section() { printf '\n## %s\n\n' "$1"; }
block() { printf '```\n'; cat; printf '```\n'; }
yesno() { if [ "$1" -eq 0 ]; then echo yes; else echo no; fi; }

probe() {
  printf '# Box probe: %s\n\n' "$(hostname 2>/dev/null || echo unknown)"
  printf 'Run %s by UltimateTV tools/box/probe.sh\n' "$(date -Iseconds)"

  section "System"
  {
    if [ -r /etc/os-release ]; then
      # shellcheck disable=SC1091
      . /etc/os-release
      echo "OS:        ${PRETTY_NAME:-unknown}"
    fi
    echo "Kernel:    $(uname -r) ($(uname -m))"
    if have lscpu; then
      echo "CPU:       $(lscpu | sed -n 's/^Model name: *//p' | head -n1)"
    fi
    echo "Memory:    $(awk '/MemTotal/ {printf "%.1f GB", $2/1048576}' /proc/meminfo)"
    echo "Root fs:   $(findmnt -no FSTYPE / 2>/dev/null || echo unknown)"
    echo "Session:   ${XDG_SESSION_TYPE:-none} / ${XDG_CURRENT_DESKTOP:-none}"
    if have kwin_wayland; then echo "KWin:      $(kwin_wayland --version 2>/dev/null | head -n1)"; fi
    if have plasmashell; then echo "Plasma:    $(plasmashell --version 2>/dev/null | head -n1)"; fi
  } | block

  section "Graphics"
  if need lspci "pciutils"; then
    lspci -nnk | grep -A3 -Ei 'vga|display|3d controller' | block
  fi
  if need vainfo "libva-utils"; then
    va="$(vainfo 2>&1)"
    echo "$va" | grep -Ei 'driver version|vainfo: VA-API version' | block
    printf '\n| Hardware decode | Supported |\n|---|---|\n'
    for p in "H264High" "HEVCMain " "HEVCMain10" "VP9Profile2" "AV1Profile0"; do
      echo "$va" | grep -q "VAProfile${p}.*VAEntrypointVLD"
      printf '| %s | %s |\n' "${p% }" "$(yesno $?)"
    done
  fi
  if have glxinfo; then
    glxinfo -B 2>/dev/null | grep -E 'OpenGL renderer|OpenGL core profile version' | block
  fi

  section "Player"
  if need mpv "mpv"; then
    mpv --version 2>/dev/null | head -n3 | block
    opts="$(mpv --list-options 2>/dev/null)"
    printf '\n| mpv feature | Available |\n|---|---|\n'
    for o in target-colorspace-hint vo=gpu-next hwdec audio-spdif; do
      echo "$opts" | grep -q -- "--${o%%=*} "
      printf '| %s | %s |\n' "$o" "$(yesno $?)"
    done
    mpv --vo=help 2>/dev/null | grep -q 'gpu-next'
    printf '| gpu-next video output | %s |\n' "$(yesno $?)"
  fi

  section "Display (HDMI and the TV's EDID)"
  found=0
  for d in /sys/class/drm/card*-*; do
    [ -r "$d/status" ] || continue
    name="${d##*/}"
    status="$(cat "$d/status")"
    echo "- ${name#card*-}: $status"
    if [ "$status" = connected ] && [ -s "$d/edid" ]; then
      found=1
      if need edid-decode "edid-decode or v4l-utils"; then
        edid-decode "$d/edid" 2>/dev/null | grep -Ei \
          'Display Product Name|Manufacturer:|Supported EOTFs|Traditional|SMPTE ST2084|Hybrid Log|Colorimetry|BT2020|Desired content|Maximum TMDS|Max TMDS|HDMI Forum|Dolby Vision|HDR10\+|AC-3|E-AC-3|Dolby|DTS|MAT|Linear PCM|Max channels|VRR|ALLM|[^0-9](23\.98|24\.00|25\.00|50\.00) Hz' \
          | sort -u | head -n 60 | block
      fi
    fi
  done
  [ "$found" -eq 1 ] || echo "No connected display with an EDID was found. Is the TV on and on this input?"
  if have kscreen-doctor; then
    printf '\nkscreen-doctor (modes, HDR and colour settings):\n\n'
    kscreen-doctor -o 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | head -n 80 | block
  else
    missing+=("kscreen-doctor (Plasma: libkscreen)")
  fi

  section "Audio over HDMI"
  if need aplay "alsa-utils"; then
    aplay -l 2>&1 | grep -Ei 'card|hdmi' | block
  fi
  eld_found=0
  for e in /proc/asound/card*/eld#*; do
    [ -r "$e" ] || continue
    if grep -q 'monitor_present[[:space:]]*1' "$e"; then
      eld_found=1
      printf '\n%s (the audio formats the TV says it accepts):\n\n' "$e"
      grep -E 'monitor_name|connection_type|sad[0-9]+_(coding_type|channels|rates)' "$e" | block
    fi
  done
  [ "$eld_found" -eq 1 ] || echo "No HDMI audio ELD found. The TV must be on and on this input."
  if have pactl; then
    pactl info 2>/dev/null | grep -E 'Server Name|Default Sink' | block
  fi

  section "HDMI-CEC (remote control)"
  {
    if have lsusb; then
      if lsusb | grep -qi '2548:1002'; then echo "Pulse-Eight USB-CEC adapter: plugged in"; else echo "Pulse-Eight USB-CEC adapter: not found"; fi
    fi
    ls -l /dev/cec* /dev/ttyACM* 2>/dev/null || echo "No /dev/cec* or /dev/ttyACM* devices"
    grep -q pulse8_cec /proc/modules 2>/dev/null
    echo "pulse8-cec kernel driver loaded: $(yesno $?)"
    if have inputattach; then echo "inputattach: installed"; else echo "inputattach: missing (needed to start the Pulse-Eight with the kernel driver)"; fi
    if have cec-ctl; then echo "cec-ctl: installed"; else echo "cec-ctl: missing (v4l-utils)"; fi
    if have cec-client; then echo "cec-client (libcec): installed"; fi
  } | block
  if have cec-ctl; then
    for c in /dev/cec*; do
      [ -e "$c" ] || continue
      printf '\n%s:\n\n' "$c"
      cec-ctl -d "$c" 2>&1 | head -n 30 | block
    done
  fi

  section "Network"
  { ip -br addr 2>/dev/null | grep -v '^lo' || true; } | block
  if [ -n "${HUB_URL:-}" ] && have curl; then
    if curl -fsS --max-time 5 "$HUB_URL/api/health" >/dev/null 2>&1; then
      echo "Hub at $HUB_URL: reachable"
    else
      echo "Hub at $HUB_URL: NOT reachable"
    fi
  fi

  section "Missing tools"
  if [ "${#missing[@]}" -eq 0 ]; then
    echo "None."
  else
    for m in "${missing[@]}"; do echo "- $m"; done
    # The backticks below are Markdown, not command substitution.
    # shellcheck disable=SC2016
    printf '\nArch: `sudo pacman -S --needed pciutils libva-utils mpv v4l-utils alsa-utils usbutils` (inputattach: build it from the linuxconsoletools release, as tools/box/install.sh does)\n'
    # shellcheck disable=SC2016
    printf 'Debian: `sudo apt install pciutils vainfo mpv v4l-utils edid-decode alsa-utils usbutils inputattach`\n'
  fi
}

probe | tee "$out"
echo
echo "Saved to $out"
