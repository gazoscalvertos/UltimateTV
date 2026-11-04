# The PlayStation 5 app

UltimateTV as a native app for a jailbroken PlayStation 5. It sits on the console's home screen
as a tile and starts like a game, then shows the same Home, guide, live TV, films and profiles as
the TV — because it is the same client of the same Hub.

The instructions for installing it, using the controller, and what it can and can't do are in
[../docs/ps5.md](../docs/ps5.md). Why it is a native app rather than a web page or a Linux install
is [../docs/adr/0004-the-ps5-gets-a-native-app.md](../docs/adr/0004-the-ps5-gets-a-native-app.md).

**If you just want it on a console**, you do not need to build anything: [the PS5 release
page](https://github.com/gazoscalvertos/UltimateTV/releases/tag/ps5-app) has a `.pkg`, the app on
its own, and the tile folder, all built from `main`.

## Building

```
make test       # the tests, anywhere, with no console and no SDK
make console    # build/ultimatetv.elf, the app
make tile       # build/PPSA26001/eboot.bin, the installable tile
make package    # the tile plus icon0.png and param.json
make homebrew   # build/homebrew/PPSA26001/, the folder a mounter registers
make homebrew-upload PS5_HOST=192.168.0.42   # and copy it to /data/homebrew/ on the console
make install PS5_HOST=192.168.0.42   # copy it to a console and register the tile
make pkg PS5_PKG_TOOL=/path/to/ffpfsc-pkg-tool   # wrap the same tile in a .pkg
make clean
```

`make test` is the one you can run right now with a C++20 compiler and nothing else:

```
$ make test
== json
...
12 tests, 0 failed
```

`console`, `tile`, `package` and `install` need the console's SDK and its homebrew library bundle.
Set two variables and everything else is the same:

```
PS5_PAYLOAD_SDK=/opt/ps5/ps5-payload-sdk \
PS5_DEVROOT=/opt/ps5/devroot/opt/ps5-payload-sdk/target/user/homebrew \
make package
```

- **The SDK** is [ps5-payload-dev/sdk](https://github.com/ps5-payload-dev/sdk) — an LLVM/Clang
  cross toolchain plus the console's libraries and the `make_fself.py` that fake-signs the tile.
- **The libraries** are the prebuilt homebrew bundle from
  [ps5-payload-dev/pacbrew-repo](https://github.com/ps5-payload-dev/pacbrew-repo/releases): SDL2,
  ImGui, FFmpeg, libcurl and SDL_kitchensink. `PS5_DEVROOT` is the folder inside it that holds
  `lib/` and `include/`.

Nothing built here is committed: the app is about 55 MB and the tile about 36 MB, and both are
generated from source. `build/` and `.hosttest/` are gitignored.

### The folder route is the one that works on a current console

`make homebrew` builds `build/homebrew/PPSA26001/`, holding `eboot.bin` and `sce_sys/` — one
folder named after the title, which is the shape a folder mounter (ShadowMountPlus and friends)
scans `/data/homebrew/` for. `make homebrew-upload PS5_HOST=…` copies exactly that to the
console.

**This is the route to use on firmware 12.00 and above.** A fake `.pkg` installs there and then
will not launch, because the console's own package filesystem mount fails (`sceFsMountPprPkg() ret
= 80020016`) — the patches that allow a fake package were never ported past 12.00. A folder has
no filesystem to mount, so there is nothing for the console to refuse. Keep `make pkg` for a
console on older firmware or one that already has the fake-package patches.

### Making a `.pkg`

`make install` is the homebrew route: it copies the folder and asks the console's installer to
register it. A console with a package installer wants a `.pkg` instead, and `make pkg` makes one
— but it needs a packaging tool that is deliberately not in this repository (it is .NET, about
80 MB, and only one of the two install routes uses it).

```
# once, somewhere outside the repo:
git clone --depth 1 https://github.com/knutwurst/ps5-ultrapack
cd ps5-ultrapack
./BUILD_PKG_TOOL.sh          # needs a .NET 9 SDK; edit the RID to linux-x64 on Linux
# then, in this repository:
make pkg PS5_PKG_TOOL=/path/to/ps5-ultrapack/backend/native/ffpfsc-pkg-tool
```

The target stages the tile in the shape a package wants (`eboot.bin` at the top, metadata under
`sce_sys/` — a different layout from the flat folder `make package` makes), builds
`build/pkg/UP9000-PPSA26001_00-ULTIMATETV000000-A0100-V0100.pkg`, and runs the tool's own checker
over it, which must report 29 passed and 0 failed.

`ps5/sce_sys/param.json` carries a `contentId` for exactly this reason: the tool checks that it
matches the title id, and a package without one builds but is called incoherent.

## How it is split, and why

| File | What it does | Needs a console? |
| --- | --- | --- |
| `src/json.cpp` | A small JSON reader and writer, because the console has no JSON library | no |
| `src/http.cpp` | Plain-socket HTTP to the Hub. No HTTPS: the Hub is on the home network | no |
| `src/hub.cpp` | The Hub's API: health, pairing, profiles, PIN, Home, the guide, play, progress | no |
| `src/model.cpp` | The Hub's answers as C++ types | no |
| `src/text.cpp` | Times, dates and lengths in words ("Today 21:00", "1 h 2 min") | no |
| `src/address.cpp` | The Hub's address as four numbers and a port, because the console has no keyboard | no |
| `src/display.cpp` | What size to draw at, and how much bigger the text has to be for it | no |
| `src/ui.cpp` | Every screen and every key: the picker, the PIN pad, Home, the guide, the player | no |
| `src/platform_sdl.cpp` | The window, the controller and the drawing: the only SDL and ImGui in the tree | yes |
| `src/video.cpp` | A film on screen with its sound: the only SDL_kitchensink in the tree | yes |
| `src/main.cpp` | The loop: keys in, frames out | yes |
| `src/eboot.x` | The linker script that gives the app its console process-parameter header | building |
| `installer/install.c` | The tiny ELF that tells the console's installer the folder is a title | installing |
| `sce_sys/` | `param.json`, `param.json.system` and the generated `icon0.png` | installing |
| `test/` | The tests, in `test.hpp`'s own tiny runner | no |

Everything in the top half of that table is plain C++20 with no SDL, no ImGui and no console
headers, which is what lets `make test` run in CI on an ordinary Linux machine. The seam between
the halves is `src/platform.hpp`: a `Window` that draws a `View` and hands back key presses, and a
`Video` that plays a `PlaybackInfo`. The tests swap in their own `InlineJobs`, `HttpTransport` and
`Video`, so a whole session — pair, pick a profile, enter a PIN, open the guide, start a film,
go back — is testable without anything running.

The tile's picture is generated by `node ../tools/ps5/make-icon.mjs`, and
`node ../tools/ps5/make-icon.mjs --check` proves the committed `sce_sys/icon0.png` is the one the
script draws.

## Things worth knowing before changing it

- **The app draws at the size the console gives it** — 3840×2160 on a 4K television, 1920×1080
  otherwise — and scales the font and the layout with the height, so the picture is not a 1080p
  canvas stretched up. It asks the Hub for a stream, not a transcode, and tells the decoder the
  surface size so a 4K film reaches the screen at 4K. The console decodes in software (there is no
  hardware decoder in the SDK), so 1080p is comfortable and 4K may drop frames; `--1080p` asks for
  a 1080p picture when it does. `src/display.cpp` holds the arithmetic and `make -C ps5 test` proves
  it.
- **A PIN's token has to be kept.** The Hub answers a PIN-protected profile that sends no token
  with the Kids profile instead of refusing (see `Profiles.resolve` in `hub/src/profiles.ts`), so
  dropping the token after a correct PIN silently shows the wrong profile. `Hub::setProfileToken`
  is how the token gets on every request; `SavedSession::profileToken` keeps it between starts.
- **Pairing code**: the first screen to ask the Hub is let in with no code. On a console that is
  not the first screen, the Hub answers with a pending request and a four-letter code, and the app
  polls `POST /api/pair/screen/:id` until someone lets it in on the TV.
- **Files are not a tile.** The console only puts an app on its home screen once the console's
  own installer (`sceAppInstUtilAppInstallTitleDir`) has been told about the folder, which is why
  `make install` ends by running `build/installer.elf` over the payload loader. Copying files and
  rebooting is not enough, and the app's `eboot.bin` goes under `/system_ex/app/<id>/` while the
  metadata goes under `/user/app/<id>/sce_sys/` — that split is the console's, not ours. The other
  route is the one most 2026 homebrew uses: drop the folder in `/data/homebrew/` and let
  ShadowMountPlus register it.
- **A `.pkg` installs but does not launch on firmware 12.00 and above.** The console refuses to
  mount a fake package's filesystem (`sceFsMountPprPkg() ret = 80020016`) because the patches that
  allow it were never ported past 12.00. That is the console's rule, not the app's, and it is why
  `make homebrew` exists and is the first route in the docs.
- **The tile is ET_EXEC, not PIE.** `make_fself.py` refuses a position-independent executable, so
  the tile link uses `-Wl,--no-pie -T src/eboot.x`, and `eboot.x` has to keep the `.eh_frame`
  symbols that libunwind asks for — without them a C++ app cannot link.
