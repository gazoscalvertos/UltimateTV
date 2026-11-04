# UltimateTV on a PlayStation 5

UltimateTV runs on a PlayStation 5 as a **homebrew app**: it appears on the console's home screen as a tile and starts like a game. It is the same viewer as the TV, the phone and the box — it pairs with the Hub, picks a profile, and shows Home, the guide and films from the same place.

It needs a **jailbroken console**, because that is the only way to run anything that Sony did not sign. If your console is not jailbroken, or its firmware has gone past what the exploit covers, the way to use UltimateTV on it is to put the console into Linux instead — see [Linux on the PS5](#linux-on-the-ps5) below.

**Note:** this app has been built and tested against a console's toolchain, but **not yet started on a real PlayStation 5**. If something goes wrong, [say what happened](#if-it-wont-start) and the reason is almost certainly on this page.

## What you need

- A PS5 that is **jailbroken**, on a firmware the exploit covers. The public exploit currently reaches **13.60** at the highest; 14.00 and later are patched, and firmware cannot be downgraded. If the console has been online recently it is probably past that.
- The console on the home network with the Hub, so it can reach the Hub's address.
- A way to copy files to the console once it is jailbroken: the usual route is the payload loader plus its FTP server, both of which are part of the standard jailbreak.

## Installing

The app is built from source in this repository — the console app is about 50 MB and the installable tile about 36 MB, so neither is checked in the tree. Building it needs [the SDK and the libraries](#building-it), which is a job for a computer, not the console.

**If you would rather not build it**, [the PS5 release page](https://github.com/gazoscalvertos/UltimateTV/releases/tag/ps5-app) carries the three files, built from `main`:

| File | Route into the console |
| --- | --- |
| `UltimateTV-PS5.pkg` | Install it as a package — the console puts the tile up itself. The simplest of the three. |
| `UltimateTV-PS5.elf` | Run it straight away over the payload loader on port 9021. No install, no tile, gone when the console restarts. |
| `UltimateTV-PS5-tile.zip` | The folder route: unzip it and put the `PPSA26001` folder in `/data/homebrew/`, where a folder mounter picks it up. Has its own `README.txt`. |

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

   **If you would rather install a `.pkg`**, the same build can be wrapped in one:

   ```
   make -C ps5 pkg PS5_PKG_TOOL=/path/to/ffpfsc-pkg-tool
   ```

   That writes `ps5/build/pkg/UP9000-PPSA26001_00-ULTIMATETV000000-A0100-V0100.pkg`, and the target runs the tool's own checker over it before it finishes (29 checks, including the fake-signed `eboot.bin` inside and the metadata the console reads). The packaging tool is not part of this repository — it is .NET and about 80 MB — so the target refuses to guess and tells you to point `PS5_PKG_TOOL` at one. [ps5/README.md](https://github.com/gazoscalvertos/UltimateTV/blob/main/ps5/README.md) has the steps to build it.

   Either route ends the same way: the console has a tile called UltimateTV.

4. **Start it from the home screen.** The tile is called UltimateTV. The first start asks for nothing: the first screen to ask the Hub is let in, exactly like a TV, and the app shows a short code only if another screen is already paired and the Hub wants a "yes" from one of them.

5. **Tell it where the Hub is** if it can't find it. The app remembers the address once it has paired; on a fresh install it tries the address it was built with, and if it can't reach a Hub it says so and offers an address box.

## Using it with the controller

The controller is the remote. The app draws its own picture, so there is nothing to learn:

| Button | What it does |
| --- | --- |
| D-pad up/down | Move between rows, rails and the list on the left |
| D-pad left/right | Move along a rail, or step through a film's timeline |
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

- **The tile is there but the screen stays black.** The app is starting but the picture isn't coming up. Check the console's own log if it has one, and tell the maintainer what the firmware version is — the sdks' SDL and video paths differ across firmware.
- **It says it can't reach the Hub.** The address is wrong or the Hub is off. The Hub is at `http://<the house's server>:8095`; the address box on the app's first screen takes it.
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
make -C ps5 clean
```

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
| `ps5/src/ui.cpp` | Every screen and key: the picker, the PIN pad, Home, the guide, the player |
| `ps5/src/platform_sdl.cpp` | The only file that knows about SDL and ImGui: a window, the controller, and the drawing |
| `ps5/src/video.cpp` | The only file that knows about SDL_kitchensink: a film on screen with its sound |

`ps5/src/eboot.x` is the linker script that gives the app the console's process-parameter header — without it the fake-signed tile is rejected.

## Linux on the PS5

A PS5 can also be put into Linux, and the [Linux app](desktop.md#linux-the-appimage) runs there. That route does not need the tile or the jailbreak's app folder, and it has no firmware ceiling of its own — but it is more setup, needs a USB disk for the install, and the console has to be put into Linux again after each boot. If you want UltimateTV on the console and the jailbreak route is not available, that is the way.
