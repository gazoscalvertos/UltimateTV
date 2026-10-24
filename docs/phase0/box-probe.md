# Phase 0b: probe the mini PC

Goal: prove that a Linux box on the TV's HDMI input gives us HDR, the right refresh rate, Atmos and every remote key, before any app is built on it. Run this on any box you're considering, so a future replacement gets the same test.

You need: the box on the TV with a KDE Plasma desktop (any distro for the probe), wired network, the Hub running ([proxmox-setup.md](proxmox-setup.md)) with the test clips made, and later the Pulse-Eight adapter.

## 1. Run the probe script

On the box, in a terminal on its own screen (not over SSH):

```sh
git clone https://github.com/gazoscalvertos/UltimateTV.git
cd UltimateTV
HUB_URL=http://192.168.0.19:8095 bash tools/box/probe.sh
```

It prints a report and saves it as `box-probe-<name>-<date>.md`. If it lists missing tools, install them with the command it prints and run it again. Paste the report into the thread.

## 2. Turn on HDR in Plasma

*System Settings → Display & Monitor →* the TV → **Enable HDR** (and Wide Colour Gamut if offered). Set *SDR brightness* so menus look normal. Or from a terminal, using the output name from the probe (e.g. `HDMI-A-1`):

```sh
kscreen-doctor output.HDMI-A-1.hdr.enable output.HDMI-A-1.wcg.enable
```

The TV should switch into its HDR picture modes as soon as HDR is on.

## 3. Play the test clips

Set a shortcut, then play each clip full screen. `q` quits.

```sh
CLIPS=http://192.168.0.19:8095/clips
play() { mpv --fs --vo=gpu-next --hwdec=vaapi --target-colorspace-hint=yes "$@"; }
```

| Test | Command | What to check |
|------|---------|---------------|
| HDR10 | `play $CLIPS/hdr10-hevc-2160p-mkv.mkv` | The TV's info banner or picture menu shows HDR10. Press `i` in mpv: `hwdec: vaapi` and the output colour space should say PQ / BT.2020. |
| HLG | `play $CLIPS/hlg-hevc-2160p50.mkv` | The TV shows HLG or HDR. Either is fine. |
| AV1 | `play $CLIPS/av1-2160p-10bit.mkv` | Smooth, and `i` shows `hwdec: vaapi` (hardware AV1). |
| 1080i IPTV | `play --deinterlace=auto $CLIPS/h264-1080i25-ac3.ts` | No combing on moving edges. |
| 24p | Set the TV mode to 24 Hz first: `kscreen-doctor -o` lists the modes, then `kscreen-doctor output.HDMI-A-1.mode.3840x2160@24`. Then `play --video-sync=display-resample $CLIPS/hevc-2160p23976-eac3.mkv` | Smooth pans with no regular stutter. The TV reports 24 Hz. Put the mode back to 50 Hz afterwards. |

## 4. Check audio passthrough

Find the HDMI device name, then send Dolby audio untouched:

```sh
mpv --audio-device=help | grep -i hdmi
AUD=alsa/hdmi:CARD=PCH,DEV=0      # use the name from the line above
mpv --fs --ao=alsa --audio-device=$AUD --audio-spdif=ac3,eac3,dts $CLIPS/audio-eac3-51.mkv
```

| Clip | Expected on the TV's audio info |
|------|---------------------------------|
| `audio-eac3-51.mkv` | Dolby Digital Plus (Atmos content shows Dolby Atmos) |
| `audio-ac3-51.mkv` | Dolby Digital |
| `audio-dts-51.mkv` | DTS if the TV accepts it, otherwise silence (we then decode DTS on the box) |
| `audio-truehd-51.mkv` | PCM (decoded on the box, as planned) |

If the desktop's sound server holds the device, close other apps playing sound, or tell us and we'll set it up through PipeWire instead.

## 5. The remote over CEC (once the Pulse-Eight arrives)

Plug the adapter between the box and the TV's HDMI port (it sits in line with the HDMI cable, plus USB to the box). Turn on CEC on the TV: *Settings → Connection → HDMI & CEC → CEC control*. Then:

```sh
sudo inputattach --daemon -p8 /dev/ttyACM0       # starts the kernel driver, /dev/cec0 appears
cec-ctl -d0 --playback --osd-name UltimateTV     # tells the TV we're a player
cec-ctl -d0 --to 0 --image-view-on               # should switch the TV on
cec-ctl -d0 --monitor                            # now press remote keys
```

Press each key and note which ones show up (as `USER_CONTROL_PRESSED`): the arrows, OK, Back, the four colour keys, digits, Guide, Channel up/down, Play, Pause, Stop, Rewind, Fast forward. Keys that don't appear are ones the TV keeps for itself. Press Ctrl+C to stop. Then run the probe script again, so the report includes the CEC section.

## What the results decide

| Result | Decision it drives |
|--------|--------------------|
| Hardware decode profiles | Whether this box needs any help from the Hub for AV1 or HEVC 10-bit |
| HDR10 and HLG badges | Whether KWin passes HDR through on this distro version, or mpv converts HLG |
| 24p smoothness | Per-title refresh switching in the box agent |
| Audio results | Which formats are passed through and which are decoded |
| CEC keys | Remote mapping (PLAN §5.4) and whether an air-mouse backup is needed |
| KWin, Mesa and mpv versions | The distro choice (ADR 0002): Arch for the newest HDR stack, or Debian 13 if its versions pass every test |
