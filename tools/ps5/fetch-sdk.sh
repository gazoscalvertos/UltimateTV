#!/usr/bin/env bash
# Downloads the PS5 payload SDK and the prebuilt homebrew libraries into $1 and prints the two
# paths the ps5 Makefile wants, as PS5_PAYLOAD_SDK=... and PS5_DEVROOT=... lines (CI appends them
# to $GITHUB_ENV). Needs `gh` signed in (GH_TOKEN), because both are GitHub release assets.
#
# The asset names change between releases, so nothing here names a file: every asset of the
# latest release is downloaded and unpacked, and the folders are found by what is inside them.
set -euo pipefail
dest="${1:?usage: fetch-sdk.sh <folder>}"
mkdir -p "$dest/sdk-dl" "$dest/libs-dl"

unpack_all() {
  local dir="$1"
  for f in "$dir"/*; do
    case "$f" in
      *.zip) unzip -q -o "$f" -d "$dir/x" ;;
      *.tar.gz|*.tgz|*.tar.xz|*.tar.zst|*.tar) mkdir -p "$dir/x" && bsdtar -xf "$f" -C "$dir/x" ;;
      *.pkg.tar.*) mkdir -p "$dir/x" && bsdtar -xf "$f" -C "$dir/x" ;;
    esac
  done
}

echo "SDK release assets:" >&2
gh release view -R ps5-payload-dev/sdk --json tagName,assets -q '.tagName, (.assets[].name)' >&2
gh release download -R ps5-payload-dev/sdk -D "$dest/sdk-dl" --clobber
unpack_all "$dest/sdk-dl"

echo "Library release assets:" >&2
gh release view -R ps5-payload-dev/pacbrew-repo --json tagName,assets -q '.tagName, (.assets[].name)' >&2
gh release download -R ps5-payload-dev/pacbrew-repo -D "$dest/libs-dl" --clobber
unpack_all "$dest/libs-dl"
# A bundle of packages: each package is itself an archive, unpacked into one shared root.
find "$dest/libs-dl/x" -name '*.pkg.tar.*' -print0 2>/dev/null | while IFS= read -r -d '' p; do
  bsdtar -xf "$p" -C "$dest/libs-dl/x"
done

mk="$(find "$dest/sdk-dl" -path '*/toolchain/prospero.mk' -print -quit)"
[ -n "$mk" ] || { echo "no toolchain/prospero.mk in the SDK release" >&2; exit 1; }
sdk="$(dirname "$(dirname "$mk")")"

sdl="$(find "$dest/libs-dl" -name 'libSDL2.a' -path '*/homebrew/lib/*' -print -quit)"
[ -n "$sdl" ] || sdl="$(find "$dest/libs-dl" -name 'libSDL2.a' -print -quit)"
[ -n "$sdl" ] || { echo "no libSDL2.a in the library release" >&2; exit 1; }
devroot="$(dirname "$(dirname "$sdl")")"

echo "PS5_PAYLOAD_SDK=$sdk"
echo "PS5_DEVROOT=$devroot"
