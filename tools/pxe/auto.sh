#!/usr/bin/env bash
# Unattended Arch Linux install for the UltimateTV box. The Arch installer runs this straight
# after it boots over the network (the `script=` boot option). It erases the target disk, installs
# Arch on btrfs with systemd-boot, and leaves a first-boot job that clones the repository and runs
# tools/box/install.sh. Settings come from box.conf on the PXE server.

set -euo pipefail

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
fail() {
  printf '\n\033[1;31mThe install stopped: %s\033[0m\nThe log is in /root/install.log. Press Enter for a shell.\n' "$*"
  read -r _
  exit 1
}
trap 'fail "line $LINENO"' ERR
exec > >(tee -a /root/install.log) 2>&1

script_url="$(tr ' ' '\n' </proc/cmdline | sed -n 's/^script=//p')"
server="${script_url%/*}"
log "Fetching settings from $server"
for _ in $(seq 1 30); do curl -fsS "$server/box.conf" -o /root/box.conf && break; sleep 2; done
[ -s /root/box.conf ] || fail "couldn't fetch box.conf from $server"
# shellcheck disable=SC1091
. /root/box.conf
: "${ADMIN_USER:=gary}" "${BOX_HOSTNAME:=ultimatetv}" "${TIMEZONE:=Europe/London}" "${KEYMAP:=uk}" "${LOCALE:=en_GB.UTF-8}" "${BRANCH:=main}"
: "${ARCH_MIRROR:=https://geo.mirror.pkgbuild.com}"

# The disk: the one named in TARGET_DISK, else the biggest internal (not USB) disk.
disk="${TARGET_DISK:-}"
if [ -z "$disk" ]; then
  disk="$(lsblk -dbnpo NAME,SIZE,TYPE,RM,TRAN | awk '$3=="disk" && $4=="0" && $5!="usb" {print $2, $1}' | sort -n | tail -1 | cut -d' ' -f2)"
fi
[ -b "$disk" ] || fail "no disk to install to (set TARGET_DISK)"
log "Installing UltimateTV on $disk ($(lsblk -dno SIZE,MODEL "$disk" | xargs)). Erasing it in 15 seconds; power off now to stop."
sleep 15

case "$disk" in *nvme*|*mmcblk*) p="${disk}p" ;; *) p="$disk" ;; esac
esp="${p}1"
root="${p}2"

log "Partitioning"
umount -R /mnt 2>/dev/null || true
wipefs -af "$disk"
sgdisk --zap-all "$disk"
sgdisk -n 1:0:+1G -t 1:ef00 -c 1:EFI -n 2:0:0 -t 2:8300 -c 2:ultimatetv "$disk"
partprobe "$disk"
udevadm settle
mkfs.fat -F 32 -n EFI "$esp"
mkfs.btrfs -f -L ultimatetv "$root"

# Subvolumes: the system, home, logs and the package cache. Snapper adds /.snapshots itself.
mount "$root" /mnt
for sv in @ @home @log @pkg; do btrfs subvolume create "/mnt/$sv"; done
umount /mnt
opts="noatime,compress=zstd:1"
mount -o "$opts,subvol=@" "$root" /mnt
mkdir -p /mnt/{boot,home,var/log,var/cache/pacman/pkg}
mount -o "$opts,subvol=@home" "$root" /mnt/home
mount -o "$opts,subvol=@log" "$root" /mnt/var/log
mount -o "$opts,subvol=@pkg" "$root" /mnt/var/cache/pacman/pkg
mount "$esp" /mnt/boot

log "Installing Arch Linux"
echo "Server = ${ARCH_MIRROR%/}/\$repo/os/\$arch" >/etc/pacman.d/mirrorlist
ucode=()
grep -q GenuineIntel /proc/cpuinfo && ucode+=(intel-ucode)
grep -q AuthenticAMD /proc/cpuinfo && ucode+=(amd-ucode)
pacstrap -K /mnt base linux linux-firmware "${ucode[@]}" btrfs-progs networkmanager openssh sudo git curl rsync nano pciutils
genfstab -U /mnt >>/mnt/etc/fstab

log "Setting up the system"
ln -sf "/usr/share/zoneinfo/$TIMEZONE" /mnt/etc/localtime
echo "$LOCALE UTF-8" >>/mnt/etc/locale.gen
echo "LANG=$LOCALE" >/mnt/etc/locale.conf
echo "KEYMAP=$KEYMAP" >/mnt/etc/vconsole.conf
echo "$BOX_HOSTNAME" >/mnt/etc/hostname
cp /root/box.conf /mnt/root/box.conf
chmod 600 /mnt/root/box.conf

# The rest runs inside the new system.
cat >/mnt/root/setup.sh <<'CHROOT'
set -euo pipefail
. /root/box.conf
: "${ADMIN_USER:=gary}"
hwclock --systohc
locale-gen
useradd -m -G wheel -s /bin/bash "$ADMIN_USER"
if [ -n "${ADMIN_PASSWORD_HASH:-}" ]; then usermod -p "$ADMIN_PASSWORD_HASH" "$ADMIN_USER"; else passwd -l "$ADMIN_USER"; fi
if [ -n "${ADMIN_SSH_KEY:-}" ]; then
  install -d -m700 -o "$ADMIN_USER" -g "$ADMIN_USER" "/home/$ADMIN_USER/.ssh"
  echo "$ADMIN_SSH_KEY" >"/home/$ADMIN_USER/.ssh/authorized_keys"
  chown "$ADMIN_USER:$ADMIN_USER" "/home/$ADMIN_USER/.ssh/authorized_keys"
  chmod 600 "/home/$ADMIN_USER/.ssh/authorized_keys"
fi
echo '%wheel ALL=(ALL:ALL) ALL' >/etc/sudoers.d/wheel
chmod 440 /etc/sudoers.d/wheel
passwd -l root
systemctl enable NetworkManager.service NetworkManager-wait-online.service sshd.service systemd-timesyncd.service

# systemd-boot, quiet and with no menu delay (hold Space while booting to see it).
bootctl --esp-path=/boot install
uuid="$(findmnt -no UUID /)"
initrds=""
for u in intel-ucode amd-ucode; do [ -f "/boot/$u.img" ] && initrds+="initrd  /$u.img"$'\n'; done
cat >/boot/loader/loader.conf <<EOF
default arch.conf
timeout 0
console-mode max
editor no
EOF
cat >/boot/loader/entries/arch.conf <<EOF
title   UltimateTV
linux   /vmlinuz-linux
${initrds}initrd  /initramfs-linux.img
options root=UUID=$uuid rootflags=subvol=@ rw quiet loglevel=3 systemd.show_status=auto rd.udev.log_level=3 vt.global_cursor_default=0
EOF
cat >/boot/loader/entries/arch-fallback.conf <<EOF
title   UltimateTV (fallback)
linux   /vmlinuz-linux
${initrds}initrd  /initramfs-linux-fallback.img
options root=UUID=$uuid rootflags=subvol=@ rw
EOF

# First boot: clone the app and run the box installer, then restart into the TV session.
cat >/usr/local/sbin/ultimatetv-firstboot <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
. /root/box.conf
for _ in $(seq 1 60); do curl -fsS --max-time 5 https://github.com >/dev/null && break; sleep 5; done
# A private repository needs a token; git keeps it for the weekly updates too (root only).
if [ -n "${GITHUB_TOKEN:-}" ]; then
  git config --global credential.helper store
  (umask 077 && echo "https://x-access-token:${GITHUB_TOKEN}@github.com" >/root/.git-credentials)
fi
rm -rf /opt/ultimatetv
git clone --depth 1 --branch "${BRANCH:-main}" "${REPO_URL:-https://github.com/gazoscalvertos/UltimateTV.git}" /opt/ultimatetv
HUB_URL="$HUB_URL" BRANCH="${BRANCH:-main}" bash /opt/ultimatetv/tools/box/install.sh
install -d /var/lib/ultimatetv
touch /var/lib/ultimatetv/installed
systemctl disable ultimatetv-firstboot.service
systemctl reboot
EOF
chmod 755 /usr/local/sbin/ultimatetv-firstboot
cat >/etc/systemd/system/ultimatetv-firstboot.service <<'EOF'
[Unit]
Description=Install UltimateTV (first boot)
After=network-online.target
Wants=network-online.target
ConditionPathExists=!/var/lib/ultimatetv/installed

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/ultimatetv-firstboot
StandardOutput=journal+console
StandardError=journal+console
TimeoutStartSec=infinity

[Install]
WantedBy=multi-user.target
EOF
systemctl enable ultimatetv-firstboot.service
CHROOT
arch-chroot /mnt /bin/bash /root/setup.sh </dev/null
rm /mnt/root/setup.sh

log "Done. Restarting into the new system, which installs UltimateTV on its first boot (about 10 minutes)."
umount -R /mnt
sleep 5
systemctl reboot
