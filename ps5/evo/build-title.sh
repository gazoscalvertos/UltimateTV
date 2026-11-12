#!/usr/bin/env bash
# Builds UltimateTV for the PlayStation 5 as an installable title: EVO Player's engine with the
# UltimateTV provider added (docs/ps5-architecture.md).
#
#   ps5/evo/build-title.sh --check          # compile-check the provider against EVO's real headers (no SDK)
#   ps5/evo/build-title.sh                  # clone EVO, add the provider, build the title (needs Docker)
#   EVO_REF=<tag-or-sha> ps5/evo/build-title.sh   # pin EVO; always do this for a release
#   UTV_HUB=http://host:8095 ps5/evo/build-title.sh   # the Hub the title starts with
#
# Output: ps5/build/evo/PPSA26001/ (the folder a mounter such as ShadowMount+ takes, for
# /data/homebrew/) and PPSA26001.ffpfsc. EVO is GPL-3.0-or-later and so is the result.
# NOT yet run against a real PS5: see docs/ps5-architecture.md, "What has and hasn't been tested".
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
EVO_REPO="${EVO_REPO:-https://github.com/sainsaji/EVO-PLAYER-PS5}"
EVO_REF="${EVO_REF:-main}"
TITLE_ID="${TITLE_ID:-PPSA26001}"
WORK="${WORK:-$REPO/ps5/build/evo-src}"
OUT="$REPO/ps5/build/evo"
RAW="https://raw.githubusercontent.com/sainsaji/EVO-PLAYER-PS5/$EVO_REF/projects/evoplayer/addons/include"

if [[ "${1:-}" == "--check" ]]; then
  # The provider only has to agree with EVO's headers and cJSON's, so those are all this fetches.
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  for h in evo_addon.h evo_provider.h evo_net.h; do curl -fsS "$RAW/$h" -o "$tmp/$h"; done
  curl -fsS https://raw.githubusercontent.com/DaveGamble/cJSON/v1.7.18/cJSON.h -o "$tmp/cJSON.h"
  gcc -std=gnu11 -Wall -Wextra -Werror -fsyntax-only -I"$tmp" "$HERE/provider_ultimatetv.c"
  echo "provider_ultimatetv.c compiles against EVO@$EVO_REF headers"
  exit 0
fi

command -v docker >/dev/null || { echo "Docker is needed: EVO builds inside its own pinned toolchain image." >&2; exit 1; }

rm -rf "$WORK"
git clone --quiet "$EVO_REPO" "$WORK"
git -C "$WORK" checkout --quiet "$EVO_REF"
SHA="$(git -C "$WORK" rev-parse HEAD)"
echo "EVO at $SHA"

P="$WORK/projects/evoplayer"
cp "$HERE/provider_ultimatetv.c" "$P/addons/src/provider_ultimatetv.c"
# The Hub the title starts with (the console can still be pointed elsewhere with ultimatetv.conf).
[[ -n "${UTV_HUB:-}" ]] && sed -i "s|#define UTV_DEFAULT_HUB \".*\"|#define UTV_DEFAULT_HUB \"$UTV_HUB\"|" "$P/addons/src/provider_ultimatetv.c"

# Register the provider. Each edit must land, or the build would quietly be plain EVO.
MGR="$P/addons/src/evo_provider_mgr.c"
grep -q 'extern const evo_provider_t evo_provider_jellyfin;' "$MGR" || { echo "EVO's provider table has changed shape: update build-title.sh" >&2; exit 1; }
sed -i 's|^extern const evo_provider_t evo_provider_jellyfin;|&\nextern const evo_provider_t evo_provider_ultimatetv;|' "$MGR"
sed -i 's|^    &evo_provider_jellyfin,|    \&evo_provider_ultimatetv,   /* UltimateTV: first, so it opens first */\n&|' "$MGR"
grep -q '&evo_provider_ultimatetv' "$MGR" || { echo "Couldn't add the provider to the table" >&2; exit 1; }

# Make sure the build picks the new file up (EVO's Makefile globs addons/src; if it ever lists files, say so).
if ! grep -Eq 'addons/src/\*\.c|wildcard' "$P/Makefile" 2>/dev/null; then
  echo "warning: EVO's Makefile doesn't glob addons/src; add provider_ultimatetv.c to its source list" >&2
fi

# Its own title, so it sits beside EVO Player instead of replacing it, and doesn't touch EVO's data.
PJ="$P/sce_sys/param.json"
python3 - "$PJ" "$TITLE_ID" <<'PY'
import json, sys
path, tid = sys.argv[1], sys.argv[2]
d = json.load(open(path))
d["titleId"] = tid
d["contentId"] = f"UP9000-{tid}_00-ULTIMATETV000000"
for k in ("titleName",):
    if k in d: d[k] = "UltimateTV"
for loc in d.get("localizedParameters", {}).values():
    if isinstance(loc, dict) and "titleName" in loc: loc["titleName"] = "UltimateTV"
json.dump(d, open(path, "w"), indent=2)
PY

(cd "$WORK" && docker compose build && docker compose run --rm ps5-dev ./scripts/package-app.sh --ffpfsc --zip)

rm -rf "$OUT"; mkdir -p "$OUT"
cp -r "$P/output/app/PPSA"*/. "$OUT/" 2>/dev/null || cp -r "$WORK/output/app/"* "$OUT/"
printf 'EVO %s (%s)\n' "$SHA" "$EVO_REF" > "$OUT/BUILT-FROM.txt"
echo "Built: $OUT"
echo "Install: copy the $TITLE_ID folder to /data/homebrew/ on the console and let ShadowMount+ register it (docs/ps5.md)."
