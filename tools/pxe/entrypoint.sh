#!/usr/bin/env bash
# Writes the boot menu and the install settings from the environment, then serves them:
# proxy DHCP and TFTP with dnsmasq, and HTTP with busybox.

set -euo pipefail

: "${PXE_IP:?set PXE_IP to the LAN address of this machine}"
PXE_HTTP_PORT="${PXE_HTTP_PORT:-8097}"
ARCH_MIRROR="${ARCH_MIRROR:-https://geo.mirror.pkgbuild.com}"
ARCH_MIRROR="${ARCH_MIRROR%/}"
server="http://$PXE_IP:$PXE_HTTP_PORT"

# The network card that has PXE_IP, and its subnet, so proxy DHCP answers on the right network.
read -r iface prefix < <(ip -o -4 addr show | awk -v ip="$PXE_IP" '{split($4, a, "/"); if (a[1] == ip) { sub(/@.*/, "", $2); print $2, a[2] } }') || true
if [ -z "${iface:-}" ]; then
  echo "No network card here has the address $PXE_IP. Set PXE_IP to this machine's LAN address. Cards found:" >&2
  ip -o -4 addr show >&2
  exit 1
fi
to_int() { local IFS=.; read -r a b c d <<<"$1"; echo $(((a << 24) | (b << 16) | (c << 8) | d)); }
to_ip() { echo "$(($1 >> 24 & 255)).$(($1 >> 16 & 255)).$(($1 >> 8 & 255)).$(($1 & 255))"; }
mask=$(((0xffffffff << (32 - prefix)) & 0xffffffff))
network="$(to_ip $(($(to_int "$PXE_IP") & mask)))"
netmask="$(to_ip "$mask")"

if [ -z "${BOX_MAC:-}" ]; then
  echo "BOX_MAC isn't set: machines that netboot will see their MAC address and go back to their disk." >&2
fi
if [ -z "${ADMIN_PASSWORD_HASH:-}" ] && [ -z "${ADMIN_SSH_KEY:-}" ]; then
  echo "Set ADMIN_PASSWORD_HASH (openssl passwd -6) or ADMIN_SSH_KEY so you can log in to the box." >&2
  exit 1
fi

# TFTP: our iPXE under every name a firmware might ask for, and the menu.
cd /srv/tftp
cp -f ipxe.efi ipxe
cp -f ipxe.efi ipxe.0

{
  echo '#!ipxe'
  echo "set server $server"
  echo "set mirror $ARCH_MIRROR/iso/latest/"
  IFS=',' read -ra macs <<<"${BOX_MAC:-}"
  for m in "${macs[@]}"; do
    m="$(echo "$m" | tr 'A-F' 'a-f' | tr -d ' ')"
    [ -n "$m" ] && echo "iseq \${mac} $m && goto box ||"
  done
  cat <<'EOF'
echo
echo This machine (${mac}) isn't set up as an UltimateTV box. Starting from its disk.
echo To reinstall it as the box, add its MAC address to BOX_MAC on the PXE server.
sleep 15
exit

:box
menu UltimateTV box (${mac})
item local    Start normally from the disk
item install  Reinstall the box (erases the disk)
choose --default local --timeout 15000 target || goto local
goto ${target}

:local
exit

:install
echo Starting the Arch Linux installer from ${mirror}
kernel ${mirror}arch/boot/x86_64/vmlinuz-linux initrd=initramfs-linux.img archisobasedir=arch archiso_http_srv=${mirror} ip=dhcp script=${server}/auto.sh || goto failed
initrd ${mirror}arch/boot/x86_64/initramfs-linux.img || goto failed
boot || goto failed

:failed
echo Couldn't start the installer. Check the PXE server's ARCH_MIRROR. Starting from the disk.
sleep 15
exit
EOF
} > boot.ipxe

# HTTP: the install settings for auto.sh.
{
  echo "# UltimateTV box install settings, written by the PXE server."
  for v in HUB_URL BRANCH BOX_HOSTNAME TIMEZONE KEYMAP LOCALE ADMIN_USER ADMIN_PASSWORD_HASH ADMIN_SSH_KEY TARGET_DISK ARCH_MIRROR GITHUB_TOKEN; do
    printf '%s=%q\n' "$v" "${!v:-}"
  done
  printf 'REPO_URL=%q\n' "${REPO_URL:-https://github.com/gazoscalvertos/UltimateTV.git}"
} > /srv/http/box.conf

if [ "${PXE_DHCP:-proxy}" = off ]; then
  # Files only: another DHCP server (AdGuard Home) sends the box here with options 66 and 67.
  cat > /etc/dnsmasq.d/ultimatetv.conf <<EOF
port=0
user=root
interface=$iface
enable-tftp
tftp-root=/srv/tftp
EOF
else
  cat > /etc/dnsmasq.d/ultimatetv.conf <<EOF
# Proxy DHCP: the router still gives out addresses; we only add where to boot from. Replies go to
# 255.255.255.255, because the box has no address yet and some LXCs give their card a /32.
port=0
user=root
interface=$iface
dhcp-range=$network,proxy,$netmask,255.255.255.255
pxe-service=x86-64_EFI,"UltimateTV",ipxe
pxe-service=BC_EFI,"UltimateTV",ipxe
enable-tftp
tftp-root=/srv/tftp
log-dhcp
EOF
fi

echo "UltimateTV PXE server on $iface ($network/$prefix): menu for ${BOX_MAC:-no machines}, web on $server"
busybox httpd -f -p "$PXE_HTTP_PORT" -h /srv/http &
exec dnsmasq --keep-in-foreground --log-facility=- --conf-dir=/etc/dnsmasq.d
