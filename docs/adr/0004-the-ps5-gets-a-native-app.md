# ADR 0004: The PlayStation 5 gets its own app, not just a browser

- Status: accepted (2026-11-03); the player and drawing choices are superseded by [ADR 0005](0005-the-ps5-builds-on-evo-players-engine.md)
- Decider: Gary

## Context

[GitHub issue #182](https://github.com/gazoscalvertos/UltimateTV/issues/182) asked for the PlayStation 5. The first answer in this repository was documentation only: the console's own browser is hidden, not openable and closes when you leave it, so the plan was to run the Linux AppImage on a PS5 its owner had put into Linux ([ps5.md](../ps5.md)).

That missed how the console is actually used here. A jailbroken PS5 runs homebrew: a program is built with an ordinary C/C++ toolchain, signed with a fake licence, dropped into a folder on the console's disk, and it appears on the home screen as a tile and starts when it is picked — exactly like a game. The household's PS5 has been running homebrew this way for a while. So the right question was never "can the PS5 run a web page", it was "what does a native PS5 homebrew app need".

The pieces are all available:

- **A toolchain**: `ps5-payload-sdk` is an LLVM/Clang cross toolchain producing ordinary ELF for the console's x86-64 FreeBSD-derived OS, and `make_fself.py` fake-signs an executable into the `eboot.bin` the console installs.
- **The libraries**: the SDK's prebuilt homebrew bundle carries SDL2, ImGui, FFmpeg, libcurl and — decisively — `SDL_kitchensink`, a video player that takes a URL and gives back a texture and audio. A native app can show a picture, play a film and talk HTTP.
- **The Hub is already an HTTP API**: the Android client and the box speak it, and everything the TV shows comes from `GET /api/home`, `GET /api/guide` and `POST /api/play`.

What is *not* available decides the shape of the app: there is no Chromium or WebKit the app can embed, the console's own browser is not an app host, and the SDK has no console-specific hardware video decoder — so the picture is decoded in software (the console's CPU is 8 cores at 3.5 GHz, which is plenty for 1080p, and the app asks for 1080p rather than 4K on purpose).

## Decision

The PlayStation 5 gets a **native homebrew app** in `ps5/`, not a web page and not a Linux install:

- It is **the same client as the others**, not a new backend: it pairs with the Hub, picks a profile (including a PIN), and draws the Hub's Home rails and guide. Nothing about the Hub changes to serve it.
- It is **split in two** so it can be tested without a console: `ps5/src/ui.cpp` and its neighbours hold the screens, the keys, the JSON and the Hub calls in plain C++20 with no SDL in them, and `ps5/src/platform_sdl.cpp` plus `ps5/src/video.cpp` are the only files that know about SDL, ImGui or the console's decoder. `make -C ps5 test` runs the first half anywhere; CI runs it on every change.
- It is **1080p on purpose**. The decoder is software, so asking for 4K would drop frames. The app asks the Hub for a stream, not for a transcode: the Hub does not transcode, and adding that is a separate decision.
- It ships as **the documented homebrew route**: `make -C ps5 tile` builds `eboot.bin` and the `sce_sys` folder, and `make -C ps5 install PS5_HOST=…` copies that folder to a console that is already running the payload loader and its FTP server.
- **Linux on the PS5 stays documented too** ([ps5.md](../ps5.md)). The native app needs a jailbroken console on firmware the exploit covers; Linux needs more setup but no jailbreak ceiling. Both are written down because both work.

## What this rules out

- A **web app in the console's browser**: the browser is not an app host and cannot be opened as one.
- **Casting** to the PS5: the console receives nothing of the sort, and Amazon/Google/Sony cast protocols are not open to a homebrew title.
- The **official PlayStation SDK** (WebMAF, the Media SDK, a maintained WebKit): it needs a development kit, a PlayStation Partners account and certification. That is not a route a household app can take, and saying otherwise would be a promise nobody here can keep.
- **A DLNA server in the Hub** so that the console's Media Player can see the films: it would only work for downloaded files, not live TV or the guide, and it is a great deal of work for the least of the outcomes.

## Consequences

- The app is only for consoles someone has chosen to jailbreak, and only on firmware the exploit still covers. A console that updates past it cannot run the app until a new exploit appears; the documentation says so plainly rather than pretending otherwise.
- There is now C++ in a repository that was TypeScript and Kotlin. The split above keeps it to one folder, one Makefile and one CI job, and the app has no dependency the SDK bundle doesn't already carry.
- The PS5 app is a **third client of the Hub's HTTP API**, which is a good pressure test of that API: anything the app needed that the Hub didn't already answer has to be a real gap, not a convenience.
