#!/usr/bin/env bash
# shellcheck shell=bash
# Puts an mpv into tools/desktop/vendor/mpv, which is what Windows and macOS need: the app spawns
# mpv as a separate program (box/src/mpv.ts) and neither platform has one it can count on, so the
# installer has to carry it. electron-builder copies vendor/mpv into <resources>/mpv inside the
# installed app (extraResources in tools/desktop/electron-builder.yml), and box/src/platform.ts's
# mpvBinary() looks there before it looks on PATH.
#
# Where the binary comes from is the owner's call, not this script's: mpv's own Windows builds are
# published by shinchiro (github.com/shinchiro/mpv-winbuild-cmake/releases) and there is no
# equivalent official macOS binary, so the two URLs are repository variables rather than something
# invented here:
#
#   MPV_WIN_URL   a .zip of a Windows build (mpv.exe and its .dll files at the top of the archive)
#   MPV_MAC_URL   a .zip or .tar.xz of a macOS build (mpv and its .dylib files at the top)
#
# Setting them as GitHub repository variables and running this in CI is what docs/ci-desktop-jobs.md
# does. Locally:
#
#   MPV_WIN_URL=https://…/mpv-x86_64.zip bash tools/desktop/fetch-mpv.sh win
#   MPV_MAC_URL=https://…/mpv-arm64.tar.xz bash tools/desktop/fetch-mpv.sh mac
#
# A .7z (what shinchiro publishes) has to be unpacked with `7z x` first and its contents put in
# vendor/mpv by hand, because 7-Zip isn't something this script can assume.
#
# Nothing in vendor/mpv is committed (tools/desktop/vendor/.gitignore): the binaries are tens of
# megabytes and belong to other projects. docs/desktop.md, "Bundling mpv", says what each platform's
# folder must contain and what the app does when it's missing.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
fail() {
  printf '\033[1;31m==>\033[0m %s\n' "$*" >&2
  exit 1
}

which="${1:-}"
case "$which" in
  win | mac) ;;
  *)
    printf 'usage: bash tools/desktop/fetch-mpv.sh win|mac\n' >&2
    exit 2
    ;;
esac

dest="$here/vendor/mpv"

case "$which" in
  win)
    url="${MPV_WIN_URL:-}"
    binary="mpv.exe"
    ;;
  mac)
    url="${MPV_MAC_URL:-}"
    binary="mpv"
    ;;
esac

if [ -z "$url" ]; then
  cat >&2 <<TEXT
No URL set. Download an mpv build for this platform and point this script at it, or put its files
in $dest by hand. The folder needs:

  $( [ "$which" = "win" ] && echo 'mpv.exe, plus every .dll that came with it (libmpv-2.dll, the codec and font libraries)' || echo 'mpv, plus every .dylib that came with it (libmpv.2.dylib and the libraries ffmpeg and libass need)' )

For Windows, shinchiro's builds (github.com/shinchiro/mpv-winbuild-cmake/releases) are the usual
source; unpack the .7z and copy its contents in. For macOS there is no official binary: a build from
a package manager has its libraries in paths that only exist on the machine that built it, so a
copy has to be relocatable (its install names rewritten to @executable_path) before it will run
inside the .app. docs/desktop.md, "Bundling mpv", walks through it.

Then run this again with MPV_WIN_URL or MPV_MAC_URL set, or build with ALLOW_NO_MPV=1 to look at
the interface only (playback then needs an mpv on PATH).
TEXT
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
file="$work/build"
say "Fetching $url"
curl -fsSL --retry 3 -o "$file" "$url" || fail "Couldn't download $url"

# 7-Zip opens all three and is what a Windows runner has; unzip and tar cover the rest.
if command -v 7z >/dev/null 2>&1; then
  7z x -y -o"$work/unpacked" "$file" >/dev/null || fail "$url isn't an archive 7z can read"
else
  case "$url" in
    *.zip)
      command -v unzip >/dev/null 2>&1 || fail "This needs unzip or 7z to open $url"
      unzip -q "$file" -d "$work/unpacked" || fail "$url isn't a zip this can read"
      ;;
    *.tar.xz)
      tar xJf "$file" -C "$work" --one-top-level=unpacked || fail "$url isn't a tar.xz this can read"
      ;;
    *.tar.gz | *.tgz)
      tar xzf "$file" -C "$work" --one-top-level=unpacked || fail "$url isn't a tar.gz this can read"
      ;;
    *)
      fail "Don't know how to unpack $url: give it a .zip, .tar.xz or .tar.gz, or unpack it by hand"
      ;;
  esac
fi

# A build is often one folder inside the archive; find the one holding the binary rather than
# assuming a depth.
found="$(find "$work/unpacked" -type f -name "$binary" -print -quit)"
[ -n "$found" ] || fail "No $binary anywhere in $url: is this a build for this platform?"
root="$(dirname "$found")"

mkdir -p "$dest"
say "Copying $(find "$root" -maxdepth 1 -type f | wc -l | tr -d ' ') file(s) into $dest"
# The binary and the libraries beside it, and nothing nested: that is what extraResources copies
# and what mpv looks next to itself for.
find "$root" -maxdepth 1 -type f -exec cp {} "$dest/" \;

if [ "$which" = "mac" ]; then
  # An .app runs the binary from inside the bundle, so a library addressed by its build path won't
  # be found. Saying so now is cheaper than a Mac that opens and can't play.
  if command -v otool >/dev/null 2>&1; then
    if otool -L "$dest/$binary" | grep -qE '/(opt/homebrew|usr/local)/'; then
      printf '\033[1;31m==>\033[0m %s\n' "$dest/$binary still points at libraries outside the app:" >&2
      otool -L "$dest/$binary" | grep -E '/(opt/homebrew|usr/local)/' >&2
      cat >&2 <<'TEXT'
That build is addressed for the machine it was installed on. Either use a build made to be moved,
or rewrite the paths (install_name_tool -change … @executable_path/…) and put each library in the
same folder. docs/desktop.md, "Bundling mpv", has the loop.
TEXT
      exit 1
    fi
  fi
fi

say "Done: $dest has $binary ($(file -b "$dest/$binary" 2>/dev/null || echo "a binary"))"
if [ "$which" = "win" ]; then say "Now: bash tools/desktop/build-win.sh"; else say "Now: bash tools/desktop/build-macos.sh   (on a Mac)"; fi
