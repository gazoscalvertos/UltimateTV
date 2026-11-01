# Architecture

How UltimateTV fits together as of 2026-10-29 (main at PR #60). [PLAN.md](PLAN.md) has the reasoning behind the choices; this page describes what is built.

## The pieces

```
                 Internet: IPTV (M3U / Xtream + XMLTV), TMDB, OMDb, OpenSubtitles, AIOStreams /
                 Stremio addons, TorBox, YouTube (yt-dlp), GitHub (update checks), Spotify, Deezer
                                              │
┌────────────────────────────── Home network ─┼────────────────────────────────────────────────┐
│                                             ▼                                                │
│  ┌──────────── Hub (Docker LXC 107, 192.168.0.19:8095) ────────────┐   ┌─ Jellyfin (LXC 101)┐│
│  │ Fastify + SQLite (node:sqlite), one process                     │◀─▶│ library, Quick     ││
│  │ ingest · EPG · channels · IPTV connection guard · stream relay  │   │ Connect, rescans   ││
│  │ recorder · scheduler · series link · catch-up                   │   └────────────────────┘│
│  │ unified library · search · ranking · NAS downloads              │          ▲              │
│  │ profiles · pairing · queue · progress · settings                │          │ same paths   │
│  │ music video channels (yt-dlp, cropdetect) · scares · notify     │   ┌──────┴─────────────┐│
│  │ diagnostics · self-update · trip move-out / move-in             │──▶│ NAS /mnt/nas,      ││
│  │ serves: /app/ (TV UI) · /remote/ · /setup/ · APKs · /api · ws   │   │ /mnt/nas2          ││
│  └───────────▲──────────────────────▲──────────────────▲───────────┘   └────────────────────┘│
│              │ HTTP + /api/events   │ HTTP (paired)    │ HTTP (paired)                       │
│  ┌───────────┴─── TV box ─────────┐ │                  │                                     │
│  │ Arch, KWin Wayland kiosk       │ ┌┴────────────────┐ ┌┴────────────────────────────┐       │
│  │ Electron shell (box/)          │ │ Phone remote    │ │ Android app (client)        │       │
│  │  ├ TV UI (ui/, from the Hub)   │ │ web app /remote/│ │ Kotlin, Compose, Media3     │       │
│  │  ├ mpv over JSON IPC           │ │ + Android shell │ │ watches + downloads at home │       │
│  │  ├ display modes, HDR, audio   │ └─────────────────┘ └─────────────────────────────┘       │
│  │  ├ CEC (Pulse-Eight), updates  │                                                         │
│  │  ├ box downloads, diagnostics  │   Home Assistant / scripts ──X-Api-Key──▶ /api/notify    │
│  │  └ go-librespot, Deezer view   │   ↳ and /api/ha/state, /api/ha/command, webhook events   │
│  └───────────┬────────────────────┘                                                         │
│              │ HDMI (picture, sound, CEC)                                                    │
│        Hisense 85U7STUK                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Part | Folder | Runs on | Built with |
|------|--------|---------|------------|
| Hub | `hub/` | Docker on the Proxmox Docker LXC (or on the box during a trip) | Node, TypeScript, Fastify 5, `@fastify/websocket`, `node:sqlite`, ffmpeg, yt-dlp |
| TV UI | `ui/` | Inside the box's Electron window, served by the Hub at `/app/` | SolidJS, Vite, spatial focus (`focus.ts`) |
| Box shell | `box/` | The TV box, as the `tv` user in a KWin kiosk session | Electron 44, mpv JSON IPC, `kscreen-doctor`, `cec-ctl`, WirePlumber |
| Shared code | `shared/` | Imported by all three above | Domain types, key map, stream ranking, themes, music, screensaver and weather helpers |
| Phone remote | `hub/public/remote/`, `android/app/` | Any phone browser; the Android app wraps it in a WebView | Plain HTML/JS PWA; Java WebView shell with speech and code scanning |
| Setup page | `hub/public/setup/` | Any browser on the home network | Plain HTML/JS |
| Android app | `android/client/` | Android phones and tablets | Kotlin, Jetpack Compose, Media3 ExoPlayer (+ Jellyfin ffmpeg audio decoder) |
| Tools | `tools/` | Box installer, PXE server, Hub update and travel scripts, screenshot capture, Phase 0 probes | Bash, Docker, iPXE, Playwright |

## The Hub

One Node process owns everything that has to be always on or has to be shared. Its state lives in SQLite (`hub/src/db.ts`, rows keep their object as JSON with indexed columns beside it) in the `data` volume, along with art, scare clips, logs and the pairing key. Settings and secrets (IPTV logins, Jellyfin token, TorBox and TMDB keys) never leave the Hub; the TV and phones only ever see redacted settings.

| Area | Modules | What they do |
|------|---------|--------------|
| Sources | `ingest/m3u.ts`, `ingest/xtream.ts`, `ingest/xmltv.ts`, `channels.ts`, `epg.ts` | Read playlists and XMLTV (streamed with `sax`), merge duplicate channels into one channel with ranked feeds, normalise names, map EPG ids, quality badges |
| Live TV | `connections.ts`, `relay.ts`, `streaming.ts`, `catchup.ts` | The **connection guard** leases the provider's stream slots (one on Gary's plan) across viewing, recording, catch-up and VOD. The relay opens one upstream per channel and fans it out to the box and the recorder, falling back to the next feed when one drops |
| Recording | `scheduler.ts`, `recorder.ts`, `serieslink.ts`, `recordings.ts` | Timers, series links matched on series keys, clash handling against the connection limit, ffmpeg stream copy to the NAS, Jellyfin rescans |
| Films & TV | `library.ts`, `services/jellyfin.ts`, `services/stremio.ts`, `services/torbox.ts`, `services/tmdb.ts`, `services/omdb.ts`, `shared/src/ranking.ts` | One title however many places it lives, home rails, search, the ranked Versions list (library first), and each title's trailer, scores and More like this (`/api/titles/:id/extras`) |
| Subtitles | `subtitles.ts`, `services/opensubtitles.ts` | Searches OpenSubtitles by IMDb or TMDB id, downloads a file once and serves it to mpv |
| Downloads | `services/downloads.ts`, `/api/offline` | Save to NAS (TorBox/AIOStreams to Jellyfin naming, then a Jellyfin rescan), the SMB/SFTP Inbox tidy, and offline copies for the Android app and the box |
| People | `profiles.ts`, `pairing.ts`, `progress.ts`, `queue.ts`, `guides.ts` | Profiles with PINs and the Kids filter, paired devices and the API key, resume points, the household play queue, custom guides |
| Music channels | `mixchannels.ts`, `ytdlp.ts`, `mixseeds.ts`, `cropdetect.ts`, `nasvideos.ts` | Made-up live channels of music videos downloaded with yt-dlp (or linked from the NAS), shuffled schedules, black-bar detection |
| On-screen extras | `notify.ts`, `scares.ts`, `screensaver.ts`, `voice.ts`, `musiclogin.ts`, `weather.ts` | Pop-ups and breaking news, jump scares, screensaver photos, voice commands, the Deezer phone login hand-off, the Open-Meteo forecast |
| Running it | `diagnostics.ts`, `log.ts`, `stats.ts`, `system.ts`, `selfupdate.ts`, `move.ts`, `lan.ts`, `reports.ts` | Box and Hub logs and playback samples, the stats page, update checks against GitHub, updates from the phone, taking the Hub on a trip |

`hub/src/server.ts` holds the routes. Control routes are listed in its `NEEDS` table (a paired screen, any paired device, or the API key) and `ADMIN_ROUTES` (anything that changes the setup or deletes things, which also needs an adult profile and its PIN).

## The TV box

The box holds no household state, so a new one only needs the installer and the Hub's address.

- **Session:** SDDM logs the `tv` user straight into a KWin Wayland session with no panel; the only window is the Electron shell (`tools/box/files/kwinrc`, `kwinrulesrc`).
- **Two windows, one picture:** mpv draws video in its own full-screen window underneath; the Electron window is transparent and the UI cuts a hole where the video shows (`box/src/main.ts`, `mpv.ts`, `player.ts`).
- **Display:** `display.ts` sets the refresh rate per title with `kscreen-doctor` (adding a reduced-blanking custom mode at a whole multiple of 24p when the screen has none), switches HDR for HDR video, and keeps the output at scale ×1.
- **Sound:** `audio.ts` moves the sound card to the connected HDMI output; mpv passes Dolby and DTS through (`--audio-spdif`).
- **Remote:** the Pulse-Eight adapter is attached by `inputattach` (a udev rule and `ultimatetv-cec-attach@.service`); the kernel turns its keys into key presses with `cec-keymap.toml`, and `cec.ts` registers the box, wakes the TV, and watches for standby and the TV switching input.
- **Hub down:** the shell shows a "Can't reach the Hub" page and keeps retrying. The UI is loaded from the Hub each time, not cached.
- **Extras:** `downloads.ts` (Download to box), `spotify.ts` (go-librespot as a Spotify Connect speaker), `webapp.ts` (Deezer's web player in a view over the UI with arrow-key focus), `diagnostics.ts` (log and playback samples to the Hub), `updates.ts` (version checks and Settings › About › Update the box).
- **Updates:** a weekly systemd timer (Monday 4 am) takes a snapper snapshot when the root is btrfs, upgrades the OS, pulls the app and reruns the installer (`tools/box/update.sh`). A health check (`healthcheck.sh`) then waits for the app's heartbeat, the Hub, an mpv test clip and the CEC adapter, and on a failure `rollback.sh` undoes the update from the snapshot, reboots and skips that commit. The results sit in `/var/lib/ultimatetv/update`, which the box app reports to the Hub (Settings › About, the phone, alerts, diagnostics).
- **Install:** `tools/box/install.sh` on a fresh Arch (or Debian 13), or unattended over PXE from `tools/pxe` on the Docker LXC.

## Data flow

**Watching live TV.** The UI asks the Hub to play a channel (`POST /api/play`). The Hub takes a lease from the connection guard (asking first if a recording or another screen holds it), and returns a URL on its own relay. The box hands that URL to mpv, sets the display mode and reports progress. If a feed drops, the relay switches to the channel's next feed without the box noticing.

**Recording.** The scheduler wakes for each timer, takes a `record` lease, reads the same relay session if the channel is already being watched, and ffmpeg copies the stream into the recordings folder on the NAS. When it finishes, Jellyfin is told to rescan. Series links create new timers as the EPG refreshes.

**Films and TV.** `library.ts` merges a title's Jellyfin item, IPTV VOD entries and addon streams. `ranking.ts` orders them (library first, then quality). Jellyfin plays direct from Jellyfin; IPTV VOD goes through the Hub's proxy so it holds a lease; TorBox links play direct. Resume points go back to the Hub and to Jellyfin.

**Remote keys.** CEC keys arrive on the box as ordinary key presses. The phone remote sends `POST /api/remote/key`; the Hub checks the phone is paired and pushes the key to the TV over `/api/events`. Richer phone actions (Watch, Now Playing, Save, queue) are calls into the TV app: `POST /api/tv/call/:method` becomes a `tv.call` event, and the TV answers on `/api/tv/reply/:id`.

**Events.** `/api/events` is a websocket that only the TV may open. The Hub uses it for keys, pop-ups, breaking news, scares, settings and queue changes, recording updates and update status.

**Downloads.** Save to NAS runs on the Hub and ends up in Jellyfin. Download to box and the Android app's downloads both ask the Hub for an offline copy (`POST /api/offline`) and fetch the file themselves; Kids see only what their profile allows.

**Trips.** `tools/hub/travel.sh away` builds a second Hub on the box from `docker-compose.box.yml`, pulls the home Hub's data (`/api/hub/move-out`) and the music videos, and points the TV at it. The home Hub stands by so the two never share the IPTV connection. `travel.sh home` sends the data and new files back (`/api/hub/move-in`).

## Health and auto-restart

`GET /api/health` answers with the version and build beside `ok`, `status` (`ok` or `degraded`), a
`checks` object and plain-sentence `reasons` (`hub/src/health.ts`, #96):

| Check | What it does | Why it can go red |
|-------|--------------|-------------------|
| `db` | Runs `SELECT 1` on the SQLite database | The database is locked or its file is gone |
| `disk` | Free space on the volume holding `DATA_DIR`, via `statfs` | Under 2 GB free: recordings and art have nowhere to go |
| `scheduler` | How long since the recording loop last ticked (`Scheduler.lastTickAt`) | No tick for two minutes while the loop is running and nothing is recording |
| `dataDir` | Writes and deletes a temporary file in `DATA_DIR` | The data volume is read-only or full, so settings can't be saved |

It never throws and answers in well under a second: a check that fails becomes `ok: false` with a
reason, not a 500. The route always answers **200**, because the TV app, the update scripts and CI
all read the body (the version and commit) whether the Hub is well or not; `ok` is what a watchdog
reads. Only faults a restart can fix make it unhealthy: an unmounted recording share is a job for
the alerts page, not for a restart loop.

The image declares a `HEALTHCHECK` in the `Dockerfile` that runs `node` (the slim image has no curl)
against `127.0.0.1:$PORT/api/health`, so `docker ps` shows `healthy`/`unhealthy`. Docker does not
restart an unhealthy container by itself. To get that, start the opt-in `autoheal` service that
`docker-compose.yml` defines:

```bash
docker compose --profile autoheal up -d autoheal
```

It watches containers carrying the `ultimatetv-autoheal` label (the Hub has it), and restarts one
that has been unhealthy for around a minute and a half. It's off by default: on a fault only a
person at home can fix (a full disk, a NAS that isn't mounted) a restart every half minute would
only make the logs harder to read. `restart: unless-stopped` on the Hub still covers the case that
matters most, the process dying or the machine rebooting.

**Restarts are counted, and an alert says when they repeat.** Each time a real Hub starts it adds
its boot time to `hub-boots` in the database (`hub/src/restarts.ts`); `DEMO=1` doesn't count, since
it's restarted freely while the app is being worked on. The list lives in the database rather than in
memory because the restart worth noticing is the one that wipes the process that would have
remembered it. Boots older than six hours are dropped as the next one is written. Three restarts
inside six hours raise **The Hub keeps restarting** through the usual alerts path, so it goes to the
Home Assistant webhook or ntfy like the others, and to the card on the TV; it becomes `bad` at six
restarts, and clears by itself once they age out of the window. That covers #96's third criterion,
which used to be a note on this page.

Two deliberate limits:

- **A recording is never cut off.** While the recorder has a recording running, a scheduler that
  looks late doesn't make the Hub unhealthy (the recorder's own loop reconnects); only a fault the
  recording can't survive anyway (the database not answering) still does.
- **The restart count says when something is wrong, not what.** It's a prompt to look: the reasons
  are the `reasons` on `/api/health`, the entries in `data/logs/hub.log`, and
  `docker inspect ultimatetv-hub --format '{{.RestartCount}}'` for what Docker has seen. The Hub's
  uptime is in Settings › About.

## Security model

- Everything stays on the home network: the Hub is not exposed to the internet, and the Android app only works at home (by choice, see [android-client.md](android-client.md)).
- Phones and screens pair by scanning a code on the TV ([pairing.md](pairing.md)). Browsers keep an HttpOnly cookie, the Android apps send `X-Device-Token`, and Home Assistant uses `X-Api-Key` for pop-ups, news flashes, keys and the media player (`/api/ha/state`, `/api/ha/command`) only. The TV reports playback to `/api/ha/state` and the Hub posts playback events to a webhook (`homeassistant.ts`).
- Adult-only routes (settings, Save to NAS, deleting things) check the profile; Kids never get Settings, Music, scares or downloads they aren't allowed.
- Logs and diagnostics cut URLs to their host, so IPTV logins and API keys never appear.

## Build and CI

An npm workspaces monorepo (`shared`, `hub`, `ui`, `box`, `tools/*`). `npm run typecheck && npm test` runs Vitest over all of it. GitHub Actions (`.github/workflows/ci.yml`) also builds and smoke-tests the Hub image, builds the PXE server image, checks the installer's files, and builds both Android APKs, which the Hub then serves at `/api/remote/app.apk` and `/api/client/app.apk`. There is no Android SDK in the cloud sessions, so CI is the only Android compiler.

**Dependency updates.** `.github/dependabot.yml` asks Dependabot for one batch a week (Mondays), grouped so a week's bumps arrive as one pull request per ecosystem rather than one per package: npm at the repo root (all the workspaces), Gradle under `android/` (both apps), the actions used in `ci.yml`, and the base images of the Hub `Dockerfile` and `tools/pxe/Dockerfile`. Each PR still goes through the normal CI run before it merges; there is no auto-merge.

**yt-dlp updates itself.** YouTube breaks old downloaders often enough that a pinned version would only be a way to be out of date. The Hub image does not pin one: the `Dockerfile` adds the release build of `yt-dlp_linux` from the `latest` release at build time, and the Hub then updates it once a day at runtime (`YtDlp.update()` runs `yt-dlp -U`; `mixchannels.ts` starts it and repeats every 24 hours), also showing the version it has in Settings › Music channels. On the box, `tools/box/install.sh` installs yt-dlp from the distro (Arch or Debian), so the weekly box update refreshes it with everything else. Nothing in the repo pins a yt-dlp version, so there is no version to check in CI. If YouTube starts asking it to sign in, extra arguments go in `YTDLP_ARGS` in the Hub's `.env` ([music-channels.md](music-channels.md)).
