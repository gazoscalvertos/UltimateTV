# UltimateTV on a PlayStation 5

> **The PS5 app is being rebuilt.** The `.elf` and tile described below cannot show a picture on a real console (a payload has no access to the hardware decoder or the GPU). The replacement is an installable title built on EVO Player's engine: see [ps5-architecture.md](ps5-architecture.md). Until it has been seen on a console, treat everything below as the old app.


UltimateTV runs on a PlayStation 5 as a **homebrew app**: it appears on the console's home screen as a tile and starts like a game. It is the same viewer as the TV, the phone and the box — it pairs with the Hub, picks a profile, and shows Home, the guide and films from the same place.

It needs a **jailbroken console**, because that is the only way to run anything that Sony did not sign. If your console is not jailbroken, or its firmware has gone past what the exploit covers, the way to use UltimateTV on it is to put the console into Linux instead — see [Linux on the PS5](#linux-on-the-ps5) below.

**Note:** this app has been built and tested against a console's toolchain, but **not yet started on a real PlayStation 5**. If something goes wrong, [say what happened](#if-it-wont-start) and the reason is almost certainly on this page.

## What you need

- A PS5 that is **jailbroken**, on a firmware the exploit covers. The public exploit currently reaches **13.60** at the highest; 14.00 and later are patched, and firmware cannot be downgraded. If the console has been online recently it is probably past that.
- The console on the home network with the Hub, so it can reach the Hub's address.
- A way to copy files to the console once it is jailbroken: the usual route is the payload loader plus its FTP server, both of which are part of the standard jailbreak.

## Installing

The app is built from source in this repository — the console app is about 50 MB and the installable tile about 36 MB, so neither is checked in the tree. Building it needs [the SDK and the libraries](#building-it), which is a job for a computer, not the console.

**If you would rather not build it**, [the PS5 release page](https://github.com/gazoscalvertos/UltimateTV/releases/tag/ps5-app) carries the three files. CI rebuilds the `.elf` and the tile zip on every merge to `main` (the `ps5-console` job), so they always match `main`; every pull request's run also has them as a downloadable artifact. The `.pkg` is built by hand:

| File | Route into the console |
| --- | --- |
| `UltimateTV-PS5-tile.zip` | **Start here.** The folder route: unzip it, put the `PPSA26001` folder in `/data/homebrew/`, and a folder mounter registers the tile. This is the route that works on a current console. Has its own `README.txt`. |
| `UltimateTV-PS5.elf` | Run it straight away over the payload loader on port 9021. No install, no tile, gone when the console restarts. The quickest way to see whether it starts at all. |
| `UltimateTV-PS5.pkg` | Install it as a package. On firmware 12.00 and above a fake package **installs and then will not launch** — see [why](#the-package-does-not-launch). Keep it for a console on older firmware, or if you know your console has the fake-package patches. |

### The package does not launch

A fake `.pkg` appears on the home screen on firmware 12.00 and above and then fails to start,
with the console's log showing:
>
```
sceFsMountPprPkg() ret = 80020016
PfsMountGameData_PPR() ret = 0x80020016
PrepareProcessLaunchPkg() ret = 80020016
```

`0x80020016` is the console refusing to mount the package's filesystem. It is not about the
package: it is a one-line gate in the jailbreak. In kstuff-lite's `ps5-kstuff/uelf/fpkg.c` the
function `get_ppr_profile()` returns `NULL` for anything above firmware 11.60 —

```c
/* Keep the newer profiles and offsets available for later work, but do
 * not arm plaintext PPR interception above 11.60. */
if (FWVER > 0x1160)
    return NULL;
```

— and `control_ppr_plaintext_request()` refuses the mount when it gets `NULL`, which ShellCore
reports as `0x80020016`. The firmware 12.00 and 13.60 profiles are still in the source; that
guard is what makes them unreachable. The history is explicit: commit `a7ca1c3` (2026-09-19)
enabled plaintext PPR interception through 13.60, and `bd8928c` (2026-09-20) limited it back to
11.60.

So **every** fake package fails to mount on 12.00–13.60, and `ffpfsc-pkg-tool` — the tool that
builds this one — documents the same ceiling: install-and-launch works "up to at least 11.60 …
with kstuff-lite 1.13+". **Use the folder route** (`UltimateTV-PS5-tile.zip`, or
`make -C ps5 homebrew-upload`): nothing about a folder is fake, so there is nothing to patch.

A project whose packages do work on a current console is not a counter-example. BlackBox, for
instance, ships no `.pkg` at all: its release asset is a `.ffpkg`, a UFS2 filesystem image that
ShadowMountPlus mounts from `/data/homebrew` and registers through `sceAppInstUtilAppInstallAll`.
It never asks the console to mount a package, so the gate above never applies to it.

The steps below are the same whichever way you got the files.

1. **Build the tile.** On a Linux machine with the SDK:

   ```
   make -C ps5 tile package
   ```

   That writes `ps5/build/PPSA26001/`, holding `eboot.bin`, `icon0.png` and `param.json`.

2. **Jailbreak the console** the way you normally do, so the exploit is running, its FTP server is up on port 2121, and the payload loader is listening on port 9021.

3. **Install it.** With the console's address:

   ```
   make -C ps5 install PS5_HOST=192.168.0.42
   ```

   That copies the files to the two places the console keeps them (`eboot.bin` under `/system_ex/app/PPSA26001/`, the metadata under `/user/app/PPSA26001/sce_sys/`) and then runs a small installer on the console, because **files on their own are not a tile**: the console's own installer has to be told the folder is a title. You will see `installed PPSA26001: look for UltimateTV on the home screen` when it has worked.

   Two other ways, if you would rather do it by hand:
   - **The folder-mounter route**, which is how most 2026 PS5 homebrew installs: put `eboot.bin` and `sce_sys/` in one folder named `PPSA26001`, copy that folder to `/data/homebrew/`, and let ShadowMountPlus pick it up. It appears under *Media* on the home screen.
   - **Copy `/system_ex/app/PPSA26001/eboot.bin`** with it. Some firmware needs the app's own file there even when a mounter made the tile.

   The simplest version of this is one command:

   ```
   make -C ps5 homebrew-upload PS5_HOST=192.168.0.42
   ```

   It builds the folder and copies it to `/data/homebrew/PPSA26001/` on the console, which is
   all a folder mounter needs.

   **If you would rather install a `.pkg`** — remembering [the firmware limit](#the-package-does-not-launch) — the same build can be wrapped in one:

   ```
   make -C ps5 pkg PS5_PKG_TOOL=/path/to/ffpfsc-pkg-tool
   ```

   That writes `ps5/build/pkg/UP9000-PPSA26001_00-ULTIMATETV000000-A0100-V0100.pkg`, and the target runs the tool's own checker over it before it finishes (29 checks, including the fake-signed `eboot.bin` inside and the metadata the console reads). The packaging tool is not part of this repository — it is .NET and about 80 MB — so the target refuses to guess and tells you to point `PS5_PKG_TOOL` at one. [ps5/README.md](https://github.com/gazoscalvertos/UltimateTV/blob/main/ps5/README.md) has the steps to build it.

   Either route ends the same way: the console has a tile called UltimateTV.

4. **Start it from the home screen.** The tile is called UltimateTV. The first start asks for nothing: the first screen to ask the Hub is let in, exactly like a TV, and the app shows a short code only if another screen is already paired and the Hub wants a "yes" from one of them.

5. **Tell it where the Hub is** if it can't find it. The app starts with the house's Hub at
   `http://192.168.0.19:8095` and remembers whichever address worked. If that is wrong, its first
   screen has an address you can change **with the controller** — the console has no keyboard, so
   the four numbers and the port are edited one at a time: up and down change the number under
   the cursor, left and right move between the five, and Cross tries it. (You can also pass an
   address on the command line, `ultimatetv.elf http://host:8095`, which is what the installer
   does for a new console.)

6. **If it shows a tile and then a black screen**, look at `/data/ultimatetv/last-run.log` on the
   console. The app writes down how far it got — whether the video player started, whether the
   window opened and at what size, which Hub address it went looking for, and what the Hub said.
   That file is the difference between "the console wouldn't run it" and "it ran and couldn't
   find the Hub". If the file is not there at all, the console never got as far as starting the
   app, which means the tile or the package is the problem — see
   [the package does not launch](#the-package-does-not-launch).

## Using it with the controller

The controller is the remote. The app draws its own picture, so there is nothing to learn:

| Button | What it does |
| --- | --- |
| D-pad up/down | Move between rows, rails and the list on the left; on the Hub-address screen, change the number under the cursor |
| D-pad left/right | Move along a rail, or step through a film's timeline; on the Hub-address screen, move between the numbers and the port |
| Cross (X) | Choose |
| Circle | Back |
| Square | Play/pause a film |
| Triangle | Info about what is selected |
| L1 / R1 | The guide |
| Options | The guide |
| PS button twice | Leave the app |

A film plays full screen with a bar along the bottom that fades out; press any button to bring it back. Cross pauses and plays, left and right skip back ten seconds and forward thirty, and Circle on the bar closes the app's own screen first and then the film.

## What it does

- **The same Home as the TV**: the hero title with Resume, the rails, Continue watching, films and recordings — whatever the Hub sends, in the same order.
- **The guide and live TV**: the channels the Hub knows, and picking a channel starts it.
- **Films and programmes**: the same titles the TV plays, including resuming where you stopped, because progress is reported to the Hub the same way.
- **Profiles**: the profile picker, with the PIN pad for a protected profile. Kids rules are the Hub's, so they are enforced here too.
- **Pairing**: the console pairs as a screen, so a phone can work it, the same as the TV.

## What it doesn't do

- **4K is asked for, but decoding is the limit.** The app now draws at whatever the console gives it — 3840×2160 on a 4K television, so a 4K film isn't shrunk to 1080p and stretched back up — and the text is scaled to match, so it looks the same size either way. But the SDK has no hardware decoder, so the console's general-purpose CPU decodes the picture. A 1080p film is comfortable; a 4K one may drop frames. If it does, start the app with `--1080p` to ask for a 1080p picture and let the console do the upscaling instead.
- **No downloads, recordings or Settings.** Those stay on the TV, the phone and the box. The console is a viewer.
- **Nothing offline.** The app needs the Hub. The box's [Limited mode](backup.md#when-the-hub-is-down-limited-mode) is the thing for when the Hub is down, not this.
- **No updates from the Hub.** The tile is copied to the console by hand; rebuilding and copying it again is how a new version arrives.

## If it won't start

- **The tile is there but the screen stays black.** Read `/data/ultimatetv/last-run.log` first. If it exists, the app is running and the file says how far it got — usually that the window would not open, or the Hub was not where it looked. If it does not exist, the app never started: that is the console refusing the tile, which for a `.pkg` on firmware 12.00 and above is [expected](#the-package-does-not-launch), and for a folder usually means the folder is in the wrong place or no mounter is running.
- **The log says "Couldn't find matching render driver" or "wouldn't give us a picture".** The window opened but nothing could draw into it. The log now has a block near the top listing the SDL version, the video driver, every display mode and every render driver this console's SDL has, then one `tried renderer ...` line per attempt with the console's own reason. The app tries software first, then the others, then the window's surface, then 1080p and 720p windows. To put one driver first without a new build, write its name (say `opengles2`) into `/data/ultimatetv/renderer.txt` over FTP and start the app again; delete the file to go back. Send the whole log if none of them work.
- **The log says the console gave no sound.** The app starts anyway and films play silently: a console's audio driver can refuse to initialise while the picture is fine, and the app now carries on instead of stopping at the first frame. Everything else works.
- **It says it can't reach the Hub.** The address is wrong or the Hub is off. The Hub is at `http://<the house's server>:8095`; the first screen has the four numbers and the port, and the controller changes them.
- **It says it needs a code.** Another screen is already paired, so the Hub wants a "yes" from one of them: the app shows a four-letter code, and you let it in from the TV's Settings › Phones and remotes. Then press Cross on the app to try again.
- **A film is sound but no picture, or stutters.** The CPU is doing the decoding and the source is too big for it, especially at 4K. Try the TV for that title, or start the app with `--1080p`.
- **The console updated and the app stopped working.** The exploit only covers the firmware it covers. Once the console is past it, the app cannot run until a new exploit appears. Putting the console into Linux is the other way to use UltimateTV on it.

## Building it

The app is in [`ps5/`](../ps5) and has one Makefile:

```
make -C ps5 test       # the tests, on any Linux machine, no console and no SDK
make -C ps5 console    # the app itself: ps5/build/ultimatetv.elf
make -C ps5 tile       # the installable tile: ps5/build/PPSA26001/eboot.bin
make -C ps5 package    # the tile plus icon0.png and param.json
make -C ps5 pkg        # the same, wrapped in a .pkg (needs PS5_PKG_TOOL, see Installing)
make -C ps5 homebrew   # the folder route: ps5/build/homebrew/PPSA26001/
make -C ps5 homebrew-upload PS5_HOST=...   # and copy it to /data/homebrew/ on the console
make -C ps5 ffpkg UFS2_TOOL=...   # the folder wrapped in a .ffpkg UFS2 image
make -C ps5 clean
```

`make ffpkg` makes the one-file form of the folder route: a UFS2 filesystem image, the layout
ShadowMountPlus mounts and the one the projects that work on a current console distribute. It
needs a UFS2 image builder (`mkufs2.sh`, or `UFS2Tool newfs -O 2 -b 65536 -f 65536 -m 0 -S 4096 -i
262144`), which is not part of this repository, so the target tells you to point `UFS2_TOOL` at
one rather than guessing. The files have to sit at the image's root, with no extra top-level
folder, or the mounter ignores the image.

`make test` needs nothing but a C++20 compiler, which is why it runs in CI on every change. `console`, `tile` and `package` need two things:

1. **The SDK**: [ps5-payload-sdk](https://github.com/ps5-payload-dev/sdk). Unzip it anywhere and point `PS5_PAYLOAD_SDK` at it.
2. **The libraries**: the [prebuilt homebrew bundle](https://github.com/ps5-payload-dev/pacbrew-repo/releases) — SDL2, ImGui, FFmpeg, libcurl and SDL_kitchensink. Unzip it and point `PS5_DEVROOT` at the folder inside it that holds `lib/` and `include/`.

```
PS5_PAYLOAD_SDK=/opt/ps5/ps5-payload-sdk \
PS5_DEVROOT=/opt/ps5/devroot/opt/ps5-payload-sdk/target/user/homebrew \
make -C ps5 package
```

The size the app draws at is worked out in [`ps5/src/display.cpp`](../ps5/src/display.cpp): the biggest mode the console offers, up to 4K, and every other size — the font, the bars, the largest picture the decoder is asked for — follows the height it actually got. `make -C ps5 test` proves that arithmetic without a console.

The tile's picture is generated, not drawn by hand: `node tools/ps5/make-icon.mjs` writes `ps5/sce_sys/icon0.png`, and `--check` proves the committed file is the one the script makes.

## How it's put together

There is an [ADR](adr/0004-the-ps5-gets-a-native-app.md) about why this is a native app rather than a web page or a Linux install. In short: the console has no browser an app can live in and no hardware video decoder, but it does run ordinary C++ homebrew, and the Hub is already an HTTP API that the phone and the box speak.

The app is split so that most of it can be tested anywhere:

| Part | What it does |
| --- | --- |
| `ps5/src/json.cpp` | A small JSON reader and writer — the Hub speaks JSON, and the console has no JSON library |
| `ps5/src/http.cpp` | Plain sockets HTTP: the app talks to the Hub, and HTTPS is not supported (the Hub is on the home network) |
| `ps5/src/hub.cpp` | The Hub's API: health, pairing, profiles, PIN, Home, the guide, play and progress |
| `ps5/src/model.cpp` | The Hub's answers as C++ types |
| `ps5/src/address.cpp` | The Hub's address as four numbers and a port, because the console has no keyboard to type one with |
| `ps5/src/display.cpp` | What size to draw at, and how much bigger the text has to be for it |
| `ps5/src/ui.cpp` | Every screen and key: the picker, the PIN pad, Home, the guide, the player |
| `ps5/src/platform_sdl.cpp` | The only file that knows about SDL and ImGui: a window, the controller, and the drawing |
| `ps5/src/video.cpp` | The only file that knows about SDL_kitchensink: a film on screen with its sound |

`ps5/src/eboot.x` is the linker script that gives the app the console's process-parameter header — without it the fake-signed tile is rejected.

## Linux on the PS5

A PS5 can also be put into Linux, and the [Linux app](desktop.md#linux-the-appimage) runs there. That route does not need the tile or the jailbreak's app folder, and it has no firmware ceiling of its own — but it is more setup, needs a USB disk for the install, and the console has to be put into Linux again after each boot. If you want UltimateTV on the console and the jailbreak route is not available, that is the way.
