# UltimateTV: Product & Technical Plan

> Status: **Draft v5** (2026-10-24). Phase 0 (server side) is built. This draft moves the app off the TV and onto a Linux mini PC.
>
> **Update 2026-10-29:** this plan is kept as the record of why things were chosen. For what is built now, see [FEATURES.md](FEATURES.md), [ARCHITECTURE.md](ARCHITECTURE.md) and [ROADMAP.md](ROADMAP.md). Since this draft, profiles with PINs and two Android apps (the phone remote and a watching client) were added, so the "out of scope" line below no longer holds.
> Target display: **Hisense 85" 85U7STUK** (2026 U7 Mini-LED), driven over HDMI by a **Linux mini PC** running our own app.
> North star: **the best picture and sound the TV can show, wrapped in a UI that passes the Wife Acceptance Factor (WAF).**

---

## 1. Goals

| # | Goal | What "done" looks like |
|---|------|------------------------|
| G1 | One app for everything | Live IPTV, Xtream, VOD, Jellyfin, AIOStreams/TorBox and NAS files all live in one home screen and one search. |
| G2 | Sky-grade TV guide | A fast EPG grid with live preview, now/next banner and one-press **Record series**. Recordings appear in a planner. |
| G3 | WAF | Someone who has never seen it can turn the TV on with the Hisense remote, find a show and press play with only the arrow keys, OK and Back. No desktop, no settings screens, no codec talk, no "pick a stream" lists by default. |
| G4 | Best picture & sound | HDR10 / HLG with the TV switching into its HDR modes, the right refresh rate for every film (24p, 50 Hz), Dolby Atmos via Dolby Digital Plus sent untouched to the TV, and a player that plays every file, so playback never just fails. |
| G5 | Own your library | Anything downloaded (TorBox, recordings) lands on the local NAS and shows up in Jellyfin automatically. |
| G6 | Any Linux box | The app installs on any reasonable x86_64 mini PC (arm64 best-effort), so the box can be swapped later without redoing anything. |

**Out of scope for v1:** multi-user profiles with parental PINs (v2), mobile apps (a companion web remote is in Phase 4), casting.

**Decision log**
- 2026-10-24: Gary chose **VIDAA TV only, no box** (ADR 0001).
- 2026-10-24: the Phase 0 probe showed a VIDAA browser page can't receive the arrows, OK or media keys, and the developer-mode install route is blocked on this firmware. Gary switched to **a Linux mini PC plugged into the TV running our own app**, with a **Pulse-Eight USB-CEC adapter** so the Hisense remote drives it (ADR 0002, which supersedes 0001). The Hub design is unchanged.

### 1.1 Household setup (confirmed 2026-10-24)

| Item | Setup | What it means for the plan |
|------|-------|----------------------------|
| Playback device | **A Linux mini PC on HDMI**, left plugged in. Model not chosen yet and may be replaced, so nothing depends on one box | The box runs a locked-down kiosk with our app (§3.4). A probe script checks any candidate box (Phase 0b). |
| Remote | The Hisense remote over **HDMI-CEC**, via a Pulse-Eight USB-CEC adapter | No extra remote on the coffee table. A cheap USB air-mouse remote is the backup (§5.4). |
| Audio | **TV speakers, no soundbar** | The TV decodes Dolby audio. DD+ Atmos is sent untouched and plays as the TV's virtual Atmos. Lossless formats are decoded on the box, which is inaudible on TV speakers. Dialogue clarity and night mode matter more (§7.2). |
| Storage / server | A Linux server running **Proxmox**, with an **Intel N150**, SMB and SFTP shares. **Jellyfin** runs in its own container, **Docker** in another | The Hub runs as a Docker stack in the Docker container (§3.3) and writes recordings and downloads straight to the shared media storage. |
| IPTV | **One connection** on the current plan (the provider sells 4- and 5-connection plans) | One live stream at a time across watching *and* recording. The series link engine is designed around this (§5.3). |

---

## 2. Why a box, not the TV's own apps

Phase 0 tested the TV properly before we committed. Full results are in [phase0/capability-matrix.md](phase0/capability-matrix.md).

| Finding on the 85U7STUK | Consequence |
|-------------------------|-------------|
| A browser bookmark runs in **cursor mode**: the arrows and OK move a pointer, Back is browser history, Guide closes the page. Only colour keys, digits and Info reach a page. | A D-pad TV app is impossible as a bookmark. |
| `hisense://debug` is blocked, the official store is partner-only, and the community app-store route is reported broken on VIDAA OS 9. | No reliable way to install a real app. Any route that does work could break with the next firmware update. |
| The browser is capable (Chromium 111, HEVC, AV1 and DV type strings accepted), but there's no TrueHD/DTS-HD and MKV only plays by URL. | Even if installable, the server would still need to convert files. |

A mini PC removes all of these. It gets every remote key over CEC, plays every file with mpv, switches refresh rate per film, and is ours to update. **What we give up:** Linux can't send a Dolby Vision or HDR10+ signal, so those titles play as HDR10 (§7.1). The TV's own apps (Netflix etc.) are unaffected and still a press of the Home key away.

---

## 3. Architecture

```
                          ┌──────────────────────────── Home network ────────────────────────────┐
  Internet sources        │  ┌──────────────── UltimateTV Hub (Docker on Proxmox) ─────────────┐ │
  ─────────────────       │  │ Source adapters: M3U · Xtream · XMLTV · Jellyfin · Stremio      │ │
  IPTV (M3U)    ───────────▶ │                  addons (AIOStreams URL) · TorBox · NAS files   │ │
  Xtream Codes  ───────────▶ │ Catalog & metadata (TMDB/TVDB match, artwork)                   │ │
  XMLTV EPG     ───────────▶ │ EPG engine (merge, normalise, series IDs)                       │ │
  AIOStreams    ───────────▶ │ Scheduler + Recorder (series link, ffmpeg → NAS)                │ │
  TorBox        ───────────▶ │ Download manager (TorBox → NAS, rename, Jellyfin rescan)        │ │
  TMDB/TVDB     ───────────▶ │ IPTV connection owner (stream sharing between TV and recorder)  │ │
                          │  │ User state · UI hosting · REST/WebSocket API                    │ │
                          │  └───────────────────────────────▲─────────────────────────────────┘ │
                          │                                  │ HTTP / WebSocket on LAN           │
                          │  ┌───────────────────────────────┴─────────────────────────────────┐ │
                          │  │ TV box (Linux mini PC)                                          │ │
                          │  │  KWin (Wayland kiosk, HDR, refresh switching)                   │ │
                          │  │  ├─ UltimateTV shell (Electron): UI from the Hub, cached        │ │
                          │  │  ├─ mpv player (VAAPI decode, HDR passthrough, audio passthrough)│ │
                          │  │  └─ box agent: CEC keys + TV power, display modes, updates      │ │
                          │  └──────────────────┬──────────────────────────────────────────────┘ │
                          │       HDMI (video, audio, CEC via Pulse-Eight)                       │
                          │  Hisense 85U7STUK (TV speakers, DD+ Atmos decoded by the TV)         │
                          │  Jellyfin server (LXC 101) ◀── recordings & downloads                │
                          └──────────────────────────────────────────────────────────────────────┘
```

### 3.1 Why a Hub?

The box changes *who plays*, not why the Hub exists.

- **Recording and series link need an always-on process.** The box sleeps when the TV is off.
- **One IPTV connection.** One process must own the provider connection so the TV and the recorder can share it (§5.3).
- **Speed.** Big XMLTV files (50–200 MB) are parsed once and served as paged JSON.
- **Secrets stay on the server.** Xtream credentials, TorBox and TMDB keys live on the Hub.
- **Swappable boxes.** The box holds no state. A new box only needs the installer and the Hub's address.

### 3.2 Tech choices

| Component | Choice | Reason |
|-----------|--------|--------|
| Hub runtime | **TypeScript (Node + Fastify)** as a Docker Compose stack | Already built in Phase 0. Shares types with the UI in one monorepo. |
| Hub DB | SQLite (WAL) | Single household. Zero ops. |
| Recorder | **ffmpeg** (copy, no re-encode), Quick Sync only for optional jobs | The box plays everything natively, so the Hub rarely converts anything. |
| Box OS | **Arch Linux** on btrfs with automatic snapshots before every update (ADR 0002) | The newest KWin, Mesa and mpv, which is where Linux HDR is improving fastest, plus one-step rollback. Debian 13 is the supported fallback with an older HDR stack. |
| Compositor | **KWin (Plasma 6) Wayland session** with nothing else on screen | The most complete HDR and colour management of any Linux compositor, plus `kscreen-doctor` for refresh-rate and HDR switching. |
| UI shell | **Electron**, full screen, auto-start | Our TypeScript UI with a modern Chromium. Its main process talks to mpv, CEC and the display. *Alternative if Electron misbehaves over HDR video: a Qt/QML shell with the same UI in a WebEngine view.* |
| UI framework | **SolidJS** with a spatial-navigation layer | A mini PC has the power for a DOM UI, which is faster to build and polish than WebGL. Lightning JS is no longer needed. |
| Player | **mpv** controlled over its JSON IPC socket | Plays every container and codec, hardware decode via VAAPI, best-in-class HDR handling (libplacebo), audio passthrough, a large demuxer cache for pause-live. |
| Remote | **Linux kernel CEC** (`pulse8-cec` driver via `inputattach`) with `cec-ctl`, libcec as fallback | Remote keys arrive as ordinary input events. The same link turns the TV on and off with the box. |
| Packaging | One installer script that sets up the OS, plus the app as an Arch package (and a `.deb` for Debian) | Any box goes from blank disk to working app with one command. |
| Metadata | TMDB (films/series), TVDB (episode numbering), Fanart.tv (logos/clearart) | Rich artwork drives the "premium" feel. |
| Design system | Tokens (colour, type, spacing, motion) in one JSON file | One source of truth for the TV UI and the phone setup page. |

### 3.3 Deployment on Gary's Proxmox server

Unchanged from Phase 0 and documented in [phase0/proxmox-setup.md](phase0/proxmox-setup.md).

- **Hub location:** a compose stack in Docker LXC 107, on `HUB_PORT=8095`.
- **Shared media paths:** the Hub mounts `/mnt/nas/video → /mnt/nas` and `/mnt/nas-flexible/video → /mnt/nas2`, which are the paths Jellyfin (LXC 101) uses. A recording the Hub writes is the same file Jellyfin scans.
- **GPU:** `/dev/dri` passthrough for Quick Sync. The host needs a kernel that binds i915 to the N150 (`proxmox-kernel-6.14`). Optional now, because the box decodes everything itself.
- **Jellyfin link:** an API key, and a library refresh after each recording or download.
- **Backups:** the Hub's SQLite database and config live in a Docker volume in the Proxmox backup job.

### 3.4 The TV box

**Boot to app.** The box auto-logs in to a dedicated `tv` user. KWin starts with no panel, no desktop and no notifications, and the only window is the UltimateTV shell. Target: under 15 s from power to Home, and under 3 s from "TV on" when resuming from sleep.

**Power follows the TV.** When the TV turns off, CEC tells the box and it suspends. When someone presses Home or wakes the TV, the box resumes and becomes the active input (CEC One Touch Play). If the box is woken by a scheduled job, it never switches the TV on.

**Two windows, one picture.** mpv draws video in its own full-screen window, and the UI (banner, guide, menus) is a transparent Electron window kept on top by a KWin rule. KWin composites them with HDR handled correctly, so the guide can sit over HDR video. When no overlay is visible, KWin scans the video out directly. Phase 0b confirms this on the real box.

**Display modes.** Before playback the agent sets the refresh rate to match the content (23.976/24/25/50/59.94) with `kscreen-doctor`, and returns the desktop to 4K 50 Hz (UK broadcast cadence) afterwards. HDR stays on in KWin so the UI looks right next to HDR video. The SDR brightness is set once so menus aren't dim.

**The box agent** (Electron main process) exposes a small, typed API to the UI: `play(url, options)`, `seek`, `tracks`, `setMode`, `power`, `cecStatus`. It is the only part that is Linux-specific, so the UI can still be developed and tested in a normal browser with a mock agent.

**Updates.** The UI is served by the Hub and cached on the box, so UI updates are instant and the box still starts if the Hub is down. OS and shell updates install weekly at 4 am, only after a btrfs snapshot. If the app fails its health check after an update, the box rolls back to the snapshot on the next boot.

**Hardware guidance (for this box or the next).** x86_64 with an Intel UHD (Gen 12 or newer, e.g. N100/N150/N305) or AMD Radeon 680M/780M iGPU. That covers HEVC 10-bit and AV1 decode, HDMI 2.0 4K60 with HDR, and LPCM 7.1 / E-AC-3 passthrough. 8 GB RAM, 128 GB SSD, wired Ethernet. If the box only has DisplayPort or USB-C, the HDMI adapter must support HDR and audio. arm64 boxes (e.g. RK3588) are best-effort.

---

## 4. Feature breakdown by source

### 4.1 IPTV (M3U) and Xtream Codes

- **Ingest:** M3U/M3U8 URLs (with `tvg-id`, `tvg-logo`, `group-title`). Xtream via `player_api.php` (`get_live_categories`, `get_live_streams`, `get_vod_streams`, `get_series`, `get_short_epg`, `xmltv.php`).
- **Channel manager (set up once, hidden after):** merge multiple providers, dedupe channels, choose the preferred feed per channel (UHD > FHD > HD), auto-fallback to a backup feed on failure, and **Sky-style channel numbers** (101 BBC One, 102 BBC Two, …) with a UK-preset auto-numbering template.
- **Playback:** the box plays the Hub's relay of the channel. mpv handles MPEG-TS and HLS directly, with deinterlacing for 1080i50 feeds, so there's no repackaging.
- **Catch-up / timeshift:** Xtream `tv_archive` where the provider offers it gives "Start over" and the past seven days in the guide. Checker: [phase0/iptv-catchup.md](phase0/iptv-catchup.md).
- **Connection-limit guard:** the Hub owns the provider connection (currently **one**) and is the only thing that opens streams. When watching and recording the same channel, one upstream stream feeds both. See §5.3.
- **Xtream VOD & series:** pulled into the unified Films / TV libraries with TMDB matching, so they look the same as Jellyfin content.

### 4.2 EPG

- Sources: provider `xmltv.php`, extra XMLTV URLs (e.g. UK feeds such as epg.pw / iptv-org mappings), and per-channel overrides.
- The Hub merges them, normalises time zones, maps `tvg-id` to channel, and enriches programmes with artwork (TMDB lookup by title + year/season/episode).
- **Series identity** (the key to series link): `<episode-num system="dd_progid">`, `xmltv_ns` and `<series-id>` (crid) when present. Otherwise a normalised title + channel group + TMDB series ID.
- Refresh every 6 h, with an immediate refresh on demand. The UI fetches **time windows** (e.g. 4 h × 50 channels) as compact JSON, never the raw XMLTV.

### 4.3 VOD (unified)

- A single **Films** and **TV** library across Xtream VOD, Jellyfin, NAS files and AIOStreams.
- **"One title, many sources":** each title shows once. Behind it the Hub ranks sources (local NAS/Jellyfin first, then debrid, then Xtream) by quality, HDR format, audio format and availability.
- **Box-aware ranking:** mpv plays everything, so ranking is about picture and sound, not compatibility. Because the box outputs HDR10 rather than Dolby Vision, a **DV Profile 5 file (streaming rips) ranks below an HDR10 version** of the same title: P5 has no HDR10 base layer and has to be converted by mpv. P7 and P8 files are fine (they carry an HDR10 base layer). DD+ Atmos is preferred over TrueHD because it reaches the TV untouched.
- WAF mode: **Play** chooses the best source automatically. "More options" reveals the source list for power users.

### 4.4 Jellyfin client

- Auth via Quick Connect (code shown on TV, approve on phone). No typing passwords with a remote.
- Libraries, Continue Watching, Next Up, collections, and two-way progress sync.
- **Direct play everything.** The device profile allows every container, video and audio codec, so Jellyfin streams the original file and the N150 never transcodes for this TV.
- Intro/credits skip via Jellyfin's media segments API.

### 4.5 AIOStreams & TorBox (Stremio/Nuvio-style)

- **AIOStreams** is a Stremio addon aggregator. The user pastes their configured AIOStreams manifest URL (`…/manifest.json`). The Hub speaks the **Stremio addon protocol** (`/catalog`, `/meta`, `/stream`), so any Stremio addon URL works, not just AIOStreams.
- **TorBox:** API key stored on the Hub. Streams resolved by AIOStreams come back as TorBox cached links (direct HTTPS), which mpv plays like any other file.
- **Nuvio-like UX:** TMDB-driven home rails (Trending, Popular, Because you watched…), then **one Play button** picks the best cached stream from the user's quality preferences. Default rule: *"4K HDR10/HDR10+ or DV P7/P8 > DV P5 > 1080p, prefer DD+ Atmos, avoid CAM, max 60 GB"*. Stream lists stay hidden unless asked for.
- AIOStreams can already filter and sort by codec, HDR type and audio format, so most rules live in the AIOStreams config and the Hub only re-checks.
- **Save to NAS:** "Download to library" sends the item to TorBox (if not cached), and the Hub downloads it to the NAS with Jellyfin naming (`/Movies/Title (Year)/…`), then triggers a Jellyfin library scan. Progress shows in a Downloads screen.
- Users are responsible for only accessing content they have the rights to. The app is a generic client and ships with no content sources.

### 4.6 Local NAS files

- Jellyfin already indexes the NAS, so **Jellyfin owns NAS indexing** and the Hub reads from it. That avoids duplicate scanning.
- The "uploaded/downloaded files" inbox is an `/Inbox` share (SMB or SFTP). The Hub auto-renames and moves files into the library structure (FileBot-style rules), then triggers a rescan.

### 4.7 Unified search

- One search box that hits channels, EPG (now and next 7 days), Films/TV across all sources, and recordings.
- Typing with a remote is slow, so the search screen leads with **suggestions** (recent, trending, what's on now) and a large on-screen keyboard. **Phone search** opens the same search on the phone via QR code, and results appear on the TV.
- Result chips: **On now · Upcoming (Record) · Watch now · In your library**.

---

## 5. Sky-style EPG & series link UX

### 5.1 Principles

1. **TV first.** The app opens to Home with a big "Live TV" tile, or straight to the last channel (a setting).
2. **Everything is two presses away.** Guide = one press (Green, or Up from the player). Record series = one press (Red) from anywhere a programme is shown.
3. **Never lose your place.** Back always returns to where you were. The guide reopens on the current channel and time.
4. **Speed is UX.** Guide scrolls at 60 fps and the first paint is under 300 ms from cache.

### 5.2 Screens

**Live player & mini guide (banner)**
- Press OK while watching to show the now/next banner with channel number, logo, title, progress bar, and HDR/Atmos badges.
- Left/right browse *next* programmes on this channel, and up/down browse *other* channels while the current one keeps playing (Sky "mini guide"). OK tunes, Red records.
- Number keys give direct tuning (type "1-0-1"), with the channel name previewed as you type.
- **Back once = previous channel** (Sky behaviour). Back twice = exit to Home.
- **Pause live TV** with a 60-minute buffer held by mpv on the box's SSD. The progress bar shows the buffer.

**Full TV guide (grid)**
- Layout: a **live preview window top-left** (the current channel keeps playing, like Sky Q), programme details top-right, and the grid below with roughly 7 channels × 2 hours visible.
- Category tabs across the top: *All · Favourites · Entertainment · Films · Sport · News · Kids · UHD*.
- Red dot = recording, stacked dots = series link, and a "↺" icon for catch-up available.
- Fast travel: day jump (a date strip, or Rewind/Fast-forward keys), "Now" jump, and channel-number jump.
- Past programmes with catch-up show a **Play from start** button.
- Rendering: only visible cells are drawn (virtualised grid), so hundreds of channels stay smooth.

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
- **Robustness:** track schedule drift. If a programme moves within ±60 min (EPG update), move the recording. If a live stream drops, reconnect (and fall back to the backup feed). The recording is marked "incomplete" and the episode is re-scheduled if it repeats within 7 days.
- **Working with one IPTV connection** (current plan). One connection means one live channel at a time, so the engine uses these strategies in order:
  1. **Record from catch-up instead of live.** If the channel has `tv_archive`, the recording is fetched from catch-up after it airs, while nobody is watching (overnight by default). Live viewing is untouched.
  2. **Share the stream.** If you're watching the channel that's recording, the Hub sends the same stream to the box and the recorder.
  3. **Use a repeat airing** (e.g. +1 channel or a later showing) when one fits around what's being watched.
  4. **Ask, Sky-style.** Only when none of the above work: "*Silent Witness is recording on BBC One at 9pm. Switching channel will stop the recording. Switch anyway?*" A recording in progress is never stopped silently.
- **Conflicts between recordings** use the same order. Upgrading the IPTV plan to 4–5 connections removes almost all of this, and the engine needs no change because the connection count is a setting.
- **Post-processing:** remux TS → MKV, optional ad-break chapters (comskip), write an NFO, place in `/Recordings/Series/Season NN/` and trigger a Jellyfin scan. Recordings are therefore also watchable from any Jellyfin client.
- **Reminders:** a toast on the TV 2 min before, with "Watch now" / "Dismiss". If the box is asleep, the reminder waits; it never turns the TV on by itself.

### 5.4 Remote mapping (target)

The Hisense remote's keys reach the box over HDMI-CEC as standard key events. Which keys a TV forwards over CEC varies, so Phase 0b records exactly what this TV sends.

| Key | Action |
|-----|--------|
| Arrows / OK | Navigate / select, show banner |
| Back | Back / previous channel |
| Green (or Guide, if forwarded) | TV guide |
| Red | Record (long-press = record series) |
| Yellow | Options (audio, subtitles, source) |
| Blue | Planner |
| Numbers | Direct channel entry |
| Ch +/– | Zap (if forwarded) |
| Play/Pause, Stop, Rewind, Fast forward | Playback and pause live |
| Volume, Mute | Handled by the TV itself (TV speakers) |

Every action is also reachable from the on-screen **Options** menu, so a key the TV doesn't forward never blocks anything. The app never needs a mouse or keyboard. A USB air-mouse remote with a D-pad is the backup if CEC ever misbehaves.

---

## 6. WAF design system

- **Look:** dark, cinematic, artwork-led, with big type (minimum 28 px body at 10 ft on 85"). One accent colour and a subtle glass/blur on overlays.
- **Focus:** a clear scale+glow focus ring that never jumps unpredictably. Remember focus per row.
- **Home layout:** a hero (Continue watching / what's on now) followed by rails: *Live now · Continue watching · Recently recorded · Next up · Films for tonight · New on TorBox*. The order is customisable and **the default is opinionated**.
- **Never a computer:** no desktop, cursor, notifications, update prompts or boot text are ever visible. Boot shows a branded splash, and errors show a friendly screen with a way back.
- **Zero jargon:** no "M3U", "codec", "transcode" or "debrid" outside Settings → Advanced. Badges use friendly labels ("4K", "HDR", "Atmos").
- **Guardrails:** a confirm step for deleting recordings or cancelling series links, undo toasts, and no dead ends (every error screen has "Try another source" / "Back to guide").
- **Speed budget:** under 3 s from waking the TV to Home, channel zap under 1.5 s, guide open under 300 ms, focus move under 16 ms.
- **Quiet onboarding:** one wizard for sources (scan a QR code → paste URLs/keys in a phone web form served by the Hub), Jellyfin Quick Connect, and a channel-numbering template. Done in five minutes, never seen again.
- **Usability test:** before each phase ships, the WAF tester gets 5 tasks with no help ("Watch BBC One", "Record every episode of X", "Carry on the film you were watching", "Find a comedy film in 4K", "Delete a watched recording"). The pass mark is five out of five without asking.

---

## 7. Picture & sound on the mini PC

### 7.1 Picture

| Capability | How the app uses it |
|------------|---------------------|
| **HDR10** | Passed through: mpv tells KWin the video's colour space and mastering metadata (`target-colorspace-hint`), KWin sends HDR10 over HDMI, and the TV switches into its HDR picture modes and does its own tone mapping. |
| **HLG** | Live UHD sport. Passed through if KWin supports HLG output on the box's version, otherwise mpv converts it to HDR10 with no visible loss. Phase 0b checks which. |
| **Dolby Vision** | **Not available as a DV signal on Linux**, so the TV shows HDR10. P7 and P8 files play their HDR10 base layer, which looks the same as the HDR10 Blu-ray. P5 files (no HDR10 base) are converted to HDR10 by mpv, which is correct but uses static tone mapping, so ranking prefers another version (§4.3). |
| **HDR10+** | Also not signalled on Linux. The video plays as HDR10. The TV's own Adaptive mode still adjusts for room light. |
| **Frame rate** | Switched per title (§3.4): 23.976p films play at 23.976 Hz with no judder, UK TV at 50 Hz. `display-resample` smooths the rare mismatch. |
| **Interlaced IPTV** | 1080i50 feeds are deinterlaced on the box's GPU to 50p (mpv `bwdif`), which beats most TVs' own deinterlacing. |
| **Upscaling** | The box outputs 4K always and mpv upscales SD/HD with high-quality scalers. If the TV's AI upscaler looks better on IPTV, a setting sends 1080p for SD/HD channels instead. Judged by eye in Phase 1. |
| **Output format** | 10-bit RGB full range when HDR is on, which KWin handles. Checked in Phase 0b with the TV's signal info overlay. |
| **Picture mode guidance** | First-run tip: Filmmaker Mode for films, motion smoothing off for film content. The app can't change TV picture settings, so it guides. |

### 7.2 Sound

| Capability | How the app uses it |
|------------|---------------------|
| **Dolby Atmos (DD+ JOC)** | **Passed through untouched** over HDMI (mpv `audio-spdif=ac3,eac3`). The TV decodes it and plays its virtual Atmos. This is the main Atmos path, and the TV's own audio info should show Dolby Atmos. |
| **AC-3 / DD 5.1** | Passed through untouched. |
| **TrueHD / DTS-HD MA / DTS:X** | Decoded on the box to multichannel PCM, which the TV downmixes to its speakers. Atmos height in TrueHD is lost, which TV speakers can't render anyway. If a soundbar is ever added, passthrough is one setting. |
| **DTS core** | Passed through if the TV's HDMI audio info (ELD) says it accepts DTS, otherwise decoded to PCM. |
| **Track choice** | Auto-select the best track (DD+ Atmos > DD+ 5.1 > TrueHD/DTS-HD > AC-3 > stereo, in the user's language). Remember per-show overrides. |
| **Night mode** | One toggle in Options: mpv decodes the audio and applies dynamic range compression with dialogue lifted. This forces PCM output, so Atmos is off while it's on. |
| **Volume** | The TV owns volume (CEC). The box always outputs at 100% so volume and mute stay on the TV remote. |

### 7.3 Box probe (Phase 0b)

`tools/box/probe.sh` runs on any candidate box and writes a report: OS, CPU and GPU, hardware decode profiles (`vainfo`), versions of KWin, Mesa and mpv, the TV's EDID (HDR formats, refresh rates, audio formats), HDMI audio ELD, and the CEC adapter's status. A short manual checklist then confirms the things only a person can see: the HDR badge, judder-free 24p, Atmos on the TV's audio info, and every remote key over CEC. See [phase0/box-probe.md](phase0/box-probe.md).

---

## 8. Phased roadmap

**Current status:** [ROADMAP.md](ROADMAP.md). **Status (2026-10-24):** Gary asked for the whole app to be built ahead of testing on the real hardware. The code for phases 1 to 5 is written and tested against a demo Hub in a browser: Hub, TV UI, box shell and installer, profiles with a Kids lock, and a phone remote (web and Android, added because the CEC adapter is a week away). Nothing has run on the box or with the real IPTV yet; [TESTING.md](TESTING.md) is the test run.

| Phase | Name | Scope | Exit criteria |
|-------|------|-------|---------------|
| **0** | Server spike & TV probe ✓ | Monorepo, Hub skeleton in Docker on Proxmox, test-clip generator, IPTV catch-up checker, VIDAA capability probe. | Done. VIDAA ruled out as the client (§2). |
| **0b** | Box bring-up (1–2 wks) | Box probe script. Installer: Arch + KWin kiosk session, autologin, mpv, CEC (`inputattach`), btrfs snapshots, splash. Prove on the real box: HDR10 switch, 24p switch, Atmos passthrough, CEC keys and TV power, transparent UI over HDR video, boot time. Server side: N150 iGPU kernel and the IPTV catch-up test. | A probe report and checklist showing every item works (or a documented fallback), and a box that boots straight into a test page. |
| **1** | Hub core + Live TV MVP (3–4 wks) | Hub: M3U/Xtream/XMLTV ingest, channel manager, EPG API, stream relay. Box: Electron shell, box agent, mpv control. UI: Home, live player, mini guide banner, number tuning, previous channel, full guide grid with live preview, pause live. | Watch live TV and use the guide daily. First WAF test (watch channel / use guide). |
| **2** | Recording & series link (3–4 wks) | Scheduler, ffmpeg recorder to NAS, series link engine, conflicts, Planner screen, catch-up / start over, Jellyfin rescan hook. | A week of series links recorded without misses. WAF test (record series / play recording / delete). |
| **3** | Unified VOD (3 wks) | Jellyfin client (Quick Connect, direct play, skip intro), Xtream VOD/series, TMDB metadata, "one title many sources", per-title refresh rate, track selection, Continue Watching across sources, unified search with phone search. | Films/TV feel like one library, and no title fails to play. WAF test (continue film / find 4K comedy). |
| **4** | AIOStreams, TorBox & NAS pipeline (3 wks) | Stremio addon protocol, AIOStreams URL, TorBox API, best-stream selection, Download to NAS with renaming + Jellyfin scan, Downloads screen, phone setup/remote page. | One-press play from discovery rails. A downloaded film appears in the library automatically. |
| **5** | Polish & WAF hardening (ongoing, 2–3 wks) | Motion design, artwork everywhere, skeleton loading, error recovery, performance budgets, profiles (adult/kids), screensaver with artwork, backup/restore, automatic box updates with rollback, a second-box install test. | All 5 WAF tasks pass unaided. Crash-free for 30 days. |

Durations assume one developer working part-time with AI assistance. Phases 3 and 4 can swap if streaming discovery matters more than Jellyfin.

### 8.1 Repo layout

```
UltimateTV/
├── docs/            # this plan, ADRs, Phase 0 guides and results
├── design/          # tokens, screen specs
├── shared/          # TypeScript API types & models (Hub, UI, box)
├── hub/             # Node/Fastify server, ffmpeg workers, Dockerfile + docker-compose.yml
├── ui/              # the TV UI (SolidJS), served by the Hub
├── box/             # Electron shell + box agent (mpv, CEC, display modes), packaging
└── tools/
    ├── box/         # box probe and installer scripts
    ├── probe/       # VIDAA browser probe (Phase 0, kept for reference)
    ├── clips/       # test-clip generator
    └── iptv/        # catch-up checker
```

### 8.2 Engineering practices

- ADRs in `docs/adr/` for each major decision.
- CI with GitHub Actions: typecheck and test everything, build the Hub image, build the box package, and lint the shell scripts.
- Golden-file tests for M3U/Xtream/XMLTV parsing, series-link matching and source ranking (the riskiest logic).
- The UI runs in a normal browser against a mock box agent, so screens get screenshot tests in headless Chromium.
- Releases: the Hub image carries the built UI, so updating the Hub updates the TV. The box package changes rarely.

---

## 9. Risks & open questions

| Risk / question | Mitigation |
|-----------------|------------|
| **Transparent UI over HDR video doesn't composite cleanly** | Phase 0b tests it first. Fallbacks: the UI as an mpv overlay (mpv draws the banner itself), or switching HDR off while menus are open. |
| Hisense doesn't forward some keys over CEC (often Guide, Ch ±, media keys) | Green opens the guide, Options covers every action, and an air-mouse remote is the backup. Phase 0b records exactly what arrives. |
| No Dolby Vision / HDR10+ output on Linux | Accepted with the box choice. HDR10 is the base of nearly all DV and HDR10+ releases, and the TV's own tone mapping still applies. DV P5 sources rank lower. |
| A rolling distro update breaks something | Updates only after a btrfs snapshot, at 4 am, with an automatic rollback when the app's health check fails. Debian 13 is the fallback if Arch ever proves too lively. |
| The box's HDMI output or adapter lacks HDR or audio passthrough | The probe catches it before any building starts. §3.4 lists what to look for in a replacement. |
| N150 Hub load | Much lower than planned for VIDAA, because the box plays the originals. The Hub mostly copies streams. |
| Jellyfin in a separate Proxmox container | Both containers see the same media folders at the **same paths** (§3.3). |
| **One IPTV connection** | Catch-up-based recording, stream sharing and repeat airings (§5.3). A 4–5 connection plan is the easy fix if clashes annoy. |
| XMLTV quality for UK channels | Multiple EPG sources per channel with priority, plus a manual mapping UI. |
| Legal/content | The app is a neutral client. Sources and credentials are user-supplied, and no content or addon URLs are bundled. |

---

## 10. Sources

- Phase 0 results for this TV: [phase0/capability-matrix.md](phase0/capability-matrix.md)
- KWin HDR and colour management (Xaver Hugl's blog): https://planet.kde.org/xavers-blog-2023-12-17-an-update-on-hdr-and-color-management-in-kwin
- KWin HLG playback bug: https://bugs.kde.org/show_bug.cgi?id=508817
- mpv and Plasma tone mapping discussion: https://discuss.kde.org/t/does-plasma6-2-tone-mapping-affect-mpvs-tone-mapping/25190
- Linux kernel CEC documentation (Pulse-Eight via `inputattach`): https://docs.kernel.org/admin-guide/media/cec.html
- Pulse-Eight kernel driver notes: https://docs.kernel.org/4.18/_sources/media/cec-drivers/pulse8-cec.rst.txt
- VIDAA WebApp Development Guide (PDF): https://www.vidaa.com/wp-content/uploads/2020/12/WebApp_Development_Guide_for_VIDAA.pdf
- 85U7STUK listing: https://petertyson.co.uk/hisense-85u7stuk
- AIOStreams / TorBox / Nuvio overview: https://store.elfhosted.com/product-category/stremio-addons/aio-suite
