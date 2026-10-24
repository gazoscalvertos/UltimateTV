# UltimateTV: Product & Technical Plan

> Status: **Draft v3** (2026-10-24). This is a plan, not code yet.
> Target hardware: **Hisense 85" 85U7STUK** (2026 U7 Mini-LED, VIDAA OS). **The app runs on the TV itself, with no external streaming box.**
> North star: **the best picture and sound VIDAA can deliver, wrapped in a UI that passes the Wife Acceptance Factor (WAF).**

---

## 1. Goals

| # | Goal | What "done" looks like |
|---|------|------------------------|
| G1 | One app for everything | Live IPTV, Xtream, VOD, Jellyfin, AIOStreams/TorBox and NAS files all live in one home screen and one search. |
| G2 | Sky-grade TV guide | A fast EPG grid with live preview, now/next banner and one-press **Record series**. Recordings appear in a planner. |
| G3 | WAF | Someone who has never seen it can turn the TV on, find a show and press play with only the arrow keys, OK and Back. No settings screens, no codec talk, no "pick a stream" lists by default. |
| G4 | Best picture & sound on VIDAA | Dolby Vision / HDR10+ / HLG whenever the TV can show it, Dolby Atmos via Dolby Digital Plus, and a server that rewraps or converts files the TV can't play, so playback never just fails. |
| G5 | Own your library | Anything downloaded (TorBox, recordings) lands on the local NAS and shows up in Jellyfin automatically. |

**Out of scope for v1:** multi-user profiles with parental PINs (v2), mobile apps (a companion web remote is in Phase 4), casting.

**Decision log:** Gary chose **VIDAA TV only, no external box** (2026-10-24). This plan is built around that choice. The server design keeps an Android TV box as a cheap upgrade path later (§10), and nothing in this plan has to be thrown away to take it.

### 1.1 Household setup (confirmed 2026-10-24)

| Item | Setup | What it means for the plan |
|------|-------|----------------------------|
| Playback device | The TV itself (VIDAA web app) | §2.3 workarounds apply everywhere. |
| Audio | **TV speakers, no soundbar** | The TV decodes all audio. DD+ Atmos plays through the TV's virtualised Atmos. Lossless audio doesn't matter for these speakers, so converting TrueHD/DTS costs nothing audible. Dialogue clarity and night mode matter more (§7.2). |
| Storage / server | A Linux machine with **SMB and SFTP** shares | The Hub runs on this machine (Docker or a native systemd service) and writes recordings and downloads straight to its disks. If that machine can't run services, a small always-on mini PC on the LAN runs the Hub and mounts the shares over SMB. |
| IPTV | **One connection** on the current plan (the provider sells 4- and 5-connection plans) | Only one live stream at a time across watching *and* recording. The series link engine is designed around this (§5.3), and upgrading to a multi-connection plan unlocks Sky-style "record two, watch a third". |

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
| **Native apps / APK sideloading** | Not possible. VIDAA is Linux + a Chromium-based app runtime, and there is no Android layer. | The app is a **web app** (HTML/JS). |
| **App store submission** | Partner-only. You apply as a "Content Partner" via vidaa.com, and publishing can take ~21 days. The store is aimed at commercial services. An app aggregating IPTV/debrid sources will very likely be rejected. | Don't plan on the official store. |
| **Unofficial install of a web app** | The community tools *vidaa-edge* / *vidaa-appstore* add a hosted web app (PWA) as a launcher icon. You point the TV's DNS at a helper on your LAN and open `vidaahub.com`. The old `hisense://debug` developer-mode trick **no longer works on newer firmware**, and the launcher icon sometimes doesn't appear. Firmware updates can break it at any time. | Possible, but fragile. A browser **bookmark** to a self-hosted URL is the reliable fallback. |
| **HTML5 runtime** | An older embedded Chromium. The version varies by firmware, and older builds caused blank screens in community apps until they were patched. MSE/EME are available. | Transpile to an older ES target, avoid bleeding-edge CSS, and test on the device. |
| **Video codecs in the browser** | Community testing on VIDAA (MediaTek SoC): H.264 and HEVC Main/Main10 up to 4K, VP9, and DV+HDR in **MKV** play. **DV in MP4 crashes or hangs the browser.** **AV1 does not play in the browser**, even though the panel's native player decodes it. Above-4K content gives a black screen. | The server must remux or transcode. DV is container-sensitive. |
| **Native player hand-off** | Community apps can hand a URL to VIDAA's **native media player**, which gets proper hardware DV/HDR. You lose your own UI (no custom OSD, subtitles styling, skip-intro, progress tracking). | An escape hatch for the files the browser player can't handle. |
| **Audio** | Browser playback handles AAC, AC-3, E-AC-3, Opus and FLAC. **Lossless TrueHD / DTS-HD MA bitstream passthrough is not available from web apps.** Community reports suggest most TVs only pass DD+ 5.1/Atmos-in-DD+ over eARC from internal apps, and TrueHD is not passed. | Atmos works only via DD+ JOC, with no lossless Atmos. |
| **DRM** | Widevine and PlayReady are reported to be available via EME. | Not needed for our sources (IPTV/Jellyfin/debrid are DRM-free). |
| **Remote** | The VIDAA remote sends standard key codes plus colour and number keys (varies by remote). Some keys are reserved by the OS. | Map Back, colour and number keys. Never rely on keys the OS reserves. |
| **Background work** | None. A web app can't record, download or schedule while closed. | Recording and downloads **must** live on a server, not the TV. |
| **Frame rate & HDR switching** | Not exposed to web apps. The TV decides output mode from the video it is decoding. Whether it switches to 24p/50 Hz for browser video has to be tested. | Probe in Phase 0. If it doesn't, films that need it go through the native-player hand-off. |

### 2.3 How we work around each limit without a box

| Limit | Workaround |
|-------|------------|
| No native install | Self-host the web app on the NAS. Install it as a launcher icon via vidaa-edge where it works, with a browser bookmark as fallback. Phase 0 tests both on this exact firmware. |
| Store rejection | Not needed. The app is served from the home network and updates instantly when we deploy. |
| Codec gaps (AV1, DV-in-MP4) | **Stream gateway** on the Hub: remux MP4 → MKV (no quality loss, near-zero CPU) for DV/HEVC, and transcode AV1 → HEVC only when nothing better exists. Source ranking prefers files the TV plays natively so conversion is rare. |
| DV and frame-rate edge cases | **Native player hand-off** as a per-title fallback, chosen automatically when the probe says the browser path would lose DV or judder. |
| Lossless audio | Prefer DD+ Atmos sources. For TrueHD/DTS-HD-only files, the Hub converts audio to E-AC-3 5.1/7.1 (keeps surround, loses Atmos height objects). The video is never touched. |
| No background work | All recording, series link, downloads and EPG parsing run on the Hub. |
| Weak TV CPU/RAM | Hub pre-slices EPG and artwork, sends small JSON pages, and pre-scales images. The UI engine renders on the GPU (WebGL). |

---

## 3. Architecture

```
                         ┌───────────────────────────── Home network ─────────────────────────────┐
  Internet sources       │                                                                         │
  ─────────────────      │   ┌────────────────── UltimateTV Hub (Linux server, SMB/SFTP) ────────┐ │
  IPTV (M3U)    ───────────▶ │ Source adapters: M3U · Xtream · XMLTV · Jellyfin · Stremio addon  │ │
  Xtream Codes  ───────────▶ │                  (AIOStreams URL) · TorBox API · NAS filesystem   │ │
  XMLTV EPG     ───────────▶ │ Catalog & metadata (TMDB/TVDB match, artwork)                     │ │
  AIOStreams    ───────────▶ │ EPG engine (merge, normalise, series IDs)                         │ │
  TorBox        ───────────▶ │ Scheduler + Recorder (series link, ffmpeg → NAS)                  │ │
  TMDB/TVDB     ───────────▶ │ Download manager (TorBox → NAS, rename, Jellyfin rescan)          │ │
                         │   │ Stream gateway (remux, audio convert, transcode fallback)          │ │
                         │   │ User state (watch progress, favourites, profiles)                 │ │
                         │   │ Web app hosting + REST/WebSocket API                              │ │
                         │   └──────────────────────────────▲────────────────────────────────────┘ │
                         │                                  │ HTTP on LAN                          │
                         │                 ┌────────────────┴──────────────┐                       │
                         │                 │ UltimateTV web app on VIDAA   │                       │
                         │                 │ (launcher icon or bookmark)   │                       │
                         │                 └────────────────┬──────────────┘                       │
                         │                     Hisense 85U7STUK (TV speakers, Atmos decoded by TV)  │
                         │   Jellyfin server (existing or on the server) ◀── recordings & downloads         │
                         └─────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Why a Hub?

- **Recording and series link need an always-on process.** A VIDAA web app stops when the TV sleeps.
- **The TV's browser has gaps.** The Hub's stream gateway rewraps or converts the few files the TV can't play, so the person on the sofa never sees a playback error.
- **Speed.** Big XMLTV files (50–200 MB) would choke the TV's browser. The Hub parses them once and serves pre-sliced, paged JSON, which is what makes the guide feel instant.
- **Secrets stay off the TV.** Xtream credentials, TorBox and TMDB API keys live on the Hub.
- **Updates without a store.** The Hub serves the web app, so a new version is live on the TV the next time it opens.

### 3.2 Tech choices

| Component | Choice | Reason |
|-----------|--------|--------|
| Hub runtime | **TypeScript (Node + Fastify)** in Docker, or as a native systemd service | Same language as the TV app, so API types and models are shared in one monorepo. Runs on Gary's Linux file server alongside the SMB/SFTP shares. |
| Hub DB | SQLite (WAL) | Single household. Zero ops. |
| Recorder & gateway | **ffmpeg** | `-c copy` for lossless recording and remux. Audio-only conversion to E-AC-3. Hardware transcode (Intel Quick Sync/VAAPI) if the NAS has it. |
| TV app UI | **Lightning JS 3 (Blits)** | Renders on WebGL. Built for TV remotes and focus handling. Holds 60 fps on weak TV SoCs where DOM-heavy frameworks stutter. *Fallback: SolidJS + spatial navigation if Lightning misbehaves on this Chromium.* |
| TV app playback | `<video>` + **hls.js / mpegts.js** for live, MSE for VOD, native player hand-off for edge cases | Covers HLS and MPEG-TS IPTV feeds plus direct file playback. |
| Build target | ES2017 + polyfills, tested against the TV's exact Chromium version | VIDAA ships an older engine. |
| Metadata | TMDB (films/series), TVDB (episode numbering), Fanart.tv (logos/clearart) | Rich artwork drives the "premium" feel. |
| Design system | Tokens (colour, type, spacing, motion) in one JSON file | One source of truth for the TV app and the phone setup page. |

---

## 4. Feature breakdown by source

### 4.1 IPTV (M3U) and Xtream Codes

- **Ingest:** M3U/M3U8 URLs (with `tvg-id`, `tvg-logo`, `group-title`). Xtream via `player_api.php` (`get_live_categories`, `get_live_streams`, `get_vod_streams`, `get_series`, `get_short_epg`, `xmltv.php`).
- **Channel manager (set up once, hidden after):** merge multiple providers, dedupe channels, choose the preferred feed per channel (UHD > FHD > HD), auto-fallback to a backup feed on failure, and **Sky-style channel numbers** (101 BBC One, 102 BBC Two, …) with a UK-preset auto-numbering template.
- **Playback on VIDAA:** ask Xtream for **HLS (`.m3u8`)** output where offered, which plays smoothly in the TV's browser via hls.js. Plain MPEG-TS feeds play via mpegts.js. If a feed fails in the browser, the Hub repackages it to HLS on the fly (copy, no re-encode).
- **Catch-up / timeshift:** use Xtream `tv_archive` where the provider offers it. That gives "Start over" and the past seven days in the guide.
- **Connection-limit guard:** the Hub owns the provider connection (currently **one**) and is the only thing that opens streams. When watching and recording the same channel, it shares one upstream stream between the TV and the recorder. See §5.3 for how series link works within one connection.
- **Xtream VOD & series:** pulled into the unified Films / TV libraries with TMDB matching, so they look the same as Jellyfin content.

### 4.2 EPG

- Sources: provider `xmltv.php`, extra XMLTV URLs (e.g. Freeview/Sky UK feeds such as epg.pw / iptv-org mappings), and per-channel overrides.
- The Hub merges them, normalises time zones, maps `tvg-id` to channel, and enriches programmes with artwork (TMDB lookup by title + year/season/episode).
- **Series identity** (the key to series link): use `<episode-num system="dd_progid">`, `xmltv_ns` and `<series-id>` (crid) when present. Otherwise use a normalised title + channel group + TMDB series ID.
- Refresh every 6 h, with an immediate refresh on demand. The TV fetches **time windows** (e.g. 4 h × 50 channels) as compact JSON, never the raw XMLTV.

### 4.3 VOD (unified)

- A single **Films** and **TV** library across Xtream VOD, Jellyfin, NAS files and AIOStreams.
- **"One title, many sources":** each title shows once. Behind it the Hub ranks sources (local NAS/Jellyfin first, then debrid, then Xtream) by quality, HDR format, audio format and availability.
- **VIDAA-aware ranking:** the Hub uses the TV's probe results to prefer sources that play natively (HEVC in MKV, DV in MKV, DD+ Atmos audio) over ones needing conversion. A 4K DV MKV with DD+ Atmos beats a 4K AV1 file with TrueHD, even if the second one is "better" on paper.
- WAF mode: **Play** chooses the best source automatically. A long-press or "More options" reveals the source list for power users.

### 4.4 Jellyfin client

- Auth via Quick Connect (code shown on TV, approve on phone). No typing passwords with a remote.
- Libraries, Continue Watching, Next Up, collections, and two-way progress sync.
- **Direct play first.** Send a `DeviceProfile` built from the probe: allow H.264/HEVC/VP9, DV in MKV, AAC/AC-3/E-AC-3/FLAC/Opus. Exclude AV1, DV in MP4, TrueHD and DTS-HD. Jellyfin then remuxes to MKV or converts only the audio instead of transcoding the whole file.
- Intro/credits skip via Jellyfin's media segments API.

### 4.5 AIOStreams & TorBox (Stremio/Nuvio-style)

- **AIOStreams** is a Stremio addon aggregator. The user pastes their configured AIOStreams manifest URL (`…/manifest.json`). The Hub speaks the **Stremio addon protocol** (`/catalog`, `/meta`, `/stream`) so any Stremio addon URL works, not just AIOStreams.
- **TorBox:** API key stored on the Hub. Streams resolved by AIOStreams come back as TorBox cached links (direct HTTPS), which play like any other file.
- **Nuvio-like UX:** TMDB-driven home rails (Trending, Popular, Because you watched…), then **one Play button** picks the best cached stream from the user's quality preferences. The default rule for this TV is *"4K DV/HDR10+ in MKV > 4K HDR10 > 1080p, prefer DD+ Atmos, avoid AV1, TrueHD-only and CAM, max 60 GB"*. Stream lists stay hidden unless asked for.
- AIOStreams can already filter and sort by codec, HDR type and audio format, so most of the VIDAA rules are pushed into the AIOStreams config and the Hub only re-checks.
- **Save to NAS:** a "Download to library" action sends the item to TorBox (if not cached), and the Hub downloads it to the NAS (`/Movies/Title (Year)/…` Jellyfin naming), then triggers a Jellyfin library scan. Progress is shown in a Downloads screen.
- Users are responsible for only accessing content they have the rights to. The app is a generic client and ships with no content sources.

### 4.6 Local NAS files

- The Hub runs on the Linux file server, so it reads and writes the library disks directly. Other machines drop files in over **SMB or SFTP**. It indexes them with metadata. In practice Jellyfin already does this. **Recommendation: let Jellyfin own NAS indexing**, and the Hub reads from Jellyfin. That avoids duplicate scanning.
- The "uploaded/downloaded files" inbox is a `/Inbox` share. The Hub auto-renames and moves files into the library structure (FileBot-style rules), then triggers a rescan.
- **Optional "TV-ready" pass:** when a file lands, the Hub can remux it to MKV and add a DD+ audio track if it only has TrueHD/DTS-HD. The original tracks are kept. Later plays then need no live conversion.

### 4.7 Unified search

- One search box that hits channels, EPG (now and next 7 days), Films/TV across all sources, and recordings.
- Typing with a remote is slow, so the search screen leads with **suggestions** (recent, trending, what's on now) and a large on-screen keyboard. A **phone search** option opens the same search on the phone via QR code, and results appear on the TV.
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
- Pause live TV with a 30–90 min buffer held on the Hub (the TV browser can't buffer that much). The progress bar shows the buffer.

**Full TV guide (grid)**
- Layout: a **live preview window top-left** (the current channel keeps playing, like Sky Q), programme details top-right, and the grid below with roughly 7 channels × 2 hours visible.
- Category tabs across the top: *All · Favourites · Entertainment · Films · Sport · News · Kids · UHD*.
- Red dot = recording, stacked dots = series link, and a "↺" icon for catch-up available.
- Fast travel: day jump (Prev/Next day keys or a date strip), "Now" jump, and channel-number jump.
- Past programmes with catch-up show a **Play from start** button.
- Rendering: only visible cells are drawn (virtualised grid) so the TV's browser stays smooth with hundreds of channels.

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
- **Working with one IPTV connection** (current plan). One connection means one live channel at a time, so the engine uses these strategies in order:
  1. **Record from catch-up instead of live.** If the channel has `tv_archive`, the recording is fetched from catch-up after it airs, at a time the TV isn't in use (overnight by default). Live viewing is untouched. This should cover most UK channels on providers with catch-up.
  2. **Share the stream.** If you're watching the channel that's recording, the Hub sends the same stream to the TV and the recorder.
  3. **Use a repeat airing** (e.g. +1 channel or a later showing) when one fits around what's being watched.
  4. **Ask, Sky-style.** Only when none of the above work: "*Silent Witness is recording on BBC One at 9pm. Switching channel will stop the recording. Switch anyway?*" A recording in progress is never stopped silently.
- **Conflicts between recordings** use the same order. With one connection, two live-only recordings at the same time is a real clash, and the prompt shows which one to keep. Upgrading the IPTV plan to 4–5 connections removes almost all of this, and the engine needs no change because the connection count is a setting.
- **Post-processing:** remux TS → MKV, add chapter marks at ad breaks (comskip, optional), write an NFO, place in `/Recordings/Series/Season NN/` and trigger a Jellyfin scan. Recordings are therefore also watchable from any Jellyfin client.
- **Reminders:** a toast on the TV 2 min before, with "Watch now" / "Dismiss" (shown only while the app is open, since VIDAA has no background notifications).

### 5.4 Remote mapping (target)

| Key | Action |
|-----|--------|
| OK | Select / show banner |
| Back | Back / previous channel |
| Guide (or Green) | TV guide |
| Red | Record (long-press = record series) |
| Yellow | Options (audio, subtitles, source) |
| Blue | Planner |
| Numbers | Direct channel entry |
| Ch +/– | Zap |
| Play/Pause | Pause live / VOD |

The web app reads VIDAA key codes directly, so the Hisense remote works without CEC. The 2026 UK remote's exact key set (colour keys, Guide key, number pad) is confirmed in Phase 0. Every action is also reachable through the on-screen **Options** menu in case a key is reserved by the OS.

---

## 6. WAF design system

- **Look:** dark, cinematic, artwork-led, with big type (minimum 28 px body at 10 ft on 85"). One accent colour and a subtle glass/blur on overlays (pre-rendered where the TV GPU struggles).
- **Focus:** a clear scale+glow focus ring that never jumps unpredictably. Remember focus per row.
- **Home layout:** a hero (Continue watching / what's on now) followed by rails: *Live now · Continue watching · Recently recorded · Next up · Films for tonight · New on TorBox*. The order is customisable and **the default is opinionated**.
- **Zero jargon:** no "M3U", "codec", "transcode" or "debrid" outside Settings → Advanced. Badges use friendly labels ("Dolby Vision", "Atmos", "4K").
- **Guardrails:** a confirm step for deleting recordings or cancelling series links, undo toasts, and no dead ends (every error screen has "Try another source" / "Back to guide").
- **Speed budget:** cold start under 3 s to Home (web app shell cached by a service worker where VIDAA allows, otherwise served from the LAN), channel zap under 2 s, guide open under 300 ms, focus move under 16 ms.
- **Quiet onboarding:** one wizard for sources (scan QR on phone → paste URLs/keys in a phone web form served by the Hub), Jellyfin Quick Connect, and a channel-numbering template. Done in five minutes, never seen again.
- **Usability test:** before each phase ships, the WAF tester gets 5 tasks with no help ("Watch BBC One", "Record every episode of X", "Carry on the film you were watching", "Find a comedy film in 4K", "Delete a watched recording"). The pass mark is five out of five without asking.

---

## 7. Picture & sound: getting the most from VIDAA

### 7.1 Picture

| Capability | How the app uses it on VIDAA |
|------------|------------------------------|
| **Dolby Vision (IQ)** | Play DV in **MKV** in the browser player. The Hub remuxes DV-in-MP4 to MKV on the fly (copy, no quality loss). Profile 5 and 8 are expected to work. Profile 7 Blu-ray remuxes are tested in Phase 0, with native-player hand-off as the fallback. |
| **HDR10+ (Adaptive)** | Passed through untouched in HEVC. The TV's Adaptive mode handles room light. Confirm in Phase 0 that the browser path keeps HDR10+ metadata. |
| **HDR10 / HLG** | Pass through untouched. HLG matters for UHD live sport via IPTV. |
| **Frame rate (24p, 50 Hz)** | Web apps can't request a display mode. Phase 0 checks whether VIDAA switches to 24p/50 Hz for browser video. If it doesn't, films go to the native player by default, where the TV handles it. |
| **Native player hand-off** | Automatic for titles the probe marks as "better in native player" (e.g. DV P7, AV1, frame-rate-sensitive films). The app shows a one-line "Playing in TV player" note and resumes progress tracking when it returns. |
| **Resolution** | Always send the highest resolution available and let the TV's AI upscaler handle SD/HD IPTV. |
| **Picture mode guidance** | First-run tip and Settings card: use **Filmmaker Mode** / **Dolby Vision Dark** for films, and turn off motion smoothing for film content. Apps can't change TV picture settings, so the app *guides* the user here. |
| **Interlaced IPTV** | Many UK IPTV feeds are 1080i50. Test the TV's deinterlacing in the browser player in Phase 0. If it combs, the Hub can deinterlace on the fly for those channels only. |

### 7.2 Sound

| Capability | How the app uses it on VIDAA |
|------------|------------------------------|
| **Dolby Atmos (DD+ JOC)** | Passed to the TV untouched and decoded by the TV, which renders it as virtual Atmos on its own speakers. This is the main Atmos path. (If a soundbar is added later, the same stream goes out over eARC with no app change.) |
| **TrueHD / DTS-HD MA** | Not playable as bitstream from VIDAA apps. With TV speakers the loss is inaudible. Source ranking prefers DD+ Atmos versions. Otherwise the Hub converts the audio to E-AC-3 5.1 (the TV downmixes it), or the optional "TV-ready" pass adds that track ahead of time. |
| **TV speakers** | The first-run tips suggest the TV's dialogue enhancement and a sound mode for films versus TV. Apps can't change TV audio settings, so the app only guides. |
| **DTS** | Hisense's DTS support varies by model and year. Phase 0 checks it. If unsupported, the Hub converts DTS to E-AC-3. |
| **Track choice** | Auto-select the best track the TV can play (DD+ Atmos > DD+ 5.1 > AC-3 > stereo, in the user's language). Remember per-show overrides. |
| **Night mode** | One toggle in Options that asks the Hub for a dynamic-range-compressed audio track, with dialogue lifted. This matters more on TV speakers, where loud action and quiet speech are hard to balance late at night. |

### 7.3 Capability probe (Phase 0)

A diagnostic page served by the Hub that runs in the TV's browser and reports what actually works on *this* TV:
- `MediaSource.isTypeSupported()` and `video.canPlayType()` across codec strings (avc1, hvc1/hev1, dvh1/dvhe, av01, vp09, ec-3, ac-3, mp4a, flac, opus, dts).
- `navigator.requestMediaKeySystemAccess` for DRM, Chromium version (UA), screen size, devicePixelRatio and WebGL support.
- A test-clip matrix played for real (DV P5/P7/P8 in MKV and MP4, HDR10+, HLG, 24p/25p/50i, DD+ Atmos, TrueHD, DTS), with a person noting whether the TV's HDR/DV badge appears, whether it judders, and what the TV reports as the audio format (Settings → Sound).
- Every remote key's code.
- Results are saved to the Hub, which then builds the Jellyfin DeviceProfile and source-ranking rules automatically.

---

## 8. Phased roadmap

| Phase | Name | Scope | Exit criteria |
|-------|------|-------|---------------|
| **0** | Spike & probe (1–2 wks) | Monorepo scaffold (`hub/`, `tv/`, `shared/`, `design/`). Capability probe and test-clip matrix on the real Hisense. Install a hello-world app via vidaa-edge **and** bookmark on the actual firmware. Check that Lightning JS runs at 60 fps on the TV. List which IPTV channels have catch-up (drives recording with one connection). Check the Linux server CPU for transcoding. | A written capability matrix, confirmed install method and a catch-up channel list. |
| **1** | Hub core + Live TV MVP (3–4 wks) | Hub: M3U/Xtream/XMLTV ingest, channel manager, EPG API, HLS repackaging. TV app: Home, live player, mini guide banner, number tuning, previous channel, full guide grid with live preview. | Watch live TV and use the guide daily. First WAF test (watch channel / use guide). |
| **2** | Recording & series link (3–4 wks) | Scheduler, ffmpeg recorder to NAS, series link engine, conflicts, Planner screen, catch-up / start over, Hub-side pause live, Jellyfin rescan hook. | A week of series links recorded without misses. WAF test (record series / play recording / delete). |
| **3** | Unified VOD (4 wks) | Jellyfin client (Quick Connect, probe-based direct play, skip intro), Xtream VOD/series, TMDB metadata, "one title many sources", stream gateway (remux/audio convert), native-player hand-off, Continue Watching across sources, unified search with phone search. | Films/TV feel like one library, and no title fails to play. WAF test (continue film / find 4K comedy). |
| **4** | AIOStreams, TorBox & NAS pipeline (3 wks) | Stremio addon protocol, AIOStreams URL, TorBox API, VIDAA-aware best stream, Download to NAS with renaming + "TV-ready" pass + Jellyfin scan, Downloads screen, phone-friendly setup/remote page. | One-press play from discovery rails. A downloaded film appears in the library automatically. |
| **5** | Polish & WAF hardening (ongoing, 2–3 wks) | Motion design, artwork everywhere, skeleton loading, error recovery, performance budget enforcement, profiles (adult/kids), screensaver with artwork, backup/restore, firmware-update watch (re-test install after each VIDAA update). | All 5 WAF tasks pass unaided. Crash-free for 30 days. |

Durations assume one developer working part-time with AI assistance. Phases 3 and 4 can swap if streaming discovery matters more than Jellyfin.

### 8.1 Repo layout (proposed)

```
UltimateTV/
├── docs/            # this plan, ADRs, capability matrix
├── design/          # tokens, screen specs
├── shared/          # TypeScript API types & models (hub + tv)
├── hub/             # Node/Fastify server, ffmpeg workers, Dockerfile + docker-compose.yml
├── tv/              # VIDAA web app (Lightning JS)
└── tools/probe/     # capability probe page and test-clip list
```

### 8.2 Engineering practices

- ADRs in `docs/adr/` for each major decision (VIDAA-only, UI engine, install method).
- CI with GitHub Actions: build and test the Hub, build the TV app, lint/typecheck everything, and publish the Hub image to GHCR.
- Golden-file tests for M3U/Xtream/XMLTV parsing, series-link matching and source ranking (the riskiest logic).
- Screenshot tests in headless Chromium pinned to the TV's Chromium version, to protect polish.
- Releases: one Docker image that contains both the Hub and the built TV app. Updating the container updates the TV.

---

## 9. Risks & open questions

| Risk / question | Mitigation |
|-----------------|------------|
| **VIDAA firmware update breaks the vidaa-edge launcher icon** | Bookmark fallback is always set up. The app itself keeps working because it's just a web page served by the Hub. Re-test after each firmware update (Phase 5). |
| Browser player loses DV or doesn't switch frame rate | Native-player hand-off, chosen per title from the probe results. |
| TV browser too slow for a rich UI | Lightning JS on WebGL, a virtualised guide grid, pre-scaled artwork and a strict speed budget. Phase 0 proves it before Phase 1 starts. |
| No lossless Atmos | Accepted with this choice, and inaudible on TV speakers. DD+ Atmos is the format most streaming services use, so most content still has Atmos. |
| Can the Linux file server run the Hub? (CPU, Docker, hardware transcoding) | Remux and audio conversion are cheap and run on almost anything. Full video transcoding (AV1 → HEVC) needs Intel Quick Sync or similar, otherwise those titles go to the native player. Ask Gary for the machine's CPU. If it can't run services, use a mini PC (e.g. Intel N100) that mounts the SMB shares. |
| Existing Jellyfin server? | Ask Gary. If there isn't one, run it on the same Linux server alongside the Hub. |
| **One IPTV connection** | Catch-up-based recording, stream sharing and repeat airings (§5.3). Phase 0 checks which channels have catch-up. A 4–5 connection plan is the easy fix if clashes annoy. |
| XMLTV quality for UK channels | Allow multiple EPG sources per channel with priority, plus manual mapping UI. |
| Legal/content | The app is a neutral client. Sources and credentials are user-supplied, and no content or addon URLs are bundled. |

---

## 10. Upgrade path (if ever wanted)

The Hub does all the heavy work and exposes a plain HTTP API. If lossless Atmos, Dolby Vision Profile 7 or guaranteed frame-rate switching ever matter more than having no box, an Android TV client (e.g. on an Nvidia Shield Pro) can be added against the same API. No Hub work would be redone, and recordings, series links and watch progress carry over.

---

## 11. Sources

- Jellyfin forum: installing web apps on VIDAA (vidaa-edge, DNS method, debug mode no longer works on newer models, DV/codec issues): https://forum.jellyfin.org/printthread.php?tid=10066
- stremio-vidaa-tv (VIDAA browser codec/DRM testing, native-player hand-off, install methods): https://github.com/NoobyGains/stremio-vidaa-tv
- VIDAA WebApp Development Guide (PDF): https://www.vidaa.com/wp-content/uploads/2020/12/WebApp_Development_Guide_for_VIDAA.pdf
- VIDAA content partner programme: https://www.vidaa.com/partners/
- VIDAA app publishing timelines (third-party publisher): https://autopo.st/vidaa-tv-apps/requirements/
- 85U7STUK listing: https://petertyson.co.uk/hisense-85u7stuk
- Sibling U7SE spec sheet (codecs, HDR, eARC, ports): https://www.tvsfaq.com/en/specifications/hisense-55u7se
- TrueHD passthrough discussion on Hisense TVs: https://emby.media/community/topic/142411-true-hd-pass-through/
- AIOStreams / TorBox / Nuvio overview: https://store.elfhosted.com/product-category/stremio-addons/aio-suite
