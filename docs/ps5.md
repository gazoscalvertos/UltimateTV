# A PS5 running Linux

There is no PS5 app. There is one way to watch UltimateTV on a PlayStation 5: the console is put into
Linux by its owner, and the ordinary **Linux AppImage** runs there, in a window, against the Hub.

That is a real answer and a narrow one. It works on a console that was deliberately kept offline at
**firmware 13.60 or below** and has been jailbroken, and it costs the console its PlayStation
services. If your PS5 is on 14.00 or later, or you would rather keep PSN, this page has nothing for
you — the console can't be taken back to an older firmware.

## What works, and what doesn't

**Works, in principle:**

- The Linux AppImage: the same app as on a Linux desktop, in a normal window, playing through mpv
  ([desktop.md](desktop.md)).
- Hardware video decode from the console's GPU: H.264, HEVC Main and Main10, VP9, VC-1 and MPEG-2.
  A 1080p H.264 channel or film is decoded by the hardware.
- Output up to 4K at 60 Hz over HDMI.

**Doesn't work:**

- **A PS5 app.** No native client exists and none is planned ([why](#why-not-a-ps5-app)).
- **The PS5's browser.** It has no address bar and no tabs and closes when you leave it; it is not a
  place to run the TV app.
- **Casting to the console.** A PS5 is not an AirPlay, Chromecast, Miracast or DLNA receiver, and no
  homebrew changes that. Media Player on the PS5 side reads USB disks only.
- **PSN.** A console held at 13.60 can't sign in, so no store, no online play and no cloud saves
  while it stays on that firmware.

**Not tested here.** This has not been tried on a PS5 by this project. Everything above about the
console comes from the Linux port's own documentation, not from watching this app run on one. Treat
the first attempt as an experiment, and see [What's untested](desktop.md#whats-untested) for the
desktop app's own gaps.

## What you need

- A PS5 on firmware **3.00–13.60** (Phat or Slim) or **11.00–13.60** (Pro), kept offline so it
  doesn't update itself. 14.00 and later are not supported by the Linux loader and can't be
  downgraded.
- A **USB SSD of 64 GB or more**, which is what the loader boots Ubuntu from. Ubuntu, the app and
  your downloads all live on it.
- A **keyboard and a mouse**, at least for the install and the first start. The loader needs them,
  and so does getting around Ubuntu before the app is running.
- An **HDMI display**, and the console's normal video output.
- The **Hub** on the same network, and the Hub's address.

## 1. Put Linux on the console

This part isn't ours and isn't documented here: follow
[`ps5-linux-loader`](https://github.com/ps5-linux/ps5-linux-loader), which boots Ubuntu 26.04 from a
USB SSD, and its README for your model and firmware. Which exploit gets you in depends on the
firmware, and that is the loader's business, not this page's.

Two things about it are worth knowing before you start, because they don't go away later:

- **There is no dual boot.** Going into Linux means running the exploit again, and the console goes
  through Rest Mode first. The PS5 side is still there; getting back to it is a reboot.
- **A kernel update breaks the boot.** The loader is built for a particular kernel, so a kernel
  update can stop the console booting Linux until the loader catches up. When Ubuntu offers one,
  don't take it.

## 2. Run the app

Once Ubuntu is up on the console's HDMI output, it is an ordinary Ubuntu desktop, and the Linux
instructions apply: [desktop.md](desktop.md#linux-the-appimage) has the full version. The short one,
in a terminal:

```sh
sudo apt install mpv
mkdir -p ~/Applications ~/.config/ultimatetv
curl -L -o ~/Applications/UltimateTV.AppImage \
  https://github.com/gazoscalvertos/UltimateTV/releases/download/desktop-app/UltimateTV-x86_64.AppImage
chmod +x ~/Applications/UltimateTV.AppImage
echo 'HUB_URL=http://192.168.0.19:8095' > ~/.config/ultimatetv/box.env
~/Applications/UltimateTV.AppImage
```

Put your own Hub's address in `box.env`. The AppImage needs **FUSE 2**, as on any Linux; if it says
so and won't start, either install it or run it with `--appimage-extract-and-run`. The AppImage's
own [What you need](desktop.md#what-you-need) says the same thing.

The first start shows a four-letter code. Let it in on the TV (Settings › Phones and remotes) or on
the phone, then pick a profile as on the TV ([pairing.md](pairing.md)).

## What's awkward

- **The exploit, every boot.** Turning the console on and watching something means running the
  exploit and booting Linux first. It is not a TV you sit down in front of and press a button on.
- **No suspend or resume.** The console either stays on or shuts down and goes through the exploit
  again. Leave it on while you're watching.
- **Sound and picture can be fussy.** Some monitors and TVs need convincing: if there's no sound, or
  the picture is the wrong size or refresh rate, set `AUDIO_DEVICE` or `MPV_ARGS` in `box.env` as
  [desktop.md](desktop.md#settings) describes.
- **No refresh-rate matching and no HDR switching.** The desktop app leaves the screen's mode alone,
  so a 24p film plays at whatever the console is set to. The TV box does match the frame rate; this
  doesn't.
- **The controller is not a remote.** The app is driven by keys the desktop app already listens for:
  arrows, Enter, Escape and F1–F4 for the colour keys. Use a keyboard and mouse, or a USB remote that
  types those keys; a DualSense is not one of them.
- **It costs the PlayStation side.** Keeping the console at 13.60 keeps it off PSN, and jailbreaking
  is against Sony's terms and risks the warranty. That is your call to make, not this project's.

## Why not a PS5 app

Because it would be a second product. Native homebrew on the PS5 is real — unsigned C++ builds
install as home-screen tiles, and two media clients already exist (Kodi, and a Vulkan Jellyfin client
that works on firmware 4.03) — so a PS5 TV app is possible. It is also a codebase in C++ and Vulkan
that shares nothing with the TypeScript, SolidJS and Electron/mpv app this project has, written for
consoles stuck at 13.60 or below, and kept working against a firmware that keeps moving.

The cheapest honest support is the Linux one on this page: the console runs the AppImage we already
ship. [ADR 0004](adr/0004-jailbroken-ps5-means-linux.md) records the decision and the alternatives
that were rejected with it — a native client, the console's browser, casting, and Sony's official
SDK, which needs a PlayStation Partners membership, a devkit and certification.

## If something isn't right

- **"AppImages require FUSE to run"**: install FUSE 2, or run
  `~/Applications/UltimateTV.AppImage --appimage-extract-and-run`.
- **"The Hub didn't answer"**: check `HUB_URL` in `~/.config/ultimatetv/box.env`.
- **Choppy or black video**: try `MPV_ARGS=--hwdec=no` to rule out the hardware decoder, and
  `mpv --hwdec=auto-safe somefile.mkv -v | grep hwdec` to see which one mpv picked.
- **No sound**: `mpv --audio-device=help` lists the outputs; put the right one in `AUDIO_DEVICE`.
- **Anything else:** [desktop.md](desktop.md#if-it-goes-wrong) has the desktop app's own list, and
  `~/.local/state/ultimatetv-desktop.log` has the log.
