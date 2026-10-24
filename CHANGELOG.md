# Changelog

The version is in the root `package.json` (and each workspace's). The Hub and the box also show
the commit they were built from in Settings › About, so you can tell exactly what each one runs.

## Updating

- **Hub** (on the Docker LXC): `bash /containers/UltimateTV/tools/hub/update.sh`. It pulls,
  rebuilds with the version recorded, restarts and checks the Hub is up. The TV loads the new app
  the next time it opens it (Settings › About › Reload the app does it straight away).
- **Box**: Settings › About › Update the box, or wait for Monday 4 am. Over SSH:
  `sudo systemctl start ultimatetv-update`.

## Unreleased

- Sound reaches the TV: the box moves the sound card to the connected HDMI output's stereo
  profile at start and before each play (WirePlumber had picked the analog headphone output).
  Dolby and DTS still pass through. `HDMI_AUDIO=0` in box.env turns it off.

- TV Guide: the list follows the selected channel on every screen size. On a 21:9 monitor the
  bottom rows used to sit off screen; the UI is now sized by the screen's height when it's wider
  than 16:9, and the guide shows as many rows as fit.

- Diagnostics: the box sends the Hub its recent log, a playback sample every 10 seconds (frame
  rate, screen mode, sync, dropped and late frames, buffer) and the screen's details. Read it all
  at `http://<hub>:8095/api/diagnostics?format=text` (or as JSON without `?format=text`).
  Addresses are cut to their host, so IPTV logins and API keys never appear. See
  `docs/diagnostics.md`.
- Rolling detailed logs on the Hub (`data/logs`: the Hub at debug level, every box log line and
  every playback sample), each capped at 50 MB, read at `/api/diagnostics/logs/hub|box|playback`.
  `docker logs` rolls over at 30 MB. The box logs more of what mpv does (file loaded, seeks,
  buffering, why playback ended).
- Playback on screens with no refresh rate that fits the video (24p film on a 50/60/100 Hz
  monitor) no longer resamples to the screen, which mistimed and dropped frames all the time.
- Screens with no refresh rate that fits a film and no variable refresh (the Huawei monitor over
  HDMI) get a custom mode at a whole multiple of the film's frame rate, e.g. 71.928 Hz for 24p:
  three refreshes a frame, no judder. It's checked the screen takes it and added only once;
  `CUSTOM_MODES=0` in `/etc/ultimatetv/box.env` turns it off.
- AIOStreams links ending in `/configure` (as DuckStreams hands out) and `stremio://` links work.
- The stats overlay says how the screen was matched to the video's frame rate.

## 0.2.0 (2026-10-24)

The first install on the real box.

- PXE reinstall works on the GMKtec K7 Plus: the PXE server can hand out the box's address
  itself, serves the Arch installer over plain HTTP, and copes with the box's two network ports.
- Box installer: builds `inputattach` (no longer in Arch's repos), downloads Electron during the
  install, and keeps the GitHub token where services can read it.
- Playback stats overlay (blue button).
- Box updates from Settings › About, with a version check against GitHub.
- "From Jellyfin / IPTV / TorBox" badges on titles and in the player.
- Films and TV only show discovery titles when an addon can play them.
- Start again plays from the beginning.
- Versions: the Hub records its commit and build date; the TV app's page is never cached, so the
  TV picks up a Hub update.

## 0.1.0

The whole app, built before testing on hardware.
