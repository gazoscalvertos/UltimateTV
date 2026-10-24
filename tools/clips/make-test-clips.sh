#!/usr/bin/env bash
# Generates synthetic test clips for the Phase 0 probe, plus a clips.json manifest.
# Usage: make-test-clips.sh [output-dir] [seconds]
# Dolby Vision and HDR10+ can't be synthesised with plain ffmpeg; add real sample files
# for those by hand (see docs/phase0/test-clips.md).
set -euo pipefail

OUT="${1:-${CLIPS_DIR:-/media/test-clips}}"
SECS="${2:-20}"
mkdir -p "$OUT"
ENCODERS="$(ffmpeg -hide_banner -encoders 2>/dev/null)"
MANIFEST=()

has_encoder() { grep -qE "^ [A-Z.]{6} $1 " <<<"$ENCODERS"; }

# Moving pattern with a clock, so judder and dropped frames are easy to see.
video_src() { # size rate
  echo "testsrc2=size=$1:rate=$2,drawtext=text='%{pts\\:hms}':fontsize=96:fontcolor=white:x=60:y=60:box=1:boxcolor=black@0.6"
}
# 5.1 or stereo tones, one pitch per channel, so a silent speaker is obvious.
audio_src() { # channels
  if [[ "$1" == 6 ]]; then
    echo "sine=f=220:d=$SECS[a0];sine=f=330:d=$SECS[a1];sine=f=440:d=$SECS[a2];sine=f=60:d=$SECS[a3];sine=f=550:d=$SECS[a4];sine=f=660:d=$SECS[a5];[a0][a1][a2][a3][a4][a5]join=inputs=6:channel_layout=5.1"
  else
    echo "sine=f=440:d=$SECS,pan=stereo|c0=c0|c1=c0"
  fi
}

make_clip() { # file title tests channels -- ffmpeg output args...
  local file="$1" title="$2" tests="$3" channels="$4" size="$5" rate="$6"
  shift 6
  if [[ -f "$OUT/$file" ]]; then
    echo "exists  $file"
  else
    echo "making  $file"
    if ! ffmpeg -hide_banner -loglevel error -y \
      -f lavfi -i "$(video_src "$size" "$rate")" \
      -filter_complex "$(audio_src "$channels")" \
      -t "$SECS" "$@" "$OUT/$file"; then
      echo "failed  $file (skipped)"
      rm -f "$OUT/$file"
      return 0
    fi
  fi
  MANIFEST+=("{\"file\":\"$file\",\"title\":\"$title\",\"tests\":\"$tests\"}")
}

HDR10_X265="hdr-opt=1:repeat-headers=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400"
HLG_X265="repeat-headers=1:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc"

# Broadcast-style SD/HD baseline
make_clip h264-1080p25-aac.mp4 "H.264 1080p25, AAC stereo" "Baseline UK broadcast frame rate" 2 1920x1080 25 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 192k
make_clip h264-1080i25-ac3.ts "H.264 1080i50, AC-3 5.1 (MPEG-TS)" "Interlaced UK IPTV, deinterlacing" 6 1920x1080 25 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -flags +ildct+ilme -x264opts tff=1 -c:a ac3 -b:a 448k -f mpegts

# Frame-rate switching
make_clip hevc-2160p23976-eac3.mkv "HEVC 4K 23.976p, E-AC-3 5.1" "Film frame rate, does the TV switch to 24p?" 6 3840x2160 24000/1001 \
  -c:v libx265 -preset ultrafast -pix_fmt yuv420p10le -x265-params log-level=error -c:a eac3 -b:a 640k
make_clip hevc-2160p50.mkv "HEVC 4K 50p" "UK live sport frame rate" 2 3840x2160 50 \
  -c:v libx265 -preset ultrafast -pix_fmt yuv420p10le -x265-params log-level=error -c:a aac -b:a 192k

# HDR formats
make_clip hdr10-hevc-2160p-mkv.mkv "HDR10 HEVC 4K (MKV)" "HDR10 badge from the browser player" 6 3840x2160 24000/1001 \
  -c:v libx265 -preset ultrafast -pix_fmt yuv420p10le -x265-params "log-level=error:$HDR10_X265" -c:a eac3 -b:a 640k
make_clip hdr10-hevc-2160p-mp4.mp4 "HDR10 HEVC 4K (MP4, hvc1)" "Same as above in MP4" 6 3840x2160 24000/1001 \
  -c:v libx265 -preset ultrafast -pix_fmt yuv420p10le -tag:v hvc1 -x265-params "log-level=error:$HDR10_X265" -c:a eac3 -b:a 640k
make_clip hlg-hevc-2160p50.mkv "HLG HEVC 4K 50p" "HLG badge, BBC-style UHD sport" 2 3840x2160 50 \
  -c:v libx265 -preset ultrafast -pix_fmt yuv420p10le -x265-params "log-level=error:$HLG_X265" -c:a aac -b:a 192k

# AV1 (expected to fail in the browser; tells us how often the Hub must convert)
if has_encoder libsvtav1; then
  SVT_LOG=1 make_clip av1-2160p-10bit.mkv "AV1 4K 10-bit" "AV1 in the browser (expected to fail)" 2 3840x2160 24000/1001 \
    -c:v libsvtav1 -preset 12 -pix_fmt yuv420p10le -c:a aac -b:a 192k
elif has_encoder libaom-av1; then
  make_clip av1-1080p-10bit.mkv "AV1 1080p 10-bit" "AV1 in the browser (expected to fail)" 2 1920x1080 24000/1001 \
    -c:v libaom-av1 -cpu-used 8 -row-mt 1 -pix_fmt yuv420p10le -c:a aac -b:a 192k
fi

# Audio formats (1080p H.264 video so only the audio varies)
make_clip audio-eac3-51.mkv "E-AC-3 5.1 (Dolby Digital Plus)" "DD+ through TV speakers" 6 1920x1080 25 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a eac3 -b:a 640k
make_clip audio-ac3-51.mkv "AC-3 5.1 (Dolby Digital)" "Dolby Digital decode" 6 1920x1080 25 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a ac3 -b:a 448k
make_clip audio-dts-51.mkv "DTS 5.1" "Does the TV play DTS at all?" 6 1920x1080 25 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a dca -strict -2 -b:a 1509k
make_clip audio-truehd-51.mkv "Dolby TrueHD 5.1" "TrueHD (expected to fail)" 6 1920x1080 25 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a truehd -strict -2
make_clip audio-flac-51.mkv "FLAC 5.1" "Lossless PCM-style audio" 6 1920x1080 25 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a flac

# Write the manifest, keeping any real samples (e.g. Dolby Vision) already listed by hand.
python3 - "$OUT/clips.json" "${MANIFEST[@]}" <<'PY'
import json, sys
path, generated = sys.argv[1], [json.loads(x) for x in sys.argv[2:]]
try:
    existing = json.load(open(path))
except Exception:
    existing = []
names = {e["file"] for e in generated}
merged = generated + [e for e in existing if e.get("file") not in names]
json.dump(merged, open(path, "w"), indent=2)
print(f"wrote {path} ({len(merged)} clips)")
PY
