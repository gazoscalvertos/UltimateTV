# Installing the box

The box is any x86_64 mini PC on the TV's HDMI (ours is a GMKtec NucBox K7 Plus). The installer turns a fresh Arch Linux install into a TV box that boots straight into UltimateTV. Debian 13 also works, with an older HDR stack.

## 1. Install Arch Linux

The easiest way is over the network: the PXE server on the Docker LXC installs Arch and everything below with no questions asked ([pxe.md](pxe.md)). To do it by hand instead, use `archinstall` from the Arch ISO on a USB stick:

- **Disk:** btrfs, with the default subvolumes. The installer then takes a snapshot before every update, so a bad update can be rolled back.
- **Profile:** Minimal. The installer adds KWin and everything else it needs.
- **Audio:** PipeWire.
- **Network:** wired Ethernet if you can (NetworkManager is fine for Wi-Fi).
- **User:** your own admin account. The installer creates a separate `tv` account that logs in automatically.

## 2. Run the installer

Log in as your admin account and run:

```sh
sudo pacman -S --needed git
git clone https://github.com/gazoscalvertos/UltimateTV.git && cd UltimateTV
sudo HUB_URL=http://192.168.0.19:8095 bash tools/box/install.sh
sudo reboot
```

After the reboot the box goes straight to the profile picker. Running the installer again updates the app and puts its settings back.

What it sets up:

| | |
|---|---|
| Session | SDDM logs `tv` in to a KWin session that runs only the app. No desktop, panel, notifications or lock screen. If the app quits, it starts again. |
| Picture | mpv with VA-API decoding and gpu-next. The TV switches to each film's frame rate (24p for films, 50 Hz for UK TV) and into HDR for HDR video. Dolby Vision plays as HDR10. |
| Sound | Dolby Digital, Dolby Digital Plus (with Atmos) and DTS go to the TV untouched; everything else is decoded on the box. Night mode in the player's options evens out loud and quiet parts. |
| Remote | The Pulse-Eight adapter is attached to the kernel's CEC driver as soon as it's plugged in, and the remote's buttons are mapped to the app's keys (`tools/box/files/cec-keymap.toml`). The box wakes the TV and switches it to its input when it starts. |
| Updates | Every Monday at 4 am, or Settings › About › Update the box: a btrfs snapshot, OS updates, then the app, then a health check that rolls the update back if the box doesn't work afterwards. Settings › About shows the version the box runs and whether a newer one is out. See [below](#updates-and-rolling-back). |

Settings live in `/etc/ultimatetv/box.env` (the Hub's address, the CEC device, the audio device, extra mpv options). The app's log is `/home/tv/.local/state/ultimatetv.log`.

## Updates and rolling back

An update (`/usr/local/bin/ultimatetv-update`, from `tools/box/update.sh`) first keeps a way back: a snapper snapshot of the root and a copy of the kernel files in `/boot` (the EFI partition isn't in the snapshot). Then it installs the OS updates and the new app and restarts the TV app.

Straight after, the health check (`ultimatetv-healthcheck`, also run at every boot while an update is waiting to be checked) gives the box up to 4 minutes to show that:

- the TV app started (it writes `~tv/.local/state/ultimatetv-health` once a page has loaded, and every 30 seconds);
- the app reaches the Hub (a Hub that nobody can reach isn't counted against the update);
- mpv plays a test clip (`/usr/local/share/ultimatetv/test-clip.mkv`, made by the installer);
- the CEC adapter is still there, if it was before the update.

If any of that fails, `ultimatetv-rollback` undoes the update (`snapper undochange` back to the snapshot, and the old kernel files back in `/boot`), reboots, and remembers the commit in `bad-commits` so Monday's update doesn't install it again. A newer commit installs as usual, and Update the box in Settings installs even the bad one if you ask. The TV shows a card, Home Assistant/ntfy gets an alert (Settings › Alerts), and Settings › About and the phone show what failed.

You can roll back by hand too: Settings › About › Roll back last update, or Roll back last update on the phone's ⚙ Settings › Updates. Only the last update can be undone, once.

- **Turn the automatic roll back off:** `AUTO_ROLLBACK=0` in `/etc/ultimatetv/box.env`. A failed check then only alerts. `HEALTH_WAIT=<seconds>` changes how long the check waits for the app.
- **What happened:** `sudo cat /var/lib/ultimatetv/update/update.log`, or the end of the Hub's `/api/diagnostics?format=text`. The same folder has `last.env` (the update that can be undone), `health.env` (the last check), `rollback.env` (the last roll back) and `bad-commits`.
- **Without btrfs** (a hand install on ext4): there are no snapshots, so a roll back only puts the app back to its previous commit, not the OS packages.
- **Allow a skipped commit again:** remove its line from `/var/lib/ultimatetv/update/bad-commits`.

## 3. Plug in the Pulse-Eight adapter

Plug the adapter between the box's HDMI and the TV's, and its USB into the box. Then on the TV, turn on CEC (Hisense calls it **CEC Control**, under Settings › System › Input settings) and **Device auto power off**.

To check it from an SSH session: `cec-ctl -d /dev/cec0 --playback` should show a physical address such as `1.0.0.0`, and `ir-keytable` should list a `pulse8-cec` device using the `ultimatetv-cec` protocol. To see exactly which buttons the TV sends, run `ir-keytable -s rc0 -t` and press them.

Until the adapter arrives, use the phone remote, or a USB keyboard (arrows, Enter, Escape, F1–F4 for the colour keys).

## If something isn't right

- **Black screen with only a cursor, or a desktop:** check the log above, and that `/usr/share/wayland-sessions/ultimatetv.desktop` exists.
- **"Can't reach the Hub":** check `HUB_URL` in `/etc/ultimatetv/box.env`, then `sudo systemctl restart sddm`.
- **No sound on Dolby films:** set `AUDIO_DEVICE` in `box.env` to the HDMI output from `mpv --audio-device=help`.
- **A probe report for anything else:** `bash /opt/ultimatetv/tools/box/probe.sh` writes a report of what the box and TV can do.
- **Roll back an update:** Settings › About › Roll back last update, the phone, or over SSH `sudo systemctl start ultimatetv-rollback` ([above](#updates-and-rolling-back)). For an older snapshot, `sudo snapper -c root list` to find it, then `sudo snapper -c root undochange <number>..0` and reboot.
- **Start again from scratch:** reinstall over the network ([pxe.md](pxe.md)).
