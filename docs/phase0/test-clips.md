# Test clips

The probe plays every video file in the test-clips folder (`./test-clips` next to `docker-compose.yml`, which is `/clips` inside the Hub). `clips.json` in the same folder gives each file a friendly title and says what it tests, and sets the order.

## Generated clips

`make-test-clips` (inside the Hub container, or `tools/clips/make-test-clips.sh <dir> [seconds]` anywhere with ffmpeg) creates these. Each one has a moving test pattern with a running clock, so judder and dropped frames are easy to see, and a different tone on each audio channel, so a silent speaker is obvious.

| File | What it tests |
|------|---------------|
| `h264-1080p25-aac.mp4` | Baseline: UK broadcast frame rate |
| `h264-1080i25-ac3.ts` | Interlaced 1080i50 in MPEG-TS, like most UK IPTV. Look for combing on moving edges. |
| `hevc-2160p23976-eac3.mkv` | 4K film frame rate. Does the TV switch to 24p, or judder? |
| `hevc-2160p50.mkv` | 4K 50p, like UHD sport |
| `hdr10-hevc-2160p-mkv.mkv` | HDR10 in MKV. Does the TV show its HDR badge? |
| `hdr10-hevc-2160p-mp4.mp4` | The same in MP4 |
| `hlg-hevc-2160p50.mkv` | HLG, like BBC UHD |
| `av1-2160p-10bit.mkv` | AV1 10-bit. Expected to fail in the browser. |
| `audio-eac3-51.mkv` | Dolby Digital Plus 5.1 |
| `audio-ac3-51.mkv` | Dolby Digital 5.1 |
| `audio-dts-51.mkv` | DTS 5.1. Does this TV play DTS at all? |
| `audio-truehd-51.mkv` | TrueHD. Expected to fail. |
| `audio-flac-51.mkv` | FLAC 5.1 |

## Real samples to add by hand

ffmpeg can't create Dolby Vision or HDR10+ metadata. Copy short real samples (30–60 s cuts are enough) from your own library into the folder, then add them to `clips.json`. Useful ones:

| Suggested file name | What it tests | Where to get one |
|---------------------|---------------|------------------|
| `dv-p8-mkv.mkv` | Dolby Vision Profile 8.1 in MKV (most streaming-service DV) | A web-sourced DV file from your library |
| `dv-p8-mp4.mp4` | The same in MP4. Expected to crash the browser, which confirms the remux rule. | Remux the MKV: `ffmpeg -i dv-p8-mkv.mkv -c copy -tag:v dvh1 -strict unofficial dv-p8-mp4.mp4` |
| `dv-p5-mkv.mkv` | Dolby Vision Profile 5 | A web-sourced DV file without an HDR10 fallback |
| `dv-p7-fel.mkv` | Dolby Vision Profile 7 (UHD Blu-ray remux) | A Blu-ray remux from your library |
| `hdr10plus.mkv` | HDR10+ dynamic metadata | An HDR10+ title from your library |
| `atmos-eac3.mkv` | Dolby Atmos in DD+ (listen for height effects) | A streaming-sourced Atmos title |

Cut a sample without re-encoding: `ffmpeg -ss 00:10:00 -i input.mkv -t 60 -map 0:v:0 -map 0:a:0 -c copy sample.mkv`.

Example `clips.json` entry:

```json
{ "file": "dv-p8-mkv.mkv", "title": "Dolby Vision P8 (MKV)", "tests": "Dolby Vision badge from the browser player" }
```

Running `make-test-clips` again keeps entries you added by hand.
