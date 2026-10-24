#!/usr/bin/env bash
# Writes the boot menu and the install settings from the environment, then serves them:
# proxy DHCP and TFTP with dnsmasq, and HTTP with busybox.

set -euo pipefail

: "${PXE_IP:?set PXE_IP to the LAN address of this machine}"
: "${LAN_SUBNET:?set LAN_SUBNET, e.g. 192.168.0.0}"
PXE_HTTP_PORT="${PXE_HTTP_PORT:-8097}"
ARCH_MIRROR="${ARCH_MIRROR:-https://geo.mirror.pkgbuild.com}"
ARCH_MIRROR="${ARCH_MIRROR%/}"
server="http://$PXE_IP:$PXE_HTTP_PORT"

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
  for v in HUB_URL BRANCH BOX_HOSTNAME TIMEZONE KEYMAP LOCALE ADMIN_USER ADMIN_PASSWORD_HASH ADMIN_SSH_KEY TARGET_DISK ARCH_MIRROR; do
    printf '%s=%q\n' "$v" "${!v:-}"
  done
  printf 'REPO_URL=%q\n' "${REPO_URL:-https://github.com/gazoscalvertos/UltimateTV.git}"
} > /srv/http/box.conf

cat > /etc/dnsmasq.d/ultimatetv.conf <<EOF
# Proxy DHCP: the router still gives out addresses; we only add where to boot from.
port=0
dhcp-range=$LAN_SUBNET,proxy
pxe-service=x86-64_EFI,"UltimateTV",ipxe
pxe-service=BC_EFI,"UltimateTV",ipxe
enable-tftp
tftp-root=/srv/tftp
log-dhcp
EOF

echo "UltimateTV PXE server: menu for ${BOX_MAC:-no machines}, web on $server"
busybox httpd -f -p "$PXE_HTTP_PORT" -h /srv/http &
exec dnsmasq --keep-in-foreground --log-facility=- --conf-dir=/etc/dnsmasq.d
