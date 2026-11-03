#!/usr/bin/env bash
# Builds the TV app as a Windows installer for #127 (docs/desktop.md):
#   bash tools/desktop/build-win.sh              # x64, into tools/desktop/out
#   ARCH=arm64 bash tools/desktop/build-win.sh
#
# Runs on Linux, macOS or Windows (Git Bash): electron-builder builds a Windows app from any of
# them. CI runs it on windows-latest (docs/ci-desktop-jobs.md), which is where the release's
# UltimateTV-Setup-x64.exe comes from.
#
# It needs an mpv for Windows to put inside the installer, and there isn't one in a checkout:
#   tools/desktop/vendor/mpv/mpv.exe
# plus the .dll files that came with it. `bash tools/desktop/fetch-mpv.sh win` puts them there from
# MPV_WIN_URL; "Bundling mpv" in docs/desktop.md says where the builds come from. Without it this
# script stops (ALLOW_NO_MPV=1 overrides, for the UI).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
stage="$here/stage"
arch="${ARCH:-x64}"
say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

case "$arch" in
  x64 | arm64) ;;
  *)
    printf 'ARCH must be x64 or arm64, not %s\n' "$arch" >&2
    exit 2
    ;;
esac

# The staging half, and the check that the Windows mpv the installer must carry is there. It leaves
# tools/desktop/stage ready for electron-builder.
bash "$here/stage-app.sh" win "The UltimateTV TV app for Windows"

say "Packaging the installer ($arch)"
cd "$here"
[ -x node_modules/.bin/electron-builder ] || npm ci --no-audit --no-fund
node_modules/.bin/electron-builder --config electron-builder.yml --win nsis zip "--$arch"

# Beside the installers, the same build description the app checks for updates, uploaded to the
# desktop-app release next to the AppImage and these files.
cp "$stage/build-info.json" "$here/out/ultimatetv-desktop.json"
# And this platform's own copy: if one desktop job fails while the others succeed, the shared file
# moves on and this platform's app would otherwise be told a newer build exists than there is.
cp "$stage/build-info.json" "$here/out/ultimatetv-windows.json"
ls -lh "$here"/out/*.exe "$here"/out/*.zip
say "Done: give these to a Windows PC: tools/desktop/out/UltimateTV-Setup-$arch.exe (or the zip)"
