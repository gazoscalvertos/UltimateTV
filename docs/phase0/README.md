# Phase 0: spike & probe

Goal: find out what this exact TV and server can really do before building the app. Exit criteria: a written capability matrix, a confirmed install method, and a list of IPTV channels with catch-up.

## Steps

1. **Set up the Hub** on the Proxmox Docker container: [proxmox-setup.md](proxmox-setup.md).
2. **Make test clips**: `docker compose exec hub make-test-clips` (about 10 minutes on the N150). They land in `./test-clips` next to the compose file. Add real Dolby Vision and HDR10+ samples by hand: [test-clips.md](test-clips.md).
3. **Open the probe on the TV.** In the VIDAA browser, go to `http://<server-ip>:8080/` and bookmark it. Then try the vidaa-edge launcher icon method: [vidaa-install.md](vidaa-install.md).
4. **Run the four probe steps** with the TV remote:
   1. *TV check* runs by itself (formats, DRM, screen, GPU, UI frame rate).
   2. *Remote keys*: press each key when asked. Press OK to skip keys your remote doesn't have.
   3. *Test clips*: play each clip and answer three questions (badge, motion, audio). Look at the TV's own info banner or picture settings for the HDR/Dolby Vision badge.
   4. *Send report*: saves it on the Hub and shows the server's Quick Sync checks.
5. **Read the matrix** on a computer: `http://<server-ip>:8080/api/probe-reports` lists reports, and `…/<id>/matrix.md` shows each one as a table. Commit the matrix to `docs/phase0/capability-matrix.md`.
6. **Test IPTV catch-up** on the main UK channels: [iptv-catchup.md](iptv-catchup.md).

## What the results decide

| Result | Decision it drives |
|--------|--------------------|
| Which codecs and containers play | Jellyfin DeviceProfile and source ranking (Phase 3) |
| Whether DV in MKV shows the Dolby Vision badge | Whether DV goes through the browser or the native player |
| Whether 23.976p clips judder | Whether films default to the native player |
| Whether 1080i50 combs | Whether the Hub deinterlaces IPTV |
| DTS / TrueHD results | Which audio the Hub converts to E-AC-3 |
| UI frame rate and WebGL renderer | Confirms Lightning JS for the TV app (Phase 1) |
| Remote key codes | Remote mapping (plan §5.4) |
| Quick Sync checks | Whether AV1 → HEVC conversion runs on the N150 |
