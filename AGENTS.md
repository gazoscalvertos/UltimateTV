# AGENTS.md

Guidance for AI agents (Claude Code, Codex, Copilot and the like) working on UltimateTV. It tells you what the product is, how it is put together, what it is built to feel like, and how to change it without breaking the household's evening. It links to the detailed docs rather than repeating them; read the one for the area you are touching before you edit.

## What this is

UltimateTV is a Sky-style TV experience for one household, built to **pass the wife acceptance factor**: it has to be as easy and as pleasant as a commercial set-top box, with no setup screens, jargon or surprises on the sofa. It pulls live IPTV with a full guide and recording, films and TV from Jellyfin, Plex or Emby, add-on and debrid streams, music and games into one interface, controlled by a TV remote.

Target setup: a Hisense 85U7STUK, a Linux mini PC (GMKtec NucBox K7 Plus) plugged in over HDMI, a Proxmox home server running the Hub, and a NAS. The same app also runs on the owner's other screens (see Clients).

Start with [README.md](README.md), then [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (what is built), [docs/FEATURES.md](docs/FEATURES.md) (what it does), [docs/ROADMAP.md](docs/ROADMAP.md) (what has been tested on real hardware), [docs/PLAN.md](docs/PLAN.md) (original reasoning, **historical**; where it disagrees with ARCHITECTURE or an ADR, the newer one wins) and [docs/adr/](docs/adr/) (decisions and why).

## Architecture in one page

One **Hub** holds all state and logic. Everything a person looks at is a **client** of the Hub. Clients are thin: they show screens, take remote keys and play video; the Hub decides.

```
Internet sources ─▶ Hub (Node/TS, Fastify, SQLite, port 8095, Docker LXC 107) ─▶ NAS, Jellyfin/Plex/Emby
                      │  HTTP + /api/events websocket
      ┌───────────────┼──────────────┬──────────────┬─────────────────┐
   TV box          Phone remote    Android /     Samsung / LG      Desktop (Win,    PS5 title
 (Electron+mpv)    (web, /remote/) Fire TV app   TV apps          Mac, Linux)      (EVO engine)
```

### The Hub (`hub/`)
- Node 22+, TypeScript, Fastify 5, `node:sqlite`, ffmpeg, yt-dlp. One process, listening on **port 8095** in Docker on the home server (compose at the repo root; the container's own port is 8080, which is taken on that LXC).
- Owns the IPTV connection guard (the provider allows few simultaneous streams; viewing, recording, catch-up and VOD all lease from it), the stream relay, EPG, recorder and scheduler, the unified library and ranking, profiles and PINs, pairing, the play queue, progress, settings and secrets.
- Secrets (IPTV logins, media-server tokens, API keys) never leave the Hub. Logs and diagnostics cut URLs to their host.
- Serves the TV UI at `/app/`, the phone remote at `/remote/`, the setup page at `/setup/`, TV app screens at `/tv/samsung/` and `/tv/lg/`, APKs, and the `/api` routes plus the `/api/events` websocket.
- **Every write route must declare its auth** in `hub/src/server.ts` (`NEEDS`, `ADMIN_ROUTES` or `PUBLIC_WRITE_ROUTES` with a written reason). `node tools/hub/route-auth.mjs --check` and `hub/test/routes.test.ts` fail a route that does not.
- `DEMO=1 npm run dev:hub` runs a Hub full of demo channels, films and recordings; use it for UI work and tests.

### Shared code (`shared/`)
Types, key map, stream ranking, themes, Kids filter rules (`limited.ts`, `kidsallow.ts`), screensaver and weather helpers. Anything the Hub, TV UI and box must agree on lives here once. Do not duplicate rules in two places.

### Clients
| Client | Folder | Notes |
|---|---|---|
| **TV UI** | `ui/` | SolidJS, spatial focus (`ui/src/focus.ts`), remote-key driven. Loaded from the Hub each time, never cached. This is the **reference design**. |
| **Linux box shell** | `box/` | Electron 44 (transparent window) over mpv driven by JSON IPC, in a KWin Wayland kiosk on Arch. Per-title refresh rate, HDR, Dolby passthrough, Pulse-Eight USB-CEC remote, weekly self-update with btrfs snapshot and automatic rollback. Shows its own "limited mode" page when the Hub is down. No native HDMI-CEC on this hardware and no Dolby Vision output on Linux (plays as HDR10). |
| **Phone remote** | `hub/public/remote/`, `android/app/` | Plain HTML/JS PWA; the Android app wraps it in a WebView. |
| **Android and Fire TV client** | `android/client/` | Kotlin, Compose, Media3. Phones, tablets (portrait) and Fire TV. Watches and downloads at home. Mirrors the TV UI. |
| **Samsung (Tizen) and LG (webOS)** | `samsung/`, `lg/` | Plain ES2015 web apps, sideloaded in Developer Mode. **Over-the-air shell:** the installed package is a small shell; screens are fetched from the Hub at start, falling back to the last saved copy, then the packaged copy. Updating the Hub updates the TVs. See [docs/tv-updates.md](docs/tv-updates.md), [docs/samsung.md](docs/samsung.md), [docs/lg.md](docs/lg.md). Changing `boot.js`, `index.html`, `config.xml` or `appinfo.json` needs a reinstall, so avoid it. |
| **Desktop (Windows, Mac, Linux)** | `tools/desktop/` | The TV app in a normal window with mpv. See [docs/desktop.md](docs/desktop.md). |
| **iPhone** | `hub/public/remote/` | The phone remote as an installable web app (Add to Home Screen). |
| **PS5 title** | `ps5/evo/` | An installable title built on EVO Player's engine; UltimateTV is an EVO "provider". The Hub serves an RmlUi bundle mirroring the TV app's look and `/api/ps5/*` routes (`hub/src/ps5.ts`). **GPL-3.0-or-later** for this part only. The old SDL `.elf` (`ps5/src/`) cannot work and is retired once the title is seen playing. See [docs/ps5-architecture.md](docs/ps5-architecture.md), [docs/adr/0005-the-ps5-builds-on-evo-players-engine.md](docs/adr/0005-the-ps5-builds-on-evo-players-engine.md). |

Operations scripts live in `tools/` (`tools/box/install.sh`, `tools/pxe` for unattended box installs, `tools/hub/update.sh`, `tools/hub/travel.sh`, `tools/screenshots`).

## Design principles

1. **Wife acceptance factor first.** Everyday things must work without explanation: pick a profile, watch TV, find a film, resume, record. If a feature needs a manual, simplify it or hide it.
2. **Remote-first, CEC-first.** Every screen must be fully usable with the D-pad, OK, Back, colour keys and number keys that a TV remote sends over CEC (or the phone remote). No hover, no pointer-only controls, no dead ends, and focus must never be lost after a key press. Show key hints where they help. Back always goes back.
3. **Every client mirrors the main TV app's design.** The TV UI in `ui/` is the reference: same Home order, card shapes, wording and theme palette. When you build or fix a screen on Android, Fire TV, Samsung, LG, desktop or PS5, match it rather than inventing a native-feeling variant. Themes come from `/api/theme` and `shared/src/themes.ts`.
4. **Profiles with PIN and a real Kids profile.** Adults are PIN-protected; Kids see only allowed channels and rated titles and never get Settings, Music, scares, downloads or casting they have not been given. Kids rules are shared code, so Kids see the same on every client. Any new feature or route must say what Kids and non-adult profiles can do.
5. **Intrusive features are off by default.** Anything that pops up, plays sound or video unprompted, scares, or changes the picture (muted Home trailer, jump scares, pop-ups, screensavers with extras, sleep timers) ships off by default and is a per-profile or Settings choice.
6. **Plain language.** No jargon on the TV. Say what happened and what to do next, in full sentences.
7. **Fail soft.** A dead feed switches to the next one; a missing Hub shows the box's own page; a bad TV update falls back to the packaged screens; a failed box update rolls back. Never leave a black screen with nothing in any log.
8. **Local and private.** Everything stays on the home network. No analytics, no crash reporter, no third-party scripts in the TV app, no Google Play services. Every external service must be one the owner chose and is listed in [docs/dependencies.md](docs/dependencies.md).
9. **Do not cut a recording off.** Health checks and restarts must not kill a running recording.
10. **Be honest about testing.** Much of this was built without hardware. Do not claim something works on the real box, TV or console unless it has been seen there; say "untested on hardware" and keep [docs/ROADMAP.md](docs/ROADMAP.md) and the "(tested)" marks in FEATURES.md accurate.

## Build and test

```bash
npm ci                         # run after every pull: dependencies change often (workspaces)
npm run typecheck              # tsc -b plus the probe and ui projects
npm test                       # Vitest over shared, hub, ui, box, samsung, lg
npm run build                  # shared, probe, hub, box, ui
npm run e2e                    # builds, then six remote-key journeys in a real browser against a demo Hub (~25 s)
npm run e2e -- --only=guide    # one journey
DEMO=1 npm run dev:hub         # demo Hub for manual work
npm run screenshots            # regenerate docs/screenshots (after npm run build)
node tools/hub/route-auth.mjs --check
```

Node 22 or newer. Playwright and Chromium are used for e2e and screenshots. The full hardware test plan is [docs/TESTING.md](docs/TESTING.md).

**Known flaky tests** (re-run before assuming you broke them):
- `box/test/selftest.test.ts`, the no-ffmpeg case, can time out.
- The TV e2e journey "pick a profile" can fail once with an empty profiles list and passes on re-run.

When a test fails, re-run only the failing test while you fix it, and run the full suite once at the end.

**CI** (`.github/workflows/ci.yml`) runs tests, e2e, the Hub image and smoke test, box script checks, the PXE image, the desktop builds (AppImage, Windows, macOS), both Android APKs (CI is the only Android compiler; there is no SDK in cloud sessions), and the PS5 jobs. The `ps5-title` job can show green when its title step fails (`continue-on-error`), so check that the `UltimateTV-PS5-title.zip` was actually produced.

## Conventions

- **One feature, one doc.** A user-visible feature gets a short guide in `docs/<feature>.md` (what it does, how to turn it on, what is untested), linked from FEATURES.md and the CHANGELOG entry. Update ARCHITECTURE.md when you add a part or change how parts talk.
- **CHANGELOG.md** gets a bullet per change at the top, under today's `## YYYY-MM-DD` heading, in the format that file describes. Add an indented `Household:` line only for changes people will see; that line is what the apps show as What's new.
- **Screenshots go in the repo** (`docs/screenshots/`, made with `npm run screenshots`) for visible changes.
- **Tests with the change.** Put logic in testable modules (`hub/test`, `ui/test`, `shared/test`, `samsung/test`, `lg/test`) and add a journey to `e2e/` for a new everyday flow.
- **Hub update path.** The Hub is updated with `bash tools/hub/update.sh` on the Docker LXC (pulls, rebuilds, checks health). The box updates itself weekly or from Settings › About. Samsung and LG screens update when the Hub does. Say in your PR which of these the change needs.
- **New write routes** declare their auth (see above). **New settings** are redacted before they reach any client.
- **New features reach every client or say why not.** Many features so far are TV-only; note in the feature doc which clients are covered and which are not yet.
- **Branches and PRs.** Work on a branch and open a pull request; do not push to `main`. Keep PRs to one concern, with a description of what changed, what was tested and what was not. Merge order matters when PRs overlap: update each onto `main` in turn.
- **Android signing** uses the household's key from repository secrets, never in the repo ([docs/android-signing.md](docs/android-signing.md)).

## Things that bite

- The Hub's container port is 8080 but the host port is **8095** (`HUB_PORT` in `.env`).
- IPTV connections are scarce. Anything that opens a stream must take a lease from the connection guard.
- The TV UI is served by the Hub and the box does not cache it: a broken UI build blanks the TV. `uicheck.ts` shows a fallback after three blank loads, but do not rely on it.
- mpv draws under a transparent Electron window; UI that needs video visible cuts a hole rather than drawing over it.
- Dolby Vision plays as HDR10 on Linux and on the PS5. Do not promise more.
- Samsung/LG behaviour on real sets (running downloaded code, AVPlay, Developer Mode expiry) is unconfirmed; the PS5 title has not been run on a console. Check the ROADMAP table before assuming.
- Access policy for the owner's infrastructure: agents may reach the Hub and the TV box, not the Docker LXC at large.
