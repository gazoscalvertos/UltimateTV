# Getting the app onto the VIDAA home screen

## Why this matters: remote keys

Tested on the 85U7STUK (2026-10-24): in the **Browser** app the page runs in cursor mode. OK and the arrows drive an on-screen pointer, Back steps through browser history, and Guide opens the TV's own guide and closes the page. A bookmark is therefore fine for the probe, but not for the real app.

VIDAA's own WebApp Development Guide says an *installed* web app is driven by the D-pad and receives these key codes: arrows 37–40, OK 13, Back 8, Red/Green/Yellow/Blue 403–406, digits 48–57, Play 415, Pause 19, Play/Pause 463, Stop 413, Rewind 412, Fast forward 417, Channel up/down 427/428. Info, Menu, Exit and Subtitle are reserved by the system and never reach apps. Guide isn't listed, so the app maps "TV guide" to Green and treats a Guide key as a bonus if it arrives.

So the next test is whether an installed app on this firmware really gets those codes. Run the probe's *Remote keys* step again from the installed icon.

Phase 0 tries both routes on the real TV and records which one works on this firmware.

## Route 1: browser bookmark (always works)

1. Open the VIDAA **Browser** app.
2. Go to `http://<server-ip>:8080/` (the probe now, the app later).
3. Add a bookmark. Some VIDAA versions let you pin a bookmark to the home screen.

Downsides: it opens inside the browser, so the browser's own bar may show, and the Back key may be caught by the browser.

## Route 2: developer install (official, may be blocked)

The VIDAA guide's developer route: open `hisense://debug` in the browser, enter a name and the app URL (`http://<server-ip>:8095/`), and press install. The app then appears on the Apps page. Community reports say newer firmware no longer allows this, but it costs 30 seconds to try.

## Route 3: vidaa-edge launcher icon (community tool, fragile)

The community *vidaa-edge* project installs a hosted web app as a proper launcher icon. You temporarily point the TV's DNS at a helper running on your network, open `vidaahub.com` on the TV, and add the app's URL. Steps change between releases, so follow the project's current README rather than a copy here.

Things to note during the test:

- VIDAA version (*Settings → Support → System Info*) and whether the icon appears.
- Whether the app opens full screen with no browser bar.
- Whether the Back key reaches the app (the probe's *Remote keys* step shows this).
- Set the TV's DNS back to automatic afterwards, and check the icon still works.

Record the outcome in `docs/phase0/capability-matrix.md`. Re-test after each VIDAA firmware update.
