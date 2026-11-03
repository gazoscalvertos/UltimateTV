# ADR 0004: A jailbroken PS5 means Linux, not a PS5 app

- Status: accepted (2026-11-03)
- Decider: Gary

## Context

Issue #182 asks for "support for jailbroken PS5" and says nothing else, so the first job was finding
out what a PS5 with homebrew can actually do. In November 2026 that is:

- **Firmware 13.60 is the ceiling.** The public exploit (Relapse, September 2026) covers 7.00 to
  13.60 on Phat, Slim and Pro. 14.00 and later are patched, firmware cannot be downgraded, and a
  console kept at 13.60 cannot sign in to PSN, whose minimum is now 14.20. Only a console
  deliberately kept offline at 13.60 or below is a candidate at all.
- **Linux works properly.** `ps5-linux-loader` v2.5 boots Ubuntu 26.04 on Phat and Slim at 3.00 to
  13.60 and Pro at 11.00 to 13.60, with real RADV/Mesa graphics (GFX1013) and hardware video decode
  through VAAPI for H.264, HEVC Main and Main10, VP9, VC-1 and MPEG-2, at up to 4K60 over HDMI. That
  is enough for the Linux AppImage this project already ships ([desktop.md](../desktop.md)).
- **The browser is not a shell.** The console's WebKit surface has no address bar and no tabs, and
  closes when you leave it. Video in it is weak. The TV app cannot live there.
- **Casting does not exist.** A PS5 is not a Chromecast, AirPlay, Miracast or DLNA receiver, and no
  payload changes that. Media Player reads USB disks only, and Remote Play goes the other way.
- **Native homebrew exists, and is a different product.** Unsigned ELF binaries build against
  `ps5-payload-sdk` and install as home-screen tiles, and two media clients prove it works: PS5MC
  (Kodi, October 2026) and Mortalfin (a native Vulkan/RADV Jellyfin client tested on firmware 4.03).
  Both are C++ and Vulkan and reuse nothing from this project's TypeScript, SolidJS or Electron and
  mpv stack, for an audience capped at firmware 13.60.
- **The official route is closed.** Sony's WebMAF and Media SDK apps need PlayStation Partners
  membership, concept approval, a devkit and TRC certification.

## Decision

- **PS5 support means "it runs on a PS5 that its owner has put into Linux".** The console boots
  Ubuntu through `ps5-linux-loader`, and the ordinary Linux AppImage runs on it. No PS5-specific
  code is written, and none is planned: the support is [ps5.md](../ps5.md) plus the AppImage that
  already exists.
- **The Hub stays a plain HTTP client surface**, so a native PS5 client written by someone else
  could be pointed at it later without the Hub changing. That is a property to keep, not work to do.
- **Not a native PS5 client.** It would be a second codebase in C++ and Vulkan sharing nothing with
  the app, maintained against a firmware window that only shrinks, for the handful of consoles kept
  offline at 13.60.
- **Not the PS5 browser.** No chrome, no tabs, a surface that closes when you leave it, weak video,
  and it depends on the same exploit that the Linux route needs anyway.
- **Not casting.** There is no receiver protocol on the console to implement.
- **Not the official SDK.** Gated behind a partnership and certification that a hobby project does
  not have and is not applying for.
- **Not a DLNA server in the Hub, yet.** Exposing the library to the homebrew DLNA client
  (`ps5-payload-dev/jtplay`) would reach the same small audience as the Linux route. It is the
  obvious next step if anyone asks, and it is not part of this decision.

## Consequences

- The instructions work for consoles at 13.60 or below that are kept offline. A console already on
  14.00 or later cannot be used, and the page says so before it says anything else.
- There is nothing to build, sign, test or update for the PS5, so the cost of this decision is one
  page and the cost of being wrong is that the page is wrong.
- The page has to be honest about what has not been tried: nobody has run this app on a PS5, so
  playback, hardware decode, sound over HDMI and 4K output there are expectations taken from the
  Linux port, not observations.
- If `ps5-linux-loader` stops supporting a firmware, the page is the only thing that changes.
- A community native client remains possible against the Hub's HTTP surface. If one appears, this
  decision is about our work, not about theirs.
