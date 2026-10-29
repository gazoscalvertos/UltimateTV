# Roadmap

Where UltimateTV stands on 2026-10-29 and what's left. The original phases are in [PLAN.md §8](PLAN.md#8-phased-roadmap); [FEATURES.md](FEATURES.md) lists what's built and [TESTING.md](TESTING.md) is the test run.

## Where it stands

Gary asked for the whole app to be built before testing on the real hardware, so the code for every phase is written and passes its tests against the demo Hub, but most of it has never run on the box or the Hisense.

| Phase | Status |
|-------|--------|
| 0. Server spike and TV probe | Done. The VIDAA browser was ruled out ([ADR 0002](adr/0002-linux-mini-pc-client.md)). |
| 0b. Box bring-up | Partly proven: the box installs over PXE and boots into the app. HDR, Atmos, CEC and boot time on the Hisense are still to check. |
| 1. Hub core and live TV | Built, untested with the real IPTV provider on the TV. |
| 2. Recording and series link | Built, untested. |
| 3. Unified films and TV | Built. Jellyfin playback has run on the box. |
| 4. AIOStreams, TorBox, NAS pipeline, phone remote | Built. The phone remote is in daily use; TorBox and Save to NAS are untested. |
| 5. Polish and WAF | Mostly built (profiles, screensaver, automatic box updates). Automatic rollback, backups and the WAF test remain. |
| Beyond the plan | Music video channels, Music tab, Android app, pairing, pop-ups, queue, Halloween, trips, box downloads: built, mostly untested. |

## What has run on real hardware

From the project's notes; anything not listed here hasn't been confirmed.

| Area | Result |
|------|--------|
| Hub in Docker on the Proxmox LXC (port 8095), updated with `update.sh` | Working |
| PXE network install of Arch on the GMKtec K7 Plus | Working (2026-10-24) |
| Box boots straight into the app, talks to the Hub, sends diagnostics | Working |
| Jellyfin playback on the box | Working on the Huawei 3440×1440 monitor, smooth at 24p with the custom 71.928 Hz mode |
| Music video channel downloads on the Hub | Working (after PR #30) |
| Phone remote and its Updates card | In use |
| Android app | Runs on Gary's phone (a start-up crash was fixed in PR #40) |

## Still to test on the hardware

In the order of [TESTING.md](TESTING.md):

- **The Hisense itself:** 4K HDR10 switching, HLG, 24p and 50 Hz matching, scale ×1, and how the UI looks over HDR video.
- **Sound:** Dolby Digital Plus / Atmos and DTS reaching the TV speakers.
- **The TV remote:** waits for the Pulse-Eight USB-CEC adapter (the box has no HDMI-CEC of its own). Check every key, TV off stopping playback, and TV on switching to the box.
- **Boot time:** under 15 seconds to Who's watching.
- **IPTV:** live TV, pause live, the guide, catch-up (never tried with this provider) and sharing the one connection.
- **Recording:** a week of series links without misses, clashes, recordings showing up in Jellyfin.
- **TorBox / AIOStreams** playback and Save to NAS.
- **Profiles and the Kids lock**, and pairing (an unpaired phone is refused).
- **Spotify and Deezer** on the box (neither has been tried against the real services).
- **Pop-ups from Home Assistant** (existing commands need the `X-Api-Key` header).
- **Sleep timer standby over CEC**, auto-off, and alerts with the real IPTV expiry date ([help-sleep-alerts.md](help-sleep-alerts.md#testing-on-the-box)).
- **Play queue, screensavers, Halloween and jump scares, Download to box, and a trip** with `travel.sh`.
- **The WAF test:** watch BBC One, record tonight's film, set a series link, carry on yesterday's film, find a 4K comedy, with no help.

## Open pull requests

| PR | What | State |
|----|------|-------|
| [#51](https://github.com/gazoscalvertos/UltimateTV/pull/51) | Phone settings for the guide's lists, custom guides and channels | Open |
| [#52](https://github.com/gazoscalvertos/UltimateTV/pull/52) | QR codes and links for the Android apps in settings | Open |
| [#53](https://github.com/gazoscalvertos/UltimateTV/pull/53) | Save to NAS from Versions, the player and the phone | Open |
| [#54](https://github.com/gazoscalvertos/UltimateTV/pull/54) | Theme picker with seasonal themes | Open |
| This branch | Help screen and colour hints, sleep timer, alerts | Open |

## Not built yet

From the plan, or raised along the way:

- **Automatic rollback** when the box fails a health check after an update. Today the update takes a snapper snapshot first, but rolling back is by hand.
- **Starting without the Hub:** the box loads the UI from the Hub each time and shows "Can't reach the Hub" when it can't; the plan wanted a cached copy.
- **Backup and restore** of the Hub's data beyond Proxmox's own backups (the trip move-out archive is the nearest thing).
- **A second-box install test**, and the Debian 13 fallback, which has never been tried.
- **Jellyfin progress from the box's offline downloads** isn't sent back to Jellyfin while away.
- **The Android app** has no Save to NAS or play queue yet.
- **A real browser client:** `/app/` in a laptop browser is a development stand-in; live TV and most MKV files don't play there without the Hub repackaging to HLS.
- **Watching away from home:** Jellyfin and older recordings need a way home on trips (a VPN such as Tailscale was suggested, not set up). The Android app stays home-only by Gary's choice.
- **Quick Sync on the server:** the N150's iGPU needs a newer Proxmox kernel (`proxmox-kernel-6.14`). Optional, as the box decodes everything.
- **An AI curator for music channels**, and local LLMs on the box's 64 GB: the music channel API is ready, nothing else is scoped.

## Known limits

- No Dolby Vision or HDR10+ output from Linux; they play as HDR10.
- One IPTV connection: the TV, recordings, catch-up and the Android app take turns. A 4 or 5 connection plan removes most clashes.
- Spotify needs Premium; Deezer has no API, so it's its own web player, and Google or Facebook logins don't work in it.
- Everything is for the home network; nothing is exposed to the internet.
