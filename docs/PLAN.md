# UltimateTV: Product & Technical Plan

> Status: **Draft v1** (2026-10-24). This is a plan, not code yet.
> Target hardware: **Hisense 85" 85U7STUK** (2026 U7 Mini-LED, VIDAA OS).
> North star: **the best picture and sound the TV can produce, wrapped in a UI that passes the Wife Acceptance Factor (WAF).**

---

## 1. Goals

| # | Goal | What "done" looks like |
|---|------|------------------------|
| G1 | One app for everything | Live IPTV, Xtream, VOD, Jellyfin, AIOStreams/TorBox and NAS files all live in one home screen and one search. |
| G2 | Sky-grade TV guide | A fast EPG grid with live preview, now/next banner and one-press **Record series**. Recordings appear in a planner. |
| G3 | WAF | Someone who has never seen it can turn the TV on, find a show and press play with only the arrow keys, OK and Back. No settings screens, no codec talk, no "pick a stream" lists by default. |
| G4 | Reference picture & sound | Native Dolby Vision / HDR10+ / HLG, correct frame rate (24p stays 24p), and Dolby Atmos (incl. TrueHD/DD+ JOC) passthrough wherever the hardware allows. |
| G5 | Own your library | Anything downloaded (TorBox, recordings) lands on the local NAS and shows up in Jellyfin automatically. |

**Out of scope for v1:** multi-user profiles with parental PINs (v2), mobile apps (a companion web remote is in Phase 4), casting.

---

## 2. VIDAA research: limitations and workarounds

### 2.1 The TV

85U7STUK (2026 U7 range) highlights, from retailer listings and the sibling U7SE spec sheet:

- 4K Mini-LED ULED, **144 Hz** native panel, HDMI 2.1 (VRR, ALLM, FreeSync), **eARC**.
- HDR: **Dolby Vision IQ**, HDR10, **HDR10+ (Adaptive)**, HLG, Filmmaker Mode, IMAX Enhanced.
- Audio: **Dolby Atmos** decoding, eARC output to a soundbar/AVR.
- Built-in decoders (per spec sheets): AV1, HEVC, VP9, H.264, MPEG-2, VC-1; containers MKV/MP4/TS/WebM.
- OS: **VIDAA** (exact version to be confirmed on the set: *Settings → Support → System info*).

> Everything above needs to be confirmed on the real TV in **Phase 0** (capability probe). Retailer listings disagree on details such as DTS support and speaker layout.

### 2.2 What VIDAA does and doesn't allow (as of late 2026)

| Area | Reality on VIDAA | Impact |
|------|------------------|--------|
| **Native apps / APK sideloading** | Not possible. VIDAA is Linux + a Chromium-based app runtime, and there is no Android layer. | No ExoPlayer/mpv, no native code. |
| **App store submission** | Partner-only. You apply as a "Content Partner" via vidaa.com, and publishing can take ~21 days. The store is aimed at commercial services. An app aggregating IPTV/debrid sources will very likely be rejected. | Don't plan on the official store. |
| **Unofficial install of a web app** | The community tools *vidaa-edge* / *vidaa-appstore* add a hosted web app (PWA) as a launcher icon. You point the TV's DNS at a helper on your LAN and open `vidaahub.com`. The old `hisense://debug` developer-mode trick **no longer works on newer firmware**, and the launcher icon sometimes doesn't appear. Firmware updates can break it at any time. | Possible, but fragile. A browser **bookmark** to a self-hosted URL is the reliable fallback. |
| **HTML5 runtime** | An older embedded Chromium. The version varies by firmware, and older builds caused blank screens in community apps until they were patched. MSE/EME are available. | Transpile to an older ES target, avoid bleeding-edge CSS, and test on the device. |
| **Video codecs in the browser** | Community testing on VIDAA (MediaTek SoC): H.264 and HEVC Main/Main10 up to 4K, VP9, and DV+HDR in **MKV** play. **DV in MP4 crashes or hangs the browser.** **AV1 does not play in the browser**, even though the panel's native player decodes it. Above-4K content gives a black screen. | A transcode or remux fallback is needed. DV is container-sensitive. |
| **Native player hand-off** | Community apps can hand a URL to VIDAA's **native media player**, which gets proper hardware DV/HDR. You lose your own UI (no custom OSD, subtitles styling, skip-intro, progress tracking). | A useful escape hatch for "best picture" on VIDAA-only setups. |
| **Audio** | Browser playback handles AAC, AC-3, E-AC-3, Opus and FLAC. **Lossless TrueHD / DTS-HD MA bitstream passthrough is not available from web apps.** Community reports suggest most TVs only pass DD+ 5.1/Atmos-in-DD+ over eARC from internal apps, and TrueHD is not passed. | Atmos works only via DD+ JOC, with no lossless Atmos from VIDAA apps. |
| **DRM** | Widevine and PlayReady are reported to be available via EME. | Not needed for our sources (IPTV/Jellyfin/debrid are DRM-free). |
| **Remote** | The VIDAA remote sends standard key codes plus colour and number keys (varies by remote). Some keys are reserved by the OS. | Map Back, colour and number keys. Never rely on keys the OS reserves. |
| **Background work** | None. A web app can't record, download or schedule while closed. | Recording and downloads **must** live on a server, not the TV. |

### 2.3 Workarounds, ranked

1. **External Android TV / Google TV streamer on HDMI (recommended primary client).**
   - **Nvidia Shield TV Pro**: the best all-rounder. Bitstreams **TrueHD Atmos and DTS-HD MA/DTS:X**, DV Profile 5/8, HDR10/HDR10+ (via apps), AFR via API, and a mature ExoPlayer/Media3 platform. Its weak spot is DV Profile 7 FEL (it plays the base layer only).
   - **Ugoos AM6B+ (CoreELEC or Android)**: the enthusiast option, with full DV Profile 7 FEL support for UHD Blu-ray remuxes.
   - **Google TV Streamer 4K / Fire TV Stick 4K Max**: cheaper, with good DV/Atmos-in-DD+. Lossless passthrough support is weaker or partial.
   - The box goes in an **HDMI 2.1 port**. The TV's eARC port feeds the soundbar/AVR. **HDMI-CEC** lets the Hisense remote drive the box, so there is one remote for WAF.
2. **Self-hosted web app on VIDAA (secondary "lite" client).** Install it as a launcher icon via vidaa-edge if that works on the firmware, otherwise use a browser bookmark. Use VIDAA's native player hand-off for DV titles.
3. **Plex/Jellyfin's own VIDAA apps.** These are not used as our UI, but they confirm that HEVC/DV direct play works on this SoC.

### 2.4 Decision

Build **one shared home server ("Hub")** plus **two clients**:

- **Primary:** a native **Android TV app** on an external streamer. This is the only way to hit G4 fully.
- **Secondary (later phase):** a **VIDAA web app** that reuses the Hub APIs and design system. It gives a good-enough experience straight on the TV and is honest about its limits.

> Open decision for Gary: confirm the streamer purchase (Shield Pro vs Ugoos) before Phase 1. See §9.

---

## 3. Architecture

```
                         ┌───────────────────────────── Home network ─────────────────────────────┐
  Internet sources       │                                                                         │
  ─────────────────      │   ┌──────────────────────── UltimateTV Hub (Docker on NAS) ───────────┐ │
  IPTV (M3U)    ───────────▶ │ Source adapters: M3U · Xtream · XMLTV · Jellyfin · Stremio addon  │ │
  Xtream Codes  ───────────▶ │                  (AIOStreams URL) · TorBox API · NAS filesystem   │ │
  XMLTV EPG     ───────────▶ │ Catalog & metadata (TMDB/TVDB match, artwork)                     │ │
  AIOStreams    ───────────▶ │ EPG engine (merge, normalise, series IDs)                         │ │
  TorBox        ───────────▶ │ Scheduler + Recorder (series link, ffmpeg → NAS)                  │ │
  TMDB/TVDB     ───────────▶ │ Download manager (TorBox → NAS, rename, Jellyfin rescan)          │ │
                         │   │ Stream gateway (remux/transcode fallback, connection-limit guard) │ │
                         │   │ User state (watch progress, favourites, profiles)                 │ │
                         │   │ REST + WebSocket API                                              │ │
                         │   └──────────────▲───────────────────────────▲────────────────────────┘ │
                         │                  │                           │                          │
                         │   ┌──────────────┴─────────┐     ┌───────────┴───────────┐              │
                         │   │ Android TV app (Shield)│     │ VIDAA web app (lite)  │              │
                         │   │ Compose for TV + Media3│     │ TS + Lightning/Solid  │              │
                         │   └────────┬───────────────┘     └───────────────────────┘              │
                         │            │ HDMI 2.1 (DV/HDR, AFR)                                       │
                         │        Hisense 85U7STUK ──eARC──▶ Soundbar / AVR (Atmos)                 │
                         │   Jellyfin server (existing / on NAS) ◀── recordings & downloads         │
                         └─────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Why a Hub?

- **Recording and series link need an always-on process.** No TV app (VIDAA *or* Android) can be trusted to record while asleep.
- **One brain, many screens.** EPG parsing, metadata matching and watch state live in one place, so both clients stay thin and consistent.
- **Speed.** Big XMLTV files (50–200 MB) are parsed once on the server. Clients get pre-sliced, paged JSON, which is what makes the guide feel instant.
- **Secrets stay off the TV.** Xtream credentials, TorBox and TMDB API keys live on the Hub.

### 3.2 Tech choices

| Component | Choice | Reason |
|-----------|--------|--------|
| Hub runtime | **Kotlin (Ktor)** or **TypeScript (Node/Fastify)** in Docker | Runs on Synology/Unraid/TrueNAS. Kotlin lets models be shared with the Android app. *Recommendation: Kotlin + Ktor, with shared `core` module.* |
| Hub DB | SQLite (WAL) → Postgres if needed | Single household. Zero ops. |
| Recorder | **ffmpeg** (`-c copy` to `.ts`/`.mkv`) | Lossless capture of the IPTV stream, with remux to MKV after recording. |
| Android TV app | **Kotlin + Jetpack Compose for TV + Media3 (ExoPlayer)** with ffmpeg audio extension. **libmpv** fallback for awkward files | The best HDR/AFR/passthrough control on Android TV. Compose-for-TV gives focus handling and polish. |
| VIDAA app | **TypeScript + Lightning JS 3 (or SolidJS + spatial nav)**, built to an ES2017 target | Lightning renders on WebGL for 60 fps on weak TV SoCs. |
| Metadata | TMDB (films/series), TVDB (episode numbering), Fanart.tv (logos/clearart) | Rich artwork drives the "premium" feel. |
| Design system | Shared tokens (colour, type, spacing, motion) in JSON → Compose theme + CSS | Both clients look like the same product. |

---

## 4. Feature breakdown by source

### 4.1 IPTV (M3U) and Xtream Codes

- **Ingest:** M3U/M3U8 URLs (with `tvg-id`, `tvg-logo`, `group-title`). Xtream via `player_api.php` (`get_live_categories`, `get_live_streams`, `get_vod_streams`, `get_series`, `get_short_epg`, `xmltv.php`).
- **Channel manager (set up once, hidden after):** merge multiple providers, dedupe channels, choose the preferred feed per channel (UHD > FHD > HD), auto-fallback to a backup feed on failure, and **Sky-style channel numbers** (101 BBC One, 102 BBC Two, …) with a UK-preset auto-numbering template.
- **Catch-up / timeshift:** use Xtream `tv_archive` where the provider offers it. That gives "Start over" and the past seven days in the guide.
- **Connection-limit guard:** the Hub knows the provider's max connections and arbitrates between live viewing and recordings (see conflicts, §5.3).
- **Xtream VOD & series:** pulled into the unified Films / TV libraries with TMDB matching, so they look the same as Jellyfin content.

### 4.2 EPG

- Sources: provider `xmltv.php`, extra XMLTV URLs (e.g. Freeview/Sky UK feeds such as epg.pw / iptv-org mappings), and per-channel overrides.
- The Hub merges them, normalises time zones, maps `tvg-id` to channel, and enriches programmes with artwork (TMDB lookup by title + year/season/episode).
- **Series identity** (the key to series link): use `<episode-num system="dd_progid">`, `xmltv_ns` and `<series-id>` (crid) when present. Otherwise use a normalised title + channel group + TMDB series ID.
- Refresh every 6 h, with an immediate refresh on demand. Clients fetch **time windows** (e.g. 4 h × 50 channels) as compact JSON.

### 4.3 VOD (unified)

- A single **Films** and **TV** library across Xtream VOD, Jellyfin, NAS files and AIOStreams.
- **"One title, many sources":** each title shows once. Behind it the Hub ranks sources (local NAS/Jellyfin first, then debrid, then Xtream) by quality, HDR format, audio format and availability.
- WAF mode: **Play** chooses the best source automatically. A long-press or "More options" reveals the source list for power users.

### 4.4 Jellyfin client

- Auth via Quick Connect (code shown on TV, approve on phone). No typing passwords with a remote.
- Libraries, Continue Watching, Next Up, collections, and two-way progress sync.
- **Direct play first.** Send the `DeviceProfile` that matches what the client can decode/passthrough, so Jellyfin only transcodes as a last resort. The Android profile allows HEVC/AV1/DV/TrueHD/DTS-HD. The VIDAA profile drops TrueHD/DTS and DV-in-MP4.
- Intro/credits skip via Jellyfin's media segments API.

### 4.5 AIOStreams URL & TorBox (Stremio/Nuvio-style)

- **AIOStreams** is a Stremio addon aggregator. The user pastes their configured AIOStreams manifest URL (`…/manifest.json`). The Hub speaks the **Stremio addon protocol** (`/catalog`, `/meta`, `/stream`) so any Stremio addon URL works, not just AIOStreams.
- **TorBox:** API key stored on the Hub. Streams resolved by AIOStreams come back as TorBox cached links (direct HTTPS), which play like any other file.
- **Nuvio-like UX:** TMDB-driven home rails (Trending, Popular, Because you watched…), then **one Play button** picks the best cached stream from the user's quality preferences (e.g. "4K DV > 4K HDR10 > 1080p, prefer Atmos, avoid CAM, max 60 GB"). Stream lists stay hidden unless asked for.
- **Save to NAS:** a "Download to library" action sends the item to TorBox (if not cached), and the Hub downloads it to the NAS (`/Movies/Title (Year)/…` Jellyfin naming), then triggers a Jellyfin library scan. Progress is shown in a Downloads screen.
- Users are responsible for only accessing content they have the rights to. The app is a generic client and ships with no content sources.

### 4.6 Local NAS files

- The Hub watches mounted shares (SMB/NFS) and indexes them with metadata. In practice Jellyfin already does this. **Recommendation: let Jellyfin own NAS indexing**, and the Hub reads from Jellyfin. That avoids duplicate scanning.
- The "uploaded/downloaded files" inbox is a `/Inbox` share. The Hub auto-renames and moves files into the library structure (FileBot-style rules), then triggers a rescan.

### 4.7 Unified search

- One search box (voice via the remote mic on Android TV) that hits channels, EPG (now and next 7 days), Films/TV across all sources, and recordings.
- Result chips: **On now · Upcoming (Record) · Watch now · In your library**.

---

## 5. Sky-style EPG & series link UX

### 5.1 Principles

1. **TV first.** The app opens to live TV (last channel) or Home. This is a setting, and the default is Home with a big "Live TV" tile.
2. **Everything is two presses away.** Guide = one press (Guide/Green key or Up from player). Record series = one press (Red/Record) from anywhere a programme is shown.
3. **Never lose your place.** Back always returns to where you were. The guide reopens on the current channel and time.
4. **Speed is UX.** Guide scrolls at 60 fps and the first paint is under 300 ms from cache.

### 5.2 Screens

**Live player & mini guide (banner)**
- Press OK while watching to show the now/next banner with channel number, logo, title, progress bar, and HDR/Atmos badges.
- Left/right browse *next* programmes on this channel, and up/down browse *other* channels while the current one keeps playing (Sky "mini guide"). OK tunes, Red records.
- Number keys give direct tuning (type "1-0-1"), with the channel name previewed as you type.
- **Back once = previous channel** (Sky behaviour). Back twice = exit to Home.
- Pause live TV with a 30–90 min buffer (Hub-side timeshift via the stream gateway, or local buffer on Android). The progress bar shows the buffer.

**Full TV guide (grid)**
- Layout: a **live preview window top-left** (the current channel keeps playing, like Sky Q), programme details top-right, and the grid below with roughly 7 channels × 2 hours visible.
- Category tabs across the top: *All · Favourites · Entertainment · Films · Sport · News · Kids · UHD*.
- Red dot = recording, stacked dots = series link, and a "↺" icon for catch-up available.
- Fast travel: day jump (Prev/Next day keys or a date strip), "Now" jump, and channel-number jump.
- Past programmes with catch-up show a **Play from start** button.

**Programme card (details)**
- Artwork hero, synopsis, S/E, cast, and quality badges.
- Actions: **Watch / Record / Record series / Remind me / More like this**.

**Recordings ("Planner")**
- Sky-style planner with tabs **All · Series · Films · Scheduled · Downloads**.
- Series are grouped into folders with a new-episode count. Part-watched episodes resume, and watched ones are greyed.
- **Scheduled** lists upcoming recordings and conflicts. **Series links** are managed here (keep last N, new episodes only, any channel / this channel only, padding).
- Storage bar for NAS free space, with auto-delete of watched episodes after X days (opt-in).

### 5.3 Series link engine (Hub)

- **Rule:** `{seriesKey, channelScope (this|any|group), newOnly, keepLatest N, paddingStart/End, preferredQuality}`.
- **Matching:** on every EPG refresh, find upcoming airings with the same `seriesKey`. Dedupe episodes already recorded (by S/E, crid, or subtitle+description hash). Prefer HD/UHD airings and avoid +1 channels unless the other airing clashes.
- **Robustness:** track schedule drift. If a programme moves within ±60 min (EPG update), move the recording. If a live stream drops, reconnect (and fall back to the backup feed). The recording is marked "incomplete" and the same episode is re-scheduled if it repeats within 7 days.
- **Conflicts:** limited by the provider's max connections. Show a clear Sky-like prompt: "*You're recording 2 programmes at 9pm. Choose one to cancel.*" Auto-resolve with a repeat airing when one exists.
- **Post-processing:** remux TS → MKV, add chapter marks at ad breaks (comskip, optional), write an NFO, place in `/Recordings/Series/Season NN/` and trigger a Jellyfin scan. Recordings are therefore also watchable from any Jellyfin client.
- **Reminders:** a toast on the TV 2 min before, with "Watch now" / "Dismiss".

### 5.4 Remote mapping (target)

| Key | Action |
|-----|--------|
| OK | Select / show banner |
| Back | Back / previous channel |
| Guide (or Green) | TV guide |
| Red / Record | Record (long-press = record series) |
| Yellow | Options (audio, subtitles, source) |
| Blue | Planner |
| Numbers | Direct channel entry |
| Ch +/– | Zap |
| Play/Pause | Pause live / VOD |
| Mic | Voice search (Android) |

Android over CEC forwards a reduced key set (colour keys are often missing). Every action must therefore also be reachable through the on-screen **Options** menu. The VIDAA web app reads key codes directly.

---

## 6. WAF design system

- **Look:** dark, cinematic, artwork-led, with big type (minimum 28 sp body at 10 ft on 85"). One accent colour and a subtle glass/blur on overlays.
- **Focus:** a clear scale+glow focus ring that never jumps unpredictably. Remember focus per row.
- **Home layout:** a hero (Continue watching / what's on now) followed by rails: *Live now · Continue watching · Recently recorded · Next up · Films for tonight · New on TorBox*. The order is customisable and **the default is opinionated**.
- **Zero jargon:** no "M3U", "codec", "transcode" or "debrid" outside Settings → Advanced. Badges use friendly labels ("Dolby Vision", "Atmos", "4K").
- **Guardrails:** a confirm step for deleting recordings or cancelling series links, undo toasts, and no dead ends (every error screen has "Try another source" / "Back to guide").
- **Speed budget:** cold start under 2 s to Home, channel zap under 1.5 s, guide open under 300 ms, focus move under 16 ms.
- **Quiet onboarding:** one wizard for sources (scan QR on phone → paste URLs/keys in a phone web form), Jellyfin Quick Connect, and a channel-numbering template. Done in five minutes, never seen again.
- **Usability test:** before each phase ships, the WAF tester gets 5 tasks with no help ("Watch BBC One", "Record every episode of X", "Carry on the film you were watching", "Find a comedy film in 4K", "Delete a watched recording"). The pass mark is five out of five without asking.

---

## 7. Picture & sound: using all the hardware

### 7.1 Picture

| Capability | How the app uses it |
|------------|---------------------|
| **Dolby Vision (IQ)** | Android: Media3 with DV decoder. Pass Profile 5/8.1 natively. For P7 (Blu-ray remux), play as P8 BL+RPU on Shield, or full FEL on Ugoos. VIDAA: prefer MKV containers and hand off to the native player for DV-in-MP4. |
| **HDR10+ (Adaptive)** | Pass dynamic metadata through Media3 (`HDR10+` via HEVC SEI). The TV's Adaptive mode handles ambient light. |
| **HDR10 / HLG** | Pass through untouched. HLG is important for BBC iPlayer-style UHD live sport via IPTV. |
| **Auto Frame-Rate (AFR)** | Android: `Surface.setFrameRate()` / `Display.Mode` switching so 23.976 → 24p, 25 → 50 Hz (UK broadcast!) and 29.97 → 60 Hz. This removes judder, which matters a lot on a 144 Hz panel that would otherwise run at 60. |
| **Auto dynamic range** | Switch to HDR only for HDR content (no SDR-in-HDR washout). The UI stays SDR. |
| **Resolution** | Output 4K always and let the TV's AI upscaler handle SD/HD IPTV, which is better than the box's scaler. |
| **Picture mode guidance** | First-run tip and Settings card: use **Filmmaker Mode** / **Dolby Vision Dark** for films, and turn off motion smoothing for film content. Leave **ALLM** on so the TV doesn't mistake the box for a game console. Note: TV picture settings can't be controlled by apps on VIDAA or Android, so the app *guides* the user here. |
| **Deinterlacing** | Many UK IPTV feeds are 1080i50. Use the box's hardware deinterlacer (Media3 handles it via the decoder) and verify there's no combing. |

### 7.2 Sound

| Capability | How the app uses it |
|------------|---------------------|
| **Dolby Atmos (DD+ JOC)** | Passthrough E-AC-3 untouched (Android `AudioTrack` encoded output, VIDAA native). The most common streaming Atmos format. |
| **TrueHD Atmos / DTS-HD MA / DTS:X** | Android box only: bitstream passthrough via HDMI → TV → **eARC** → AVR/soundbar. The TV's eARC passes these from HDMI inputs even though it can't from its own apps. |
| **TV speakers only** | If there's no external audio system, let the TV decode DD+/Atmos. Lossless tracks are decoded on the box to multichannel PCM. |
| **Track choice** | Auto-select the best track (Atmos > 7.1 > 5.1 > stereo, in the user's language). Remember per-show overrides. |
| **Lip-sync** | Per-device AV offset setting (with eARC this is usually automatic). |
| **Night mode** | One toggle in Options to apply dynamic range compression (DRC) when decoding, for late-night WAF. |

### 7.3 Capability probe (Phase 0)

A small diagnostic screen in both clients that reports what actually works on *this* TV and box:
- VIDAA: `MediaSource.isTypeSupported()` across codec strings (avc1, hvc1/hev1, dvh1/dvhe, av01, vp09, ec-3, ac-3, mp4a, flac, opus), `navigator.requestMediaKeySystemAccess`, Chromium version (UA), `screen` size and devicePixelRatio, and remote key codes.
- Android: `MediaCodecList`, `Display.getHdrCapabilities()`, supported display modes (refresh rates), `AudioManager` encodings for HDMI (`ENCODING_E_AC3_JOC`, `ENCODING_DOLBY_TRUEHD`, `ENCODING_DTS_HD`).
- Results are uploaded to the Hub, which then builds the Jellyfin DeviceProfile and source-ranking rules automatically.

---

## 8. Phased roadmap

| Phase | Name | Scope | Exit criteria |
|-------|------|-------|---------------|
| **0** | Spike & probe (1–2 wks) | Repo scaffold (monorepo: `hub/`, `android/`, `vidaa/`, `design/`). Capability probe on the real Hisense + candidate box. Test-install a hello-world web app via vidaa-edge **and** bookmark on the actual firmware. Sample-play DV P5/P7/P8, HDR10+, TrueHD Atmos, 25p/50i IPTV. | Written capability matrix, with the box choice confirmed. |
| **1** | Hub core + Live TV MVP (3–4 wks) | Hub: M3U/Xtream/XMLTV ingest, channel manager, EPG API. Android: Home, live player, mini guide banner, number tuning, previous channel, full guide grid with live preview. AFR + passthrough. | Watch live TV and use the guide daily. First WAF test (watch channel / use guide). |
| **2** | Recording & series link (3–4 wks) | Scheduler, ffmpeg recorder to NAS, series link engine, conflicts, Planner screen, catch-up / start over, reminders, Jellyfin rescan hook. | A week of series links recorded without misses. WAF test (record series / play recording / delete). |
| **3** | Unified VOD (4 wks) | Jellyfin client (Quick Connect, direct play profiles, skip intro), Xtream VOD/series, TMDB metadata, "one title many sources", Continue Watching across sources, unified search + voice. | Films/TV feel like one library. WAF test (continue film / find 4K comedy). |
| **4** | AIOStreams, TorBox & NAS pipeline (3 wks) | Stremio addon protocol, AIOStreams URL, TorBox API, auto best-stream, Download to NAS with renaming + Jellyfin scan, Downloads screen, phone-friendly setup/remote web page. | One-press play from discovery rails. A downloaded film appears in the library automatically. |
| **5** | Polish & WAF hardening (ongoing, 2–3 wks) | Motion design, artwork everywhere, skeleton loading, error recovery, performance budget enforcement, profiles (adult/kids), screensaver with artwork, backup/restore. | All 5 WAF tasks pass unaided. Crash-free for 30 days. |
| **6** | VIDAA lite client (3–4 wks) | Lightning/Solid web app served by the Hub: Home, guide, live, Jellyfin/VOD with browser playback and native-player hand-off for DV, recordings playback. Install via vidaa-edge icon or bookmark. | Usable on the TV with no box, with known limits documented in-app. |

Durations assume one developer working part-time with AI assistance. Phases 3 and 4 can swap if streaming discovery matters more than Jellyfin.

### 8.1 Repo layout (proposed)

```
UltimateTV/
├── docs/            # this plan, ADRs, capability matrix
├── design/          # tokens, Figma exports, screen specs
├── hub/             # Kotlin/Ktor server + Dockerfile + docker-compose.yml
├── shared/          # Kotlin multiplatform models & API client (hub + android)
├── android/         # Android TV app (Compose for TV, Media3)
└── vidaa/           # Web client (TypeScript, Lightning/Solid)
```

### 8.2 Engineering practices

- ADRs in `docs/adr/` for each major decision (box choice, Hub language, UI framework).
- CI with GitHub Actions: build Hub image, build Android APK, and lint/test the web client.
- Golden-file tests for M3U/Xtream/XMLTV parsing and series-link matching (the riskiest logic).
- Screenshot tests (Paparazzi/Roborazzi) for TV screens to protect polish.
- Releases: the Hub via Docker image on GHCR, Android via sideloaded APK (Downloader app / ADB), with in-app update check against GitHub releases.

---

## 9. Risks & open questions

| Risk / question | Mitigation |
|-----------------|------------|
| **Box choice** (Shield Pro vs Ugoos AM6B+ vs Google TV Streamer) | Decide in Phase 0 after testing. Shield Pro is the default recommendation for UX + lossless audio. Ugoos only if DV P7 FEL remuxes matter. |
| Is there a soundbar/AVR on eARC? | Changes how important lossless passthrough is. Ask Gary. |
| Where does the Hub run? (Synology/Unraid/other, CPU for transcoding) | The NAS model decides whether transcoding fallback is feasible. Ask Gary. |
| Existing Jellyfin server? | Assumed yes. If not, include it in the Hub docker-compose. |
| IPTV provider connection limit | Determines how many simultaneous recordings + live are possible. |
| VIDAA firmware updates break the vidaa-edge install | Bookmark fallback. The VIDAA client is a "nice to have", not critical path. |
| CEC key forwarding gaps (colour/number keys) | On-screen Options for every action. Test the Hisense remote with the chosen box in Phase 0. Fall back to the box's own remote if needed. |
| XMLTV quality for UK channels | Allow multiple EPG sources per channel with priority, plus manual mapping UI. |
| Legal/content | The app is a neutral client. Sources and credentials are user-supplied, and no content or addon URLs are bundled. |

---

## 10. Sources

- Jellyfin forum: installing web apps on VIDAA (vidaa-edge, DNS method, debug mode no longer works on newer models, DV/codec issues): https://forum.jellyfin.org/printthread.php?tid=10066
- stremio-vidaa-tv (VIDAA browser codec/DRM testing, native-player hand-off, install methods): https://github.com/NoobyGains/stremio-vidaa-tv
- VIDAA WebApp Development Guide (PDF): https://www.vidaa.com/wp-content/uploads/2020/12/WebApp_Development_Guide_for_VIDAA.pdf
- VIDAA content partner programme: https://www.vidaa.com/partners/
- VIDAA app publishing timelines (third-party publisher): https://autopo.st/vidaa-tv-apps/requirements/
- 85U7STUK listing: https://petertyson.co.uk/hisense-85u7stuk
- Sibling U7SE spec sheet (codecs, HDR, eARC, ports): https://www.tvsfaq.com/en/specifications/hisense-55u7se
- TrueHD passthrough discussion on Hisense TVs: https://emby.media/community/topic/142411-true-hd-pass-through/
- AIOStreams / TorBox / Nuvio overview: https://store.elfhosted.com/product-category/stremio-addons/aio-suite
