# Changelog

The version is in the root `package.json` (and each workspace's). The Hub and the box also show
the commit they were built from in Settings › About, so you can tell exactly what each one runs.

## Updating

- **Hub** (on the Docker LXC): `bash /containers/UltimateTV/tools/hub/update.sh`. It pulls,
  rebuilds with the version recorded, restarts and checks the Hub is up. The TV loads the new app
  the next time it opens it (Settings › About › Reload the app does it straight away).
- **Box**: Settings › About › Update the box, or wait for Monday 4 am. Over SSH:
  `sudo systemctl start ultimatetv-update`.

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
