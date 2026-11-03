#!/usr/bin/env bash
# shellcheck shell=bash
# The staging half of the Windows and Mac desktop builds (#127, #128): the box shell bundled into
# one file with esbuild, the offline page, build-info.json (what the app reports in Settings › About
# and compares for updates) and a package.json for electron-builder.
#
# Run by build-win.sh and build-macos.sh rather than sourced, so each of them stays a plain script
# that shellcheck can read on its own:
#
#   bash tools/desktop/stage-app.sh win "The UltimateTV TV app for Windows"
#   bash tools/desktop/stage-app.sh mac "The UltimateTV TV app for Mac"
#
# It checks first that the mpv this platform's installer has to carry is there, then stages
# tools/desktop/stage and stops. build-appimage.sh predates this file and keeps its own copy of the
# same steps on purpose, so the Linux build that works today is not disturbed by this work.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
stage="$here/stage"
which="${1:-}"
description="${2:-The UltimateTV TV app for a desktop}"
say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

case "$which" in
  win)
    binary="mpv.exe"
    what="Windows mpv"
    ;;
  mac)
    binary="mpv"
    what="macOS mpv"
    ;;
  *)
    printf 'usage: bash tools/desktop/stage-app.sh win|mac ["description"]\n' >&2
    exit 2
    ;;
esac

# mpv is spawned as a separate program (box/src/mpv.ts), and neither Windows nor macOS ships one in
# a place the app can count on, so the installer has to carry it: tools/desktop/vendor/mpv is copied
# to <resources>/mpv by extraResources in electron-builder.yml, and box/src/platform.ts looks for it
# there first. Missing it is a hard error rather than an app that opens and cannot play
# (docs/desktop.md, "Bundling mpv", says where the binaries come from).
#
# ALLOW_NO_MPV=1 stages anyway, for trying the UI: playback then expects an mpv on PATH.
mpv="$here/vendor/mpv/$binary"
if [ -f "$mpv" ]; then
  say "mpv: $mpv ($(du -h "$mpv" | cut -f1))"
elif [ "${ALLOW_NO_MPV:-0}" = "1" ]; then
  say "No mpv at $mpv: staging anyway (ALLOW_NO_MPV=1), playback will need one on PATH"
else
  printf '\033[1;31m==>\033[0m No %s at %s\n' "$what" "$mpv" >&2
  cat >&2 <<TEXT

The installer has to carry mpv, or the TV app has nothing to play through. Put the $what build at:

    $mpv

and run this again. docs/desktop.md, "Bundling mpv", says where the builds come from and what the
app does without one. ALLOW_NO_MPV=1 stages without it, for looking at the UI only.
TEXT
  exit 1
fi

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
# What the app runs, for Settings › About and its update check (box/src/desktop-app-updates.ts).
printf '{"commit":"%s","date":"%s","branch":"%s"}\n' "$commit" "$date" "$branch" >"$stage/build-info.json"

# The version here is what Add/Remove Programs and Finder show: electron-builder reads it.
cat >"$stage/package.json" <<JSON
{
  "name": "ultimatetv",
  "productName": "UltimateTV",
  "version": "$version",
  "description": "$description",
  "author": "UltimateTV",
  "homepage": "https://github.com/gazoscalvertos/UltimateTV",
  "license": "UNLICENSED",
  "main": "dist/main.js"
}
JSON

say "Ready for electron-builder"
