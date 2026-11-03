# UltimateTV on a PlayStation 5

UltimateTV runs on a PlayStation 5 as a **homebrew app**: it appears on the console's home screen as a tile and starts like a game. It is the same viewer as the TV, the phone and the box — it pairs with the Hub, picks a profile, and shows Home, the guide and films from the same place.

It needs a **jailbroken console**, because that is the only way to run anything that Sony did not sign. If your console is not jailbroken, or its firmware has gone past what the exploit covers, the way to use UltimateTV on it is to put the console into Linux instead — see [Linux on the PS5](#linux-on-the-ps5) below.

**Note:** this app has been built and tested against a console's toolchain, but **not yet started on a real PlayStation 5**. If something goes wrong, [say what happened](#if-it-wont-start) and the reason is almost certainly on this page.

## What you need

- A PS5 that is **jailbroken**, on a firmware the exploit covers. The public exploit currently reaches **13.60** at the highest; 14.00 and later are patched, and firmware cannot be downgraded. If the console has been online recently it is probably past that.
- The console on the home network with the Hub, so it can reach the Hub's address.
- A way to copy files to the console once it is jailbroken: the usual route is the payload loader plus its FTP server, both of which are part of the standard jailbreak.

## Installing

The app is built from source in this repository — the console app is about 50 MB and the installable tile about 36 MB, so neither is checked in. Building it needs [the SDK and the libraries](#building-it), which is a job for a computer, not the console.

1. **Build the tile.** On a Linux machine with the SDK:

   ```
   make -C ps5 tile package
   ```

   That writes `ps5/build/PPSA26001/`, holding `eboot.bin`, `icon0.png` and `param.json`.

2. **Jailbreak the console** the way you normally do, so the exploit is running and its FTP server is up on port 2121.

3. **Copy the folder across.** With the console's address:

   ```
   make -C ps5 install PS5_HOST=192.168.0.42
   ```

   Or by hand, with any FTP client: make `/user/app/PPSA26001/sce_sys/` on the console and upload `eboot.bin` to `/user/app/PPSA26001/`, and `icon0.png` and `param.json` into `sce_sys/`.

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

- **No 4K.** The picture is decoded with the console's general-purpose CPU, not a video chip, so the app asks for 1080p on purpose. A 4K stream will play but may drop frames.
- **No downloads, recordings or Settings.** Those stay on the TV, the phone and the box. The console is a viewer.
- **Nothing offline.** The app needs the Hub. The box's [Limited mode](backup.md#when-the-hub-is-down-limited-mode) is the thing for when the Hub is down, not this.
- **No updates from the Hub.** The tile is copied to the console by hand; rebuilding and copying it again is how a new version arrives.

## If it won't start

- **The tile is there but the screen stays black.** The app is starting but the picture isn't coming up. Check the console's own log if it has one, and tell the maintainer what the firmware version is — the sdks' SDL and video paths differ across firmware.
- **It says it can't reach the Hub.** The address is wrong or the Hub is off. The Hub is at `http://<the house's server>:8095`; the address box on the app's first screen takes it.
- **It says it needs a code.** Another screen is already paired, so the Hub wants a "yes" from one of them: the app shows a four-letter code, and you let it in from the TV's Settings › Phones and remotes. Then press Cross on the app to try again.
- **A film is sound but no picture, or stutters.** The CPU is doing the decoding and the source is too big. Try the TV for that title; the console is built for 1080p.
- **The console updated and the app stopped working.** The exploit only covers the firmware it covers. Once the console is past it, the app cannot run until a new exploit appears. Putting the console into Linux is the other way to use UltimateTV on it.

## Building it

The app is in [`ps5/`](../ps5) and has one Makefile:

```
make -C ps5 test       # the tests, on any Linux machine, no console and no SDK
make -C ps5 console    # the app itself: ps5/build/ultimatetv.elf
make -C ps5 tile       # the installable tile: ps5/build/PPSA26001/eboot.bin
make -C ps5 package    # the tile plus icon0.png and param.json
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
