#!/usr/bin/env bash
# UltimateTV box installer: turns a fresh Arch Linux (or Debian 13) install on a mini PC into the
# TV box. It boots straight into the TV app, plays through mpv with HDR and refresh rate
# switching, sends Dolby audio to the TV untouched, and takes the TV remote over HDMI-CEC.
#
#   sudo HUB_URL=http://192.168.0.19:8095 bash tools/box/install.sh
#
# Run it again any time: it updates the app and puts the settings back. Options (environment):
#   HUB_URL        the Hub (default http://192.168.0.19:8095)
#   TV_USER        the account the box logs in as (default tv)
#   APP_DIR        where the app lives (default /opt/ultimatetv)
#   REPO_URL       where updates come from (default the GitHub repository)
#   BRANCH         which branch to follow (default main)
#   SKIP_PACKAGES  1 to skip installing OS packages

set -euo pipefail

HUB_URL="${HUB_URL:-http://192.168.0.19:8095}"
TV_USER="${TV_USER:-tv}"
APP_DIR="${APP_DIR:-/opt/ultimatetv}"
REPO_URL="${REPO_URL:-https://github.com/gazoscalvertos/UltimateTV.git}"
BRANCH="${BRANCH:-main}"
ELECTRON_VERSION="44.6.0"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
files="$here/files"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run this with sudo"
[ -r /etc/os-release ] || die "can't tell which Linux this is"
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-} ${ID_LIKE:-}" in
  *arch*) distro=arch ;;
  *debian*|*ubuntu*) distro=debian ;;
  *) die "this installer supports Arch Linux and Debian; found ${PRETTY_NAME:-unknown}" ;;
esac
say "Installing UltimateTV on ${PRETTY_NAME:-$distro} for the Hub at $HUB_URL"

# --------------------------------------------------------------------------------------------
# Packages: KWin (Wayland, HDR), mpv, PipeWire, the GPU's video drivers, CEC tools and Node.

install_packages() {
  if [ "$distro" = arch ]; then
    pacman -Syu --needed --noconfirm \
      kwin kscreen sddm plasma-workspace xorg-xwayland \
      mpv ffmpeg libva-utils vulkan-icd-loader mesa \
      pipewire pipewire-pulse pipewire-alsa wireplumber \
      v4l-utils linuxconsoletools \
      nodejs npm git rsync \
      gtk3 nss alsa-lib libxss libxkbcommon \
      noto-fonts inter-font ttf-dejavu
    # Video decode and Vulkan for whichever GPU the box has.
    if lspci 2>/dev/null | grep -qi 'vga.*intel'; then pacman -S --needed --noconfirm intel-media-driver vulkan-intel; fi
    if lspci 2>/dev/null | grep -qi 'vga.*\(amd\|ati\)'; then pacman -S --needed --noconfirm libva-mesa-driver vulkan-radeon; fi
    if findmnt -n -o FSTYPE / | grep -qx btrfs; then pacman -S --needed --noconfirm snapper snap-pac; fi
  else
    export DEBIAN_FRONTEND=noninteractive
    sed -i 's/^Components: main$/Components: main contrib non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true
    apt-get update
    apt-get install -y --no-install-recommends \
      kwin-wayland kscreen sddm xwayland \
      mpv ffmpeg vainfo mesa-vulkan-drivers \
      pipewire pipewire-pulse pipewire-alsa wireplumber \
      v4l-utils ir-keytable inputattach \
      nodejs npm git rsync ca-certificates \
      libgtk-3-0 libnss3 libasound2 libxss1 libxkbcommon0 \
      fonts-noto-core fonts-inter fonts-dejavu-core
    if lspci 2>/dev/null | grep -qi 'vga.*intel'; then apt-get install -y intel-media-va-driver-non-free; fi
    if findmnt -n -o FSTYPE / | grep -qx btrfs; then apt-get install -y snapper; fi
    node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    [ "$node_major" -ge 22 ] || warn "Node $node_major is too old for the app; install Node 22 (e.g. from NodeSource) and run this again"
  fi
}

if [ "${SKIP_PACKAGES:-0}" != 1 ]; then
  say "Installing packages"
  install_packages
fi

# --------------------------------------------------------------------------------------------
# The tv user: logs in automatically, may use the GPU, sound, CEC and input devices.

if ! id "$TV_USER" >/dev/null 2>&1; then
  say "Creating the $TV_USER user"
  useradd -m -s /bin/bash "$TV_USER"
  passwd -l "$TV_USER" >/dev/null
fi
for g in video audio render input uucp dialout; do
  getent group "$g" >/dev/null && usermod -aG "$g" "$TV_USER"
done
home="$(getent passwd "$TV_USER" | cut -d: -f6)"

# --------------------------------------------------------------------------------------------
# The app: the repository in APP_DIR, built for the box (the shell; the UI comes from the Hub).

say "Installing the app in $APP_DIR"
src_root="$(cd "$here/../.." && pwd)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
elif [ -f "$src_root/box/package.json" ] && [ "$src_root" != "$APP_DIR" ]; then
  # Installing from a checkout: copy it, then follow the repository for updates.
  mkdir -p "$APP_DIR"
  rsync -a --delete --exclude node_modules --exclude '*/dist' "$src_root/" "$APP_DIR/"
else
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
(
  cd "$APP_DIR"
  npm ci --no-audit --no-fund --workspace box --workspace shared --include-workspace-root
  npx tsc -b box
  [ "$(node -p 'require("electron/package.json").version')" = "$ELECTRON_VERSION" ] || warn "Electron isn't $ELECTRON_VERSION"
)
chown -R root:root "$APP_DIR"

install -d /etc/ultimatetv
if [ ! -f /etc/ultimatetv/box.env ]; then
  cat > /etc/ultimatetv/box.env <<EOF
# UltimateTV box settings. Restart the box (or run: sudo systemctl restart sddm) after a change.
HUB_URL=$HUB_URL
CEC_DEVICE=/dev/cec0
# AUDIO_DEVICE=pipewire
# MPV_ARGS=
# Suspend the box a minute after the TV goes to standby (needs the box to wake on CEC or USB).
SUSPEND_WHEN_TV_OFF=0
EOF
else
  sed -i "s|^HUB_URL=.*|HUB_URL=$HUB_URL|" /etc/ultimatetv/box.env
fi

# --------------------------------------------------------------------------------------------
# The session: SDDM logs the tv user straight into KWin running only the TV app.

say "Setting up the TV session"
cat > /usr/local/bin/ultimatetv-app <<EOF
#!/usr/bin/env bash
# Starts the box shell with the settings in /etc/ultimatetv/box.env.
set -a
# shellcheck disable=SC1091
. /etc/ultimatetv/box.env
set +a
exec "$APP_DIR/node_modules/.bin/electron" --ozone-platform=wayland "$APP_DIR/box/dist/main.js" >>"\${XDG_STATE_HOME:-\$HOME/.local/state}/ultimatetv.log" 2>&1
EOF
cat > /usr/local/bin/ultimatetv-session <<'EOF'
#!/usr/bin/env bash
# The whole TV session: KWin with nothing but the app. If the app quits, the session restarts.
mkdir -p "${XDG_STATE_HOME:-$HOME/.local/state}"
export QT_QPA_PLATFORM=wayland XDG_CURRENT_DESKTOP=KDE XDG_SESSION_TYPE=wayland
exec kwin_wayland --xwayland --no-lockscreen --no-global-shortcuts --exit-with-session=/usr/local/bin/ultimatetv-app
EOF
chmod 755 /usr/local/bin/ultimatetv-app /usr/local/bin/ultimatetv-session
install -Dm644 "$files/ultimatetv.desktop" /usr/share/wayland-sessions/ultimatetv.desktop

install -d /etc/sddm.conf.d
cat > /etc/sddm.conf.d/ultimatetv.conf <<EOF
[Autologin]
User=$TV_USER
Session=ultimatetv
Relogin=true

[General]
DisplayServer=wayland
EOF
systemctl enable sddm.service >/dev/null 2>&1 || warn "couldn't enable sddm"
systemctl set-default graphical.target >/dev/null

# KWin: the UI window on top of the video window, no effects, no screen edges, no lock screen.
install -d -o "$TV_USER" -g "$TV_USER" "$home/.config"
for f in kwinrulesrc kwinrc kscreenlockerrc; do
  install -m644 -o "$TV_USER" -g "$TV_USER" "$files/$f" "$home/.config/$f"
done

# --------------------------------------------------------------------------------------------
# Sound: Dolby Digital (Plus) and DTS pass through the HDMI output to the TV.

install -Dm644 "$files/51-ultimatetv-hdmi.conf" /etc/wireplumber/wireplumber.conf.d/51-ultimatetv-hdmi.conf
loginctl enable-linger "$TV_USER" >/dev/null 2>&1 || true

# --------------------------------------------------------------------------------------------
# The TV remote: the Pulse-Eight adapter, the kernel CEC driver and our key map.

say "Setting up HDMI-CEC for the TV remote"
echo pulse8-cec > /etc/modules-load.d/ultimatetv-cec.conf
install -Dm644 "$files/cec-keymap.toml" /etc/rc_keymaps/ultimatetv-cec.toml
install -Dm644 "$files/70-ultimatetv-cec.rules" /etc/udev/rules.d/70-ultimatetv-cec.rules
install -Dm644 "$files/ultimatetv-cec-attach@.service" /etc/systemd/system/ultimatetv-cec-attach@.service
systemctl daemon-reload
udevadm control --reload-rules
udevadm trigger --subsystem-match=tty --subsystem-match=rc --subsystem-match=cec || true

# --------------------------------------------------------------------------------------------
# Updates: weekly at 4 am, after a snapshot when the root is btrfs.

say "Setting up weekly updates"
if command -v snapper >/dev/null && findmnt -n -o FSTYPE / | grep -qx btrfs; then
  snapper -c root list >/dev/null 2>&1 || snapper -c root create-config / || warn "snapper couldn't set up snapshots"
fi
cat > /usr/local/bin/ultimatetv-update <<EOF
#!/usr/bin/env bash
# Weekly update: snapshot, OS packages, then the app. The TV session restarts afterwards.
set -euo pipefail
if command -v snapper >/dev/null && snapper -c root list >/dev/null 2>&1; then
  snapper -c root create --description "before UltimateTV update" --cleanup-algorithm number
fi
if [ -x /usr/bin/pacman ]; then pacman -Syu --noconfirm; else apt-get update && DEBIAN_FRONTEND=noninteractive apt-get -y upgrade; fi
SKIP_PACKAGES=1 HUB_URL="\$(sed -n 's/^HUB_URL=//p' /etc/ultimatetv/box.env)" TV_USER=$TV_USER APP_DIR=$APP_DIR BRANCH=$BRANCH bash $APP_DIR/tools/box/install.sh
systemctl restart sddm
EOF
chmod 755 /usr/local/bin/ultimatetv-update
cat > /etc/systemd/system/ultimatetv-update.service <<'EOF'
[Unit]
Description=Update UltimateTV and the OS
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/ultimatetv-update
EOF
cat > /etc/systemd/system/ultimatetv-update.timer <<'EOF'
[Unit]
Description=Weekly UltimateTV update

[Timer]
OnCalendar=Mon *-*-* 04:00:00
RandomizedDelaySec=20min
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable ultimatetv-update.timer >/dev/null

# --------------------------------------------------------------------------------------------
# Check what we can from here.

say "Checking"
ok=1
curl -fsS --max-time 5 "$HUB_URL/api/health" >/dev/null 2>&1 || { warn "can't reach the Hub at $HUB_URL yet"; ok=0; }
ls /dev/dri/renderD* >/dev/null 2>&1 || { warn "no GPU render device found"; ok=0; }
ls /dev/cec* >/dev/null 2>&1 || warn "no CEC device yet (fine until the Pulse-Eight adapter is plugged in)"
[ -x "$APP_DIR/node_modules/.bin/electron" ] || { warn "Electron didn't install"; ok=0; }
if [ "$ok" = 1 ]; then
  say "Done. Reboot and the box starts straight into UltimateTV."
else
  say "Installed, with the warnings above. Reboot when they're sorted."
fi
say "Settings: /etc/ultimatetv/box.env · Log: $home/.local/state/ultimatetv.log · Box probe: bash $APP_DIR/tools/box/probe.sh"
