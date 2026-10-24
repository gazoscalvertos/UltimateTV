# ADR 0002: Our own app on a Linux mini PC, backed by the Hub

- Status: accepted (2026-10-24)
- Decider: Gary
- Supersedes: [ADR 0001](0001-vidaa-only-with-hub.md)

## Context

The Phase 0 probe ([capability-matrix.md](../phase0/capability-matrix.md)) showed that a page in the VIDAA browser runs in cursor mode: the arrows and OK move a pointer, Back is browser history and Guide closes the page. A remote-driven TV app needs an installed VIDAA app, and both install routes are closed on this firmware (`hisense://debug` is blocked, the community app store is reported broken on VIDAA OS 9, and the official store is partner-only).

Gary has a Linux mini PC to plug into the TV, may replace it later, and will buy a Pulse-Eight USB-CEC adapter so the Hisense remote drives it. He wants our own app rather than Kodi.

## Decision

- **Client:** our own app on a Linux box over HDMI. A KWin Wayland session runs as a kiosk with an Electron shell (the UI) and mpv (the player) controlled over JSON IPC. A small box agent handles CEC, display modes, power and updates.
- **Remote:** HDMI-CEC through the Pulse-Eight adapter, using the kernel `pulse8-cec` driver so remote keys arrive as normal input events. libcec is the fallback.
- **Distro: Arch Linux**, on btrfs with a snapshot before every update and automatic rollback if the app fails its health check.
  - Linux HDR depends on the compositor, Mesa and mpv, and all three are improving release by release. Arch ships each new KWin, Mesa and mpv within days.
  - Arch's kernel supports new mini-PC hardware first, which matters because the box may be replaced.
  - The usual risk of a rolling release is handled by snapshots, scheduled updates and rollback, and nobody uses the box as a computer.
  - **Debian 13** is the supported fallback. It works, but ships Plasma 6.3 with an older HDR stack. The app and installer are written to run on both.
- **Hardware:** any x86_64 box with a modern Intel or AMD iGPU and HDMI 2.0 with HDR (see PLAN §3.4). arm64 is best-effort.
- **Hub:** unchanged. It still owns recording, series link, EPG, downloads and the single IPTV connection, and it serves the UI.

## Consequences

- Every remote key that the TV forwards over CEC works, with Green and an Options menu covering keys it doesn't forward.
- Every file plays directly in mpv. The Hub's stream gateway and the Jellyfin transcoding profile are no longer needed.
- Refresh rate follows the content (24p films, 50 Hz TV).
- DD+ Atmos is passed untouched to the TV. TrueHD and DTS-HD are decoded on the box, which is inaudible on TV speakers.
- **Dolby Vision and HDR10+ can't be signalled from Linux**, so those titles play as HDR10. Source ranking prefers versions with an HDR10 base layer.
- There is one more device to power and maintain. The installer, snapshots and automatic updates keep that to zero routine work.
- The VIDAA probe (`tools/probe`) stays in the repo as a record of why.
