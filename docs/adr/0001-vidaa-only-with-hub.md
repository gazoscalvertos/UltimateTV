# ADR 0001: Run on the VIDAA TV only, backed by a home Hub

- Status: **superseded** by [ADR 0002](0002-linux-mini-pc-client.md) (2026-10-24)
- Decider: Gary

## Context

The target TV is a Hisense 85U7STUK running VIDAA. VIDAA can't run Android apps, its store is partner-only, and its browser player has gaps (no AV1, Dolby Vision in MP4 crashes, no lossless audio passthrough). An external Android TV box would remove those gaps. Gary chose not to add a box for now.

## Decision

- The app is a web app that runs in the TV's browser. It is installed as a launcher icon via vidaa-edge where that works, and as a bookmark otherwise.
- An always-on **Hub** runs as a Docker stack on Gary's Proxmox server (Intel N150). It serves the app, does recording, EPG, downloads, and a stream gateway that rewraps or converts files the TV can't play.
- The Hub and TV app are TypeScript in one monorepo with shared types.

## Consequences

- No lossless Atmos. With TV speakers only, this is inaudible.
- Dolby Vision and frame-rate edge cases fall back to VIDAA's native player.
- A VIDAA firmware update may break the launcher icon. The bookmark still works.
- Adding an Android TV client later needs no Hub rewrite.
