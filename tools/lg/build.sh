#!/usr/bin/env bash
# Packs the LG TV app (lg/) into UltimateTV.ipk, the format webOS installs. Uses LG's ares-package
# when it is installed (npm i -g @webos-tools/cli), otherwise builds the same package by hand:
# an .ipk is an `ar` archive of debian-binary, control.tar.gz and data.tar.gz. Output: lg/build/
# See docs/lg.md.
set -euo pipefail
here="$(cd "$(dirname "$0")/../.." && pwd)"
out="$here/lg/build"
mkdir -p "$out"
rm -f "$out"/*.ipk
cd "$here"
# Same check CI runs: older sets run Chromium 53, so nothing newer may sneak in.
if command -v npx >/dev/null 2>&1 && [ -d "$here/node_modules/esbuild" ]; then
  npx esbuild lg/js/*.js lg/boot.js --target=chrome53 --outdir=/tmp/utv-lg-check --log-level=error >/dev/null
fi
if command -v ares-package >/dev/null 2>&1; then
  ares-package --outdir "$out" lg/ --no-minify
else
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  id="home.ultimatetv.lg"; ver="0.1.0"
  mkdir -p "$tmp/data/usr/palm/applications/$id" "$tmp/control"
  (cd lg && cp -r appinfo.json index.html boot.js icon.png css js "$tmp/data/usr/palm/applications/$id/")
  printf 'Package: %s\nVersion: %s\nSection: misc\nPriority: optional\nArchitecture: all\nInstalled-Size: 1\nMaintainer: UltimateTV <noreply@example.invalid>\nDescription: UltimateTV\nwebOS-Package-Format-Version: 2\nwebOS-Packager-Version: 1.2.2\n' "$id" "$ver" > "$tmp/control/control"
  printf '#!/bin/sh\nexit 0\n' > "$tmp/control/postinst"; cp "$tmp/control/postinst" "$tmp/control/prerm"; chmod +x "$tmp/control/"*
  printf '2.0\n' > "$tmp/debian-binary"
  (cd "$tmp/control" && tar --owner=0 --group=0 -czf "$tmp/control.tar.gz" .)
  (cd "$tmp/data" && tar --owner=0 --group=0 -czf "$tmp/data.tar.gz" .)
  (cd "$tmp" && ar rc "$out/${id}_${ver}_all.ipk" debian-binary control.tar.gz data.tar.gz)
fi
ls -1 "$out"/*.ipk | sed 's/^/Built /'
