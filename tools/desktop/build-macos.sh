#!/usr/bin/env bash
# Builds the TV app as a Mac disk image for #128 (docs/desktop.md):
#   bash tools/desktop/build-macos.sh            # this Mac's architecture, into tools/desktop/out
#   ARCH=x64 bash tools/desktop/build-macos.sh     # an Intel Mac's
#   ARCH=arm64 bash tools/desktop/build-macos.sh   # an Apple Silicon Mac's
#
# It has to run on a Mac: electron-builder builds a .app with Apple's own tooling (codesign, hdiutil),
# which only exists there. CI runs it on macos-latest (docs/ci-desktop-jobs.md, which builds both
# architectures), and that is where the release's .dmg files come from. On anything but macOS this
# script says so and stops rather than leaving a half-made app.
#
# It needs an mpv for the Mac to put inside the app, and there isn't one in a checkout:
#   tools/desktop/vendor/mpv/mpv        (ARCH=arm64 builds need an arm64 mpv)
# plus the .dylib files that came with it. `bash tools/desktop/fetch-mpv.sh mac` puts them there
# from MPV_MAC_URL; "Bundling mpv" in docs/desktop.md says where the builds come from and how to make
# one relocatable. Without it this script stops (ALLOW_NO_MPV=1 overrides, for the UI).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
stage="$here/stage"
# Default to the architecture of the Mac running it, which is what a local build wants.
host_arch() {
  case "$(uname -m)" in
    arm64 | aarch64) echo arm64 ;;
    *) echo x64 ;;
  esac
}
arch="${ARCH:-$(host_arch)}"
say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

case "$arch" in
  x64 | arm64) ;;
  *)
    printf 'ARCH must be x64 or arm64, not %s\n' "$arch" >&2
    exit 2
    ;;
esac

if [ "$(uname -s)" != "Darwin" ]; then
  cat >&2 <<'TEXT'
A Mac disk image has to be built on a Mac: electron-builder uses codesign and hdiutil, which Apple
only ships for macOS. CI builds it on macos-latest (docs/ci-desktop-jobs.md), and Downloads has the
result. On Linux or Windows you can still build the AppImage or the Windows installer.
TEXT
  exit 1
fi

# Each .dmg carries one architecture's app and mpv, so an Intel build must not pick up an Apple
# Silicon mpv or the other way round. Saying it here is cheaper than a Mac that opens and can't play.
if [ -f "$here/vendor/mpv/mpv" ] && [ "${ALLOW_ANY_MPV_ARCH:-0}" != "1" ]; then
  mpv_arch="$(file -b "$here/vendor/mpv/mpv" 2>/dev/null || echo unknown)"
  case "$mpv_arch:$arch" in
    *arm64*:arm64 | *x86_64*:x64) ;;
    *arm64*:x64)
      printf '\033[1;31m==>\033[0m vendor/mpv/mpv is %s but ARCH=%s\n' "$mpv_arch" "$arch" >&2
      exit 1
      ;;
    *x86_64*:arm64)
      printf '\033[1;31m==>\033[0m vendor/mpv/mpv is %s but ARCH=%s\n' "$mpv_arch" "$arch" >&2
      exit 1
      ;;
  esac
fi

# The staging half, and the check that the Mac mpv the app must carry is there.
bash "$here/stage-app.sh" mac "The UltimateTV TV app for Mac"

say "Packaging the disk image ($arch)"
cd "$here"
[ -x node_modules/.bin/electron-builder ] || npm ci --no-audit --no-fund
node_modules/.bin/electron-builder --config electron-builder.yml --mac dmg "--$arch"

cp "$stage/build-info.json" "$here/out/ultimatetv-desktop.json"
# And this platform's own copy: if one desktop job fails while the others succeed, the shared file
# moves on and this platform's app would otherwise be told a newer build exists than there is.
cp "$stage/build-info.json" "$here/out/ultimatetv-macos.json"
ls -lh "$here"/out/*.dmg
say "Done: tools/desktop/out/UltimateTV-$arch.dmg (unsigned: right-click it, then Open)"
