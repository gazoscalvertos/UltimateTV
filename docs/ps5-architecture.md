# The PlayStation 5 architecture

Why the PS5 app is built the way it is, what it is built from, and what has not been tested. The decision is [ADR 0005](adr/0005-the-ps5-builds-on-evo-players-engine.md). How to install and use it is [ps5.md](ps5.md).

## Why the first app could not work

The first PS5 app ([ADR 0004](adr/0004-the-ps5-gets-a-native-app.md)) was an `.elf` run through the payload loader, drawing with SDL and decoding in software. On the console it failed before drawing anything:

```
sceKernelAllocateMainDirectMemory: Resource temporarily unavailable
```

A payload borrows a process that has no direct-memory budget. The console's hardware decoder (`sceVideodec2`) and GPU API (`sceAgc`) only work inside a **registered title**: its own title id and `param.json`, a sandbox, a user session, and a flexible-memory allowance (`kernel.flexibleMemorySize`, 1 GiB at most). The SDL the console ships has only a software renderer, so even with memory the app would have been 1080p and CPU-decoded. Renderer fixes (PR #207 and before) were treating the symptom.

## What the other PS5 apps do

| Project | What it is | How it plays video | How it draws | Relevance |
| --- | --- | --- | --- | --- |
| [EVO Player](https://github.com/sainsaji/EVO-PLAYER-PS5) (GPL-3) | Local, network and server player; Emby, Jellyfin, Plex, Stremio, IPTV, Xtream | `sceVideodec2` hardware decode: H.264, HEVC Main/Main10, VP9 to 4K; FFmpeg fallback, dav1d for AV1; HDR10, HLG, Dolby Vision P5 on the GPU | `sceAgc`, a UI kit and RmlUi for provider screens | The engine. Has a *provider* seam: logic in C, look in a downloadable RmlUi bundle |
| [Jelly5](https://github.com/02dnot/Jelly5) (GPL-3) | Native Jellyfin and Emby client with Live TV, music, Seerr requests | EVO's media engine | Its own GPU-drawn interface | Proof that a full custom app can sit on EVO's engine |
| [Nuvio PS5](https://github.com/theghostonline/Nuvio-PS5) (GPL-3) | The Nuvio web app in the console, native player | A native player the web page hands streams to | Web UI | The other route: show a web page, hand video to the engine |

All three ship as titles under `/data/homebrew/` and all three decode in hardware. None of them uses SDL or an `.elf`.

## The architecture

```
 PlayStation 5 (title PPSA26001, GPL-3)             Hub (NAS)
┌───────────────────────────────────────┐          ┌──────────────────────────────┐
│ EVO engine                            │          │ /api/ps5/catalog  ─ Home rows │
│  sceVideodec2 · AGC · HDR · audio     │          │ /api/ps5/search               │
│  DualSense · CEC · RmlUi              │ <── JSON │ /api/ps5/resolve  ─ stream    │
│                                       │          │ /api/ps5/progress             │
│ provider_ultimatetv.c (thin C)        │          │ /ps5/bundle/  ─ RmlUi look,   │
│  auth · catalogue · resolve · progress│ <── RML  │   from the TV's theme palette │
│                                       │          │ existing /api/home, /api/play │
│ stream URL ──────────────────────────────────────> /api/stream, /api/live (as now)
└───────────────────────────────────────┘          └──────────────────────────────┘
```

- **Engine (EVO, not ours).** Decoding, HDR, audio, the controller, the remote, drawing. We do not touch it except to register our provider and give the title its own id.
- **Provider (`ps5/evo/provider_ultimatetv.c`, ours).** About 400 lines that turn the Hub's JSON into EVO's structs. Pairing is automatic on first use, as on the TV: the first screen is let in, otherwise the console asks for a "yes" from another paired screen (Settings › Phones and remotes). It stores its token in `ultimatetv.conf`.
- **Hub shim (`hub/src/ps5.ts`, `ps5routes.ts`, ours).** Each route runs the Hub's own route as the same caller (same token, same profile, so Kids and Guest rules apply) and reshapes the answer. Everything with logic in it is unit-tested, plus an end-to-end test through the real Hub in demo mode.
- **The look (`/ps5/bundle/`, ours).** The Hub generates `main.rml` and `main.rcss` from the current theme. EVO fetches `manifest.json`, checks each file's sha256 and caches them. A changed theme (or a seasonal one) changes the manifest version, so the console picks it up with no reinstall. If the bundle can't be fetched, EVO falls back to its embedded media-server skin, so there is never a blank screen.

Playback itself is unchanged: the Hub hands out the same stream URLs it gives the TV, and EVO's decoder plays them. The Hub still doesn't transcode.

## What carries over from the TV app

| TV app | PS5 title |
| --- | --- |
| Theme palette (every theme, seasonal ones too) | Carried exactly: the Hub converts the same tokens into the bundle's styling |
| Home order, rails, hero with Resume/Watch/Live | Carried: same rows, same order, hero first |
| Card shapes, focus ring, wording | Carried (poster cards, a ring in the theme's focus colour) |
| Horizontal rails | **Not yet.** EVO's data model is one flat list of rows, so each rail is a heading followed by wrapping cards, not a sideways scroller |
| Guide grid, Music, Settings, recordings management | **Not yet.** Live channels appear as a Home rail with now/next; the guide stays on the TV and phone |
| Profiles with PIN | **Not yet.** The console uses the Hub's default viewer; a profile picker is the next step |
| Phone remote | Works as for any paired screen only where the Hub sends commands the engine understands; unverified |

## What has and hasn't been tested

Done here:
- The Hub half: `npx vitest run hub/test/ps5.test.ts` (16 tests), including ids, clipping, absolute artwork addresses, Home as rows, series, stream shaping, the bundle's manifest hashes for every theme, no scripts in the bundle, and the routes through a real demo Hub.
- The provider compiles with `-Wall -Wextra -Werror` against EVO's real `evo_provider.h`, `evo_net.h` and `evo_addon.h` and cJSON (`ps5/evo/build-title.sh --check`).

**Not done, because it needs EVO's toolchain and a console:**
- The title has not been built. `build-title.sh` clones EVO, adds the provider and runs EVO's own Docker build; the edit to EVO's provider table is checked by the script, but whether EVO's build accepts a changed title id has not been seen.
- Nothing has run on a PS5. That includes pairing, the bundle's rendering (RmlUi quirks such as `display` defaulting to inline were followed from EVO's notes, not seen), controller focus on cards, and 4K playback.
- The bundle uses RmlUi's `data-if`/`data-for`; a typo there shows up as a blank screen, which is why the fallback skin exists.

## Building and installing

```
ps5/evo/build-title.sh --check                       # anywhere: the provider against EVO's headers
EVO_REF=<sha> UTV_HUB=http://192.168.0.19:8095 \
  ps5/evo/build-title.sh                             # needs Docker; writes ps5/build/evo/PPSA26001/
```

CI runs the check on every change and builds the title on `main` (releasing `UltimateTV-PS5-title.zip` to the `ps5-title` release). Install by copying the `PPSA26001` folder to `/data/homebrew/` on the jailbroken console with ShadowMount+ running, exactly as in [ps5.md](ps5.md#installing). **Close EVO Player and any older UltimateTV first**: replacing files under a running title can panic the console.

The title has its own id, so it sits beside EVO Player. Both are GPL-3; EVO's licence and notices stay with its code.

## Next steps, in order

1. Gary installs the title and sends `/mnt/usb0/evo.log` (EVO's log) or the screen. First check: does the Hub's Home appear, does pairing work, does a film play in 4K.
2. Profile picker and PIN (the Hub already has the routes).
3. Guide and Music as further provider levels.
4. Horizontal rails, if EVO's model can carry nested rows (otherwise a patch to EVO).
5. Retire `ps5/src` (the SDL app) and its CI job.
