# ADR 0005: The PlayStation 5 builds on EVO Player's engine, as an installable title

- Status: accepted (2026-11-12), supersedes the player half of [ADR 0004](0004-the-ps5-gets-a-native-app.md)
- Decider: Gary (GPL-3 for the PS5 part is fine; build an installable title)

## Context

ADR 0004 gave the console its own app: our C++ drawing with SDL, our software decoding through SDL_kitchensink, run as an `.elf` through the payload loader. On the real console nothing works. The log ends `sceKernelAllocateMainDirectMemory: Resource temporarily unavailable`, and the console's SDL offers only a software renderer.

The cause is not a bug in our code. A payload process has no direct-memory budget, and the console's hardware video decoder (`sceVideodec2`) and GPU drawing (`sceAgc`) work **only from a registered title** (its own `param.json`, sandbox and user session). EVO Player documents this plainly: the same decoder calls from an `.elf` payload fail at the decode ioctl with errno 5200. Every PS5 homebrew player that does 4K (EVO Player, Jelly5, Nuvio PS5) ships as a title for that reason. Our `.elf` can never show a picture, and could never have played 4K.

## Decision

1. **Ship an installable title**, not an `.elf`: a folder (and `.ffpfsc` image) that ShadowMount+ registers from `/data/homebrew/`.
2. **Do not own the player.** The title is [EVO Player](https://github.com/sainsaji/EVO-PLAYER-PS5)'s engine (hardware HEVC/H.264/VP9 up to 4K, HDR10/HLG/Dolby Vision profile 5, GPU-drawn UI, DualSense, HDMI-CEC remote), built from a pinned EVO commit with our code added. This is the same route Jelly5 took for Jellyfin.
3. **UltimateTV is an EVO provider** (`ps5/evo/provider_ultimatetv.c`): auth, catalogue, search, resolve and progress, over the Hub. It is thin on purpose; the Hub's new `/api/ps5/*` routes (`hub/src/ps5.ts`) return rows and streams already in EVO's shapes, so the logic is TypeScript with tests.
4. **The Hub writes the look.** EVO draws provider UI from an RmlUi bundle (an HTML/CSS subset: markup, styling, no scripts) that it fetches over HTTP and caches. The Hub generates that bundle from the TV's own theme palette (`/ps5/bundle/`), so the console follows theme changes and seasonal themes with no reinstall.
5. **The old SDL app is retired** once the title has been seen playing on the console. It stays in the tree until then.

## Consequences

- The PS5 part is **GPL-3.0-or-later**, because EVO is. The rest of the repository is unaffected; the PS5 title is a separate build whose source is this repository's `ps5/evo/` plus EVO's.
- We now depend on EVO's provider seam (`EVO_PROVIDER_API_VERSION 1`). Builds pin an EVO commit; moving the pin is a deliberate act, and `ps5/evo/build-title.sh --check` compiles the provider against EVO's real headers to show whether the seam moved.
- 4K, HDR10 and hardware decoding come with the engine. Dolby Vision is output as HDR10 (the console cannot do more), as on the Linux box.
- The TV app's look is mirrored, not shared code: EVO's UI is RmlUi, ours is React. What carries over is the palette, the Home order, the card shapes and the wording. Horizontal rails do not carry over yet (see [ps5-architecture.md](../ps5-architecture.md#what-carries-over-from-the-tv-app)).
- Not tested on a console. See [ps5-architecture.md](../ps5-architecture.md#what-has-and-hasnt-been-tested).
