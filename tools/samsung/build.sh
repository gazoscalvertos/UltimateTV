#!/usr/bin/env bash
# Packs the Samsung TV app (samsung/) into an UNSIGNED UltimateTV.wgt, the format Tizen installs.
# The TV only accepts a package signed with your own Samsung certificate, which Tizen Studio (or
# Apps2Samsung) adds when you install it: see docs/samsung.md. Output: samsung/build/UltimateTV.wgt
set -euo pipefail
here="$(cd "$(dirname "$0")/../.." && pwd)"
out="$here/samsung/build"
mkdir -p "$out"
rm -f "$out/UltimateTV.wgt"
cd "$here/samsung"
# Same check CI runs: the 2018 sets run Chromium 56, so nothing newer may sneak in.
if command -v npx >/dev/null 2>&1 && [ -d "$here/node_modules/esbuild" ]; then
  (cd "$here" && npx esbuild samsung/js/*.js --target=chrome56 --outdir=/tmp/utv-samsung-check --log-level=error >/dev/null)
fi
zip -qr "$out/UltimateTV.wgt" config.xml index.html icon.png css js
echo "Built $out/UltimateTV.wgt ($(du -h "$out/UltimateTV.wgt" | cut -f1))"
