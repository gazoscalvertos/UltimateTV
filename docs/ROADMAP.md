# Roadmap

Where UltimateTV stands on 2026-10-30 (main up to PR #61) and what's left. The original phases are in [PLAN.md §8](PLAN.md#8-phased-roadmap); [FEATURES.md](FEATURES.md) lists what's built and [TESTING.md](TESTING.md) is the test run.

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
| 5. Polish and WAF | Mostly built (profiles, screensaver, automatic box updates, nightly Hub backup, a screen for when the Hub is down). Automatic rollback and the WAF test remain. |
| Beyond the plan | Music video channels, Music tab, Android app, pairing, pop-ups, queue, Halloween, trips, box downloads, themes, Cast and games, button hints and help, sleep timer, alerts, Save for later, advert skip, seasonal clips, projected clip packs, weather, TV apps, trailers and scores, More like this, OpenSubtitles, Skip intro everywhere, accessibility: built, mostly untested. |

## Tested or untested, feature by feature

From the project's notes. **Tested** means it has run on the real box or Hub; **Partly** means some of it has; **Untested** means it's built and passes its tests against the demo Hub, but hasn't run on the hardware. Nothing has run on the Hisense yet: the box has only been plugged into the Huawei monitor.

| Feature | PR | Status |
|---------|----|--------|
| Hub in Docker, updates with `update.sh` | #2 | Tested |
| PXE install, box boots into the app, diagnostics | #2, #8 | Tested |
| Jellyfin playback, refresh-rate matching with the custom 24p mode | #2, #11 | Tested (Huawei monitor, not the Hisense) |
| Phone remote and its Updates card | #2, #25, #49 | Tested, in daily use |
| Android remote app and watching app | #25, #40 | Partly: both run on Gary's phone; downloads and live TV untested |
| Music video channels | #21, #30 | Partly: downloads work on the Hub; playing them on the TV untested |
| HDR, Atmos/DTS passthrough, 50 Hz matching on the Hisense | #2 | Untested |
| TV remote over CEC, TV standby, TV on switching to the box | #2, #60 | Untested (waits for the Pulse-Eight adapter) |
| Live TV, pause live, the guide, custom guides, catch-up | #2, #51 | Untested with the real IPTV provider on the TV |
| Recording, series link, clashes | #2, #18 | Untested |
| AIOStreams / TorBox playback, Versions | #2, #18 | Untested |
| Profiles, PINs and the Kids lock | #2 | Untested |
| Pairing phones and remotes, HA API key | #41 | Untested |
| Spotify and Deezer (Music tab) | #22, #24, #56 | Untested against the real services |
| Pop-ups and breaking news | #39 | Untested |
| Play queue | #43 | Untested |
| Screensavers and dimming | #46 | Untested |
| Halloween, Spooky TV, jump scares | #45 | Untested |
| Trips (`travel.sh`) and Download to box | #47, #50 | Untested |
| Android app QR codes and links | #52 | Untested |
| Save to NAS and Jellyfin | #53 | Untested |
| Themes, with seasonal themes | #54 | Untested |
| Button hints and the help screen | #60 | Untested |
| Sleep timer | #60 | Untested (standby needs the Pulse-Eight) |
| Alerts to Home Assistant or ntfy | #60 | Untested |
| Save for later | #60 | Untested |
| Advert skip with comskip | #60 | Untested on real UK recordings |
| AirPlay, laptop screen share, links from the phone | #60 | Untested |
| Games: RetroArch, Moonlight, Steam Link, GeForce NOW | #60 | Untested |
| Seasonal clips, projected clip packs, community list | #60, #61 | Untested |
| Nightly Hub backup, box screen when the Hub is down | #63 | Untested |
| Weather | #64 | Untested |
| TV apps button, trailers and scores, More like this, OpenSubtitles | #65 | Untested (TV apps needs the Pulse-Eight) |
| What's new (change log in every app) | #112 | Untested |
| Skip intro everywhere (Intro Skipper), accessibility settings | #116 | Untested (the plugin isn't on the Jellyfin LXC yet) |

### What has run on real hardware

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

First bring the box and the Hub up to date: run `tools/hub/update.sh`, then rerun the box installer so it adds UxPlay, RetroArch, Moonlight and the cloud game apps (PR #60), and update the TV app. Then, in the order of [TESTING.md](TESTING.md):

- **The Hisense itself:** 4K HDR10 switching, HLG, 24p and 50 Hz matching, scale ×1, and how the UI looks over HDR video.
- **Sound:** Dolby Digital Plus / Atmos and DTS reaching the TV speakers.
- **The TV remote:** waits for the Pulse-Eight USB-CEC adapter (the box has no HDMI-CEC of its own). Check every key, TV off stopping playback, TV on switching to the box, and the TV apps button reaching the Hisense's Home.
- **Boot time:** under 15 seconds to Who's watching.
- **IPTV:** live TV, pause live, the guide, catch-up (never tried with this provider) and sharing the one connection.
- **Recording:** a week of series links without misses, clashes, recordings showing up in Jellyfin.
- **TorBox / AIOStreams** playback and Save to NAS.
- **Profiles and the Kids lock**, and pairing (an unpaired phone is refused).
- **Spotify and Deezer** on the box (neither has been tried against the real services).
- **Pop-ups from Home Assistant** (existing commands need the `X-Api-Key` header).
- **Play queue, screensavers, Halloween and jump scares, Download to box, and a trip** with `travel.sh`.
- **Cast and games:** AirPlay, a laptop's screen share (trust the Hub's certificate first), links from the phone, RetroArch, Moonlight, Steam Link and GeForce NOW. The sleep timer's CEC standby needs the Pulse-Eight.
- **Trailers, scores and subtitles:** a trailer through yt-dlp on the box, OMDb scores, and OpenSubtitles files lining up with TorBox and IPTV copies.
- **Weather:** the forecast reaching the Hub from Open-Meteo, and your postcode found.
- **Hub backup and the Hub-down screen:** a backup lands on the NAS overnight, a restore from the phone, and the box's own screen when the Hub's container is stopped (`docker stop ultimatetv-hub`).
- **Advert skip** on real UK recordings (comskip's settings may need tuning), and alerts reaching Home Assistant or ntfy.
- **Themes, Save to NAS, projected clip packs:** the seasonal theme on its dates, a TorBox film saved and showing in Jellyfin, a starter pack over a 4K film (smooth on the N150?), and a pack sent from the phone.
- **The WAF test:** watch BBC One, record tonight's film, set a series link, carry on yesterday's film, find a 4K comedy, with no help.

## Recent pull requests

| PR | What | State |
|----|------|-------|
| [#51](https://github.com/gazoscalvertos/UltimateTV/pull/51) | Phone settings for the guide's lists, custom guides and channels | Merged |
| [#52](https://github.com/gazoscalvertos/UltimateTV/pull/52) | QR codes and links for the Android apps in settings | Merged |
| [#53](https://github.com/gazoscalvertos/UltimateTV/pull/53) | Save to NAS from Versions, the player and the phone | Merged |
| [#54](https://github.com/gazoscalvertos/UltimateTV/pull/54) | Theme picker with seasonal themes | Merged |
| [#55](https://github.com/gazoscalvertos/UltimateTV/pull/55) | These overview docs | Merged |
| [#56](https://github.com/gazoscalvertos/UltimateTV/pull/56) | Spotify and Deezer sign-in fixed, music guide | Merged |
| [#60](https://github.com/gazoscalvertos/UltimateTV/pull/60) | Cast and games, button hints, sleep timer, alerts, Save for later, advert skip, seasonal clips | Merged |
| [#57](https://github.com/gazoscalvertos/UltimateTV/pull/57) | Projected clips: packs, starter packs, motions, a community pack list | Merged through #61 |
| [#61](https://github.com/gazoscalvertos/UltimateTV/pull/61) | #57's projected clips ported onto #60's seasonal clips | Merged |
| [#58](https://github.com/gazoscalvertos/UltimateTV/pull/58), [#59](https://github.com/gazoscalvertos/UltimateTV/pull/59) | Earlier takes on the watchlist, advert skip, help, sleep timer and alerts | Closed, #60 has them |

## Not built yet

The [gap list](https://claude.ai/artifact/PSEpcgrMkhKp4Se1Gp51gK) ranks these against Sky Q, Apple TV, Plex and the rest. Its picks 2 to 6 (button hints, sleep timer, alerts, Save for later, advert skip) are now built. Next, in its order:

1. ~~Nightly Hub backup~~: built in #63 ([backup.md](backup.md)).
2. **A "TV apps" button** that hands the screen back to the Hisense over CEC for Netflix, Disney+ and Prime. Needs the Pulse-Eight first.
3. **Trailers and review scores** on the details page (TMDB trailers through yt-dlp, IMDb and Rotten Tomatoes from OMDb).
4. **More like this** on the details page and a Home row. The Hub already has a TMDB recommendations call that nothing uses.
5. **Subtitles**: fetch missing ones from OpenSubtitles, a default per profile, size and background settings.
6. ~~Skip intro for the whole library~~: install script, docs and credits-driven Up Next in #116 ([watching-extras.md](watching-extras.md#skip-intro-everywhere)). The plugin still has to go on the Jellyfin LXC.
7. **Home Assistant both ways**: the TV as a media player, and "film started" / "paused" events for lights.
8. **Kids time limits and a bedtime.**
9. Later: a local AI on the box, a Freeview HDHomeRun backup, radio and podcasts, multiview, Trakt. (Audio description and accessibility settings: built in #116, [accessibility.md](accessibility.md).)

Left over from PR #58, which was closed in favour of #60, and could be brought across: advert marks on the seek bar, a black-frame and silence fallback when comskip finds nothing, Save for later showing when a title is next on TV, and a Save for later tab on the phone.

Also from the plan, or raised along the way:

- **Automatic rollback** when the box fails a health check after an update. Today the update takes a snapper snapshot first, but rolling back is by hand.
- **The full TV app without the Hub:** the box now has its own screen for when the Hub is down (downloads, games, AirPlay), but the guide, library and live TV still need the Hub.
- **A second-box install test**, and the Debian 13 fallback, which has never been tried.
- **Jellyfin progress from the box's offline downloads** isn't sent back to Jellyfin while away.
- **The Android app** has no Save to NAS, play queue or Save for later yet.
- **A real browser client:** `/app/` in a laptop browser is a development stand-in; live TV and most MKV files don't play there without the Hub repackaging to HLS.
- **Watching away from home:** Jellyfin and older recordings need a way home on trips (a VPN such as Tailscale was suggested, not set up). The Android app stays home-only by Gary's choice.
- **Quick Sync on the server:** the N150's iGPU needs a newer Proxmox kernel (`proxmox-kernel-6.14`). Optional, as the box decodes everything.
- **An AI curator for music channels**, and local LLMs on the box's 64 GB: the music channel API is ready, nothing else is scoped.

## Known limits

- No Dolby Vision or HDR10+ output from Linux; they play as HDR10.
- One IPTV connection: the TV, recordings, catch-up and the Android app take turns. A 4 or 5 connection plan removes most clashes.
- Spotify needs Premium; Deezer has no API, so it's its own web player, and Google or Facebook logins don't work in it.
- Everything is for the home network; nothing is exposed to the internet.
