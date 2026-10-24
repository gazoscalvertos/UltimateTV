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

## Route 3: community app-store page (fragile)

On this firmware `hisense://debug` is blocked (tested 2026-10-24). The remaining route uses the TV's hidden `Hisense_installApp()` function, which only works on a page served as `vidaahub.com`. The community project [camellan/vidaa-appstore](https://github.com/camellan/vidaa-appstore) does this by running a small DNS and web server on your network that answers for `vidaahub.com`.

Known limits (from the Jellyfin forum thread, 2025–2026): on VIDAA U7.6+ / VIDAA OS 9 firmware the install may appear to succeed while no icon appears, or `Hisense_installApp` may be missing. If that happens here, installing apps on this TV isn't possible without a firmware downgrade, which we won't do.

Steps (run inside the Docker LXC, 192.168.0.19, or any always-on Linux machine):

1. Get the tool: `git clone https://github.com/camellan/vidaa-appstore.git && cd vidaa-appstore && pip3 install dnslib`
2. Edit `config.json`: set `server_address` to `192.168.0.19`, and point the `vidaahub.com` DNS record at it. Port 53 must be free (`ss -lunp | grep :53`).
3. Add UltimateTV to the `apps` array in `index-en.html`, copying an existing line:
   `{category:'my',appid:'ultimatetv',name:'UltimateTV',url:'http://192.168.0.19:8095/',text:'UltimateTV'},`
4. Run `sudo python3 server.py`.
5. On the TV: *Settings → Network → Network configuration → DNS*, set it to manual `192.168.0.19`.
6. In the TV browser, open `https://vidaahub.com/`, accept the certificate warning, and press **install** next to UltimateTV.
7. Set the TV's DNS back to automatic, stop the server, restart the TV, and look for the icon under Apps.

Things to record:

- VIDAA version (*Settings → Support → System Info*) and whether the icon appears.
- Whether the app opens full screen with no pointer.
- The probe's *Remote keys* results from the installed app: do the arrows, OK, Back and media keys arrive?
