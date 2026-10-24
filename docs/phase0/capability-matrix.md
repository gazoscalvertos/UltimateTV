# Capability matrix: Hisense 85U7STUK

First probe run: 2026-10-24, from the VIDAA **Browser** (bookmark), probe build `d79f705`.
The raw report is reproduced at the end. This page records what it means for the app.

## Summary

| Area | Finding | Decision |
|------|---------|----------|
| Browser engine | Chromium **111** (WebLayer 7), aarch64, Mali-G57 GPU with WebGL 2 | Much newer than feared. ES2020 and modern CSS are fine. Keep ES2017 as a safety margin, since other VIDAA firmware may be older. |
| UI resolution | Viewport **1280×720** CSS px at 1.5× (1920×1080 physical) | Design the UI on a 1280×720 grid. Artwork is served at 1.5× (e.g. 1920 px wide heroes). Video is decoded separately and isn't limited to this resolution. |
| UI smoothness | 59 fps for a simple animation | Good. Confirms a GPU-rendered UI (Lightning) is viable. Re-measure with a real guide grid in Phase 1. |
| HDR signalling | `(dynamic-range: high)` = yes | The page can tell the display is HDR-capable. |
| Service workers | Not available | No offline shell. The Hub serves the app over the LAN, which is fine. |
| DRM (EME) | None in the browser | Not needed (IPTV, Jellyfin and debrid are DRM-free). Check again from an installed app. |

## Video

| Format | Browser says | Clip test | Decision |
|--------|--------------|-----------|----------|
| H.264 (MP4) | Yes | 1080p25 played, smooth | Direct play. |
| H.264 in MPEG-TS | Not via MediaSource, but `canPlayType` yes | 1080i50 `.ts` played, smooth (no combing reported) | Live IPTV: use HLS via hls.js, which repackages TS in the browser. Direct `.ts` playback is the fallback. |
| HEVC Main10 (MP4) | Yes | – | Direct play. |
| HEVC in MKV | MediaSource and `canPlayType` both say no | 4K 23.976p and 50p MKV **played** | The `<video>` element plays MKV files directly even though the type checks say no. Treat MKV as "plays by URL, not via MediaSource": progressive file playback is fine, but adaptive streaming needs fMP4/HLS. |
| Dolby Vision P5 / P7 / P8.1 | All yes (MP4 type strings) | Not yet tested | Promising, and contradicts older community reports. Test with real DV samples (MP4 and MKV) before trusting it. |
| AV1 10-bit | Yes | Not yet tested | Promising. If the clip plays, AV1 doesn't need converting, which removes the need for the N150 to transcode it. |
| VP9 Profile 2 (WebM) | No | – | Rare in our sources. Convert if ever needed. |

## HDR

| Clip | Result | Open question |
|------|--------|---------------|
| HDR10 HEVC 4K (MKV) | Played, **badge "none"** | Either the browser player outputs HDR without the TV showing a badge, or it tone-maps to SDR. Check with the TV's own info overlay or picture settings during playback (the HDR picture modes only appear when HDR is active). |
| HDR10 (MP4), HLG | Not yet tested | Same check. |

## Audio

| Format | Browser says | Clip test | Decision |
|--------|--------------|-----------|----------|
| AAC, AC-3, E-AC-3 (DD+), FLAC, Opus | Yes | Audio answers were "unsure" | Direct play. Re-test with the audio clips and listen for each channel's tone. |
| DTS core / DTS:X | Yes | Not yet tested | Test the DTS clip. If it plays, the Hub doesn't need to convert DTS. |
| TrueHD, DTS-HD MA | No | Not yet tested | The Hub converts to E-AC-3 (as planned). |

## Remote keys (browser)

| Key | In the browser | VIDAA guide code for installed apps |
|-----|----------------|-------------------------------------|
| OK | Pointer click only | 13 |
| Arrows | Not received (they move the pointer) | 37–40 |
| Back | Browser history back only | 8 |
| Red / Green / Yellow / Blue | **403 / 404 / 405 / 406** | 403–406 |
| Digits | **48–57** | 48–57 |
| Info | **457** (reaches the page) | Guide says reserved |
| Guide | Taken by the TV (opens the TV guide, closes the page) | Not listed |
| Channel ±, Play, Pause, Play/Pause, Stop, Rewind, Fast forward | Not received | 427/428, 415, 19, 463, 413, 412, 417 |

Decision: the browser can't drive a D-pad app, so the app **must be installed** to get the arrows, OK, Back and media keys. `hisense://debug` is blocked on this firmware. The next test is the community vidaa-edge route. In every mode, colour keys and digits already arrive, so Green = TV guide and number tuning work. Info (457) can open the programme info panel.

## Still to test

1. Install via vidaa-edge, then re-run the key wizard from the installed app.
2. The remaining clips: HDR10 MP4, HLG, AV1, and the audio clips (E-AC-3, AC-3, DTS, TrueHD, FLAC). Answer the audio question by listening for the different tone on each speaker.
3. Real Dolby Vision samples: P8 in MKV and MP4, and a P7 remux.
4. A way to confirm HDR output (the TV's info overlay or picture mode list).
5. The Quick Sync checks, once the Proxmox host runs the 6.14 kernel.
6. IPTV catch-up (`docs/phase0/iptv-catchup.md`).

## Raw report

```
Chromium 111.0.0.0 · Screen 1920×1080 @ 1.5x · Viewport 1280×720 · WebGL 2 (Mali-G57) · 59 fps
UA: Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Weblayer/7.0.10 Safari/537.36
(dynamic-range: high) yes · (video-dynamic-range: high) no · color-gamut p3/rec2020 no
Service worker no · localStorage yes · IndexedDB yes · MSE yes · EME no · PiP yes · Workers yes · WASM yes · backdrop-filter yes

Codec                         MSE  canPlayType
H.264 High 5.1 (MP4)          Yes  Yes
H.264 High (MPEG-TS)          No   Yes
HEVC Main10 (hvc1, MP4)       Yes  Yes
HEVC Main10 (hev1, MP4)       Yes  Yes
HEVC Main10 (MKV)             No   No
Dolby Vision P5 / P7 / P8.1   Yes  Yes
AV1 Main 10-bit L5.1          Yes  Yes
VP9 Profile 2 HDR (WebM)      No   No
AAC / AC-3 / E-AC-3           Yes  Yes
Dolby TrueHD                  No   No
DTS core                      Yes  Yes
DTS-HD MA                     No   No
DTS:X                         Yes  Yes
FLAC / Opus                   Yes  Yes
HLS (native)                  No   Maybe
DRM: Widevine, PlayReady, PlayReady recommendation, ClearKey: all No

Clips played: h264-1080i25-ac3.ts, h264-1080p25-aac.mp4, hevc-2160p23976-eac3.mkv,
hevc-2160p50.mkv, hdr10-hevc-2160p-mkv.mkv. All played and looked smooth, HDR badge "none", audio "unsure".
Dropped-frame counts weren't reported by the browser.
```
