#!/usr/bin/env bash
# Builds the TV app as an AppImage for Linux desktops (docs/desktop.md):
#
#   bash tools/desktop/build-appimage.sh            # x64, into tools/desktop/out
#   ARCH=arm64 bash tools/desktop/build-appimage.sh
#
# The box shell (box/) is bundled into one file with esbuild, so electron-builder packages a plain
# folder with no workspace links or node_modules. mpv isn't bundled: the computer's own mpv plays,
# with its own GPU drivers (see the doc for why).

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
stage="$here/stage"
arch="${ARCH:-x64}"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

cd "$root"
if [ ! -d node_modules/esbuild ]; then
  say "Installing the repo's packages"
  ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-audit --no-fund
fi
say "Building the box app"
npm run build -w shared >/dev/null
npx tsc -b box

say "Staging it in $stage"
rm -rf "$stage" "$here/out"
mkdir -p "$stage/dist"
npx esbuild box/dist/main.js --bundle --platform=node --target=node22 --format=cjs --external:electron \
  --outfile="$stage/dist/main.js" --log-level=warning
# The preloads only use electron, which the sandbox provides.
cp box/dist/preload.js box/dist/webapp-preload.js "$stage/dist/"
cp -r box/offline "$stage/offline"
version="$(node -p 'require("./box/package.json").version')"
commit="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
date="$(git log -1 --format=%cI 2>/dev/null || date -u +%FT%TZ)"
branch="${BRANCH:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)}"
# What the app runs, for Settings › About and its update check (box/src/appimage-updates.ts).
printf '{"commit":"%s","date":"%s","branch":"%s"}\n' "$commit" "$date" "$branch" >"$stage/build-info.json"
cat >"$stage/package.json" <<JSON
{
  "name": "ultimatetv",
  "productName": "UltimateTV",
  "version": "$version",
  "description": "The UltimateTV TV app for Linux desktops",
  "author": "UltimateTV",
  "homepage": "https://github.com/gazoscalvertos/UltimateTV",
  "license": "UNLICENSED",
  "main": "dist/main.js",
  "desktopName": "ultimatetv.desktop"
}
JSON

say "Packaging the AppImage ($arch)"
cd "$here"
[ -x node_modules/.bin/electron-builder ] || npm ci --no-audit --no-fund
node_modules/.bin/electron-builder --config electron-builder.yml --linux AppImage "--$arch"
# Beside it, the same build description the app checks for updates.
cp "$stage/build-info.json" "$here/out/ultimatetv-desktop.json"
ls -lh "$here"/out/*.AppImage
