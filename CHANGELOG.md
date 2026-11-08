# Changelog

The version is in the root `package.json` (and each workspace's). The Hub and the box also show
the commit they were built from in Settings › About, so you can tell exactly what each one runs.

This file is also what the apps show as **What's new**: the Hub reads it (`GET /api/changelog`) and
the TV (Settings › What's new), the phone remote, the setup page and the Android app list it, and
pop up what's new after an update. So:

- Add each change at the top, under a `## YYYY-MM-DD` heading for the day it merges (start one if
  today's isn't there).
- One bullet per change: `- **Short title**: what it does, in plain words. (#113)`. The bold title
  is what the pop-up lists; the rest shows underneath. A `([docs/…](docs/…))` link after the title
  is kept for GitHub and left out on the TV.
- Sections that aren't a date or a version (like Updating) are left out of the apps.
- Add `Household: what changed for the household, in one sentence.` on its own indented line under
  a bullet when the change is something people will see. Only those lines are shown as What's new
  after an update (`unseenChanges`); a bullet without one is internal work and never pops up.

## Updating

- **Hub** (on the Docker LXC): `bash /containers/UltimateTV/tools/hub/update.sh`. It pulls, rebuilds
  with the version recorded, restarts and checks the Hub is up. The TV loads the new app the next
  time it opens it (Settings › About › Reload the app does it straight away).
- **Box**: Settings › About › Update the box, or wait for Monday 4 am. Over SSH: `sudo systemctl
  start ultimatetv-update`. If the box doesn't work afterwards it rolls itself back; Settings ›
  About › Roll back last update (or `sudo systemctl start ultimatetv-rollback`) does it by hand.
- **From the phone**: the remote's ⚙ Settings › Updates updates either one. The Hub's button needs
  the helper installed once: `sudo bash tools/hub/update.sh --phone-updates`.

## 2026-11-07

- **Sound delay, subtitle delay, and the sound and subtitle choice remembered per series** ([docs/player-sync.md](docs/player-sync.md)): Options in the player has Sound delay and Subtitle delay in 50 ms steps with the number on screen (left and right to move, Back to finish). The sound delay is kept for each sound output, so headphones keep their own offset; the subtitle delay starts at 0 for every title. The phone remote's Sound and subtitles sheet has the same two controls. Picking a sound track or subtitles in a series (Japanese with English subtitles, say) is now remembered for that profile and applied to the next episode, Up Next and Resume by matching the language, whichever source it comes from; Options › Default forgets it. On the Fire TV and Android app the player gained an Audio and subtitles button and list that the Fire remote can reach (Up, Down or Menu), with Off for subtitles, and it remembers the choice the same way. The delays are not on the Android app yet. (#223, #228)
  Household: the sound and subtitles you pick for a series now carry on to the next episode, lip-sync can be nudged from the TV or the phone, and subtitles can be switched off from the Fire TV remote.

- **Preview pictures on the seek bar**: ([docs/seek-preview.md](docs/seek-preview.md)) drag along the seek bar and a small frame from the film shows above it, from the pictures Jellyfin already makes (Trickplay). The TV app (with a mouse) and the Android and Fire TV app both do it; nothing shows when the film has none. (#227)
  Household: when you drag along the progress bar you can now see a little picture of that moment in the film.

- **Fire TV: Settings reachable, and the app updates itself**: the side menu now scrolls and the remote's Menu key opens Settings, so Settings is no longer cut off the bottom of a TV screen. Check for updates downloads the new app from the Hub and opens Android's installer (no browser needed), and the app offers an update when it opens. (#247)
  Household: Settings now opens on the Fire stick (press the Menu key), and the app can update itself.

- **More Kids films and shows rows**: the Kids profile's Films and TV Shows pages now have far more to pick from: top rated, new additions you haven't seen, for little ones (U) and bigger kids (PG), animation, adventure, comedy, family, fantasy, superheroes, animals, musicals, mystery, Watch again, and Best of 2026, 2025, 2024 and back. All rows follow the profile's rating limit and allow list. (#246)
  Household: the Kids profile has many more categories on Films and TV Shows, including Best of each year.

- **Fire TV: picks versions your stick can play**: the Android app now works out what the screen and decoder can show (a 1080p-only Fire stick is capped at 1080p, about 20 Mbit/s) and tells the Hub, which chooses the best version that fits instead of the biggest, and has Jellyfin shrink a 4K remux that was picked by hand. Playback also starts after 1 second of video instead of 2.5. Settings › Picture shows the limits and lets you change them. ([docs/firetv.md](docs/firetv.md)) (#245)
  Household: Videos start much faster on a 1080p Fire stick, and it is no longer sent 4K files it cannot play.
- **Fire TV: easier to use with the remote**: the item you have selected now has a white outline and lifts slightly, everything is a quarter bigger for a TV, and nothing sits in the edge of the picture a TV crops. (#245)
  Household: You can see where you are on the Fire TV when you press the arrow buttons, and the text is bigger.
- **Ask a parent** ([docs/profiles.md](docs/profiles.md#ask-a-parent)): when a Kids or Guest profile opens something it isn't allowed, the page offers Ask a parent. The request pops up on the TV when an adult profile is on, comes up as a sheet on paired phone remotes, and goes to Home Assistant or ntfy if Settings › Alerts has one. An adult says Allow once (an evening), Always allow (adds to the Kids profile's allow list) or No; the first answer wins and the child sees a yes or "Not now". A child can ask three times in ten minutes, can't answer for itself, and the week's requests are listed on the setup page with the time and the answer. Built without trying it on the TV or a phone yet. (#224)
  Household: a child who hits a film they aren't allowed can ask a grown-up, who answers from the sofa or a phone.

- **Easy mode and a first-time tour** ([docs/easy-mode.md](docs/easy-mode.md)): a profile can be set to Easy mode, where Home is four big tiles (Watch TV, Films and TV, Recordings, Search) plus Continue watching, the menu is short and Settings is out of reach. Each profile also gets a one-minute tour of the remote the first time it is used (Info › Show me around replays it). (#229)
  Household: Easy mode gives someone who just wants to watch a Home with four big buttons, and new profiles get a short tour of the remote.
- **X-Ray: who is in this** ([docs/watching-extras.md](docs/watching-extras.md#x-ray-whos-in-it)): press Info while a film or episode plays to see its cast with photos and character names; OK on someone shows their bio and what else they are known for. (#241)
  Household: Press Info while watching to see who the actors are and who they play.
- **Set up sources from the TV remote** ([docs/sources.md](docs/sources.md)): Settings › Sources is now a Providers list. Each of IPTV, Xtream Codes, Jellyfin, Plex, add-ons and TorBox says what to do next while it isn't set up ("Not set up – press OK to add a playlist"), and OK opens its setup with an on-screen keyboard for the playlist link, Xtream login, server address, add-on link or TorBox key. The Hub finds Jellyfin (UDP broadcast) and Plex (GDM) servers on the home network (`GET /api/discover`) so the address rarely needs typing; Plex shows its plex.tv/link code on the TV and Jellyfin offers Quick Connect. The phone's QR code stays. Only adult profiles see it, and the Hub still asks for the profile PIN. (#218)
  Household: you can add or change IPTV, Jellyfin, Plex, add-ons and TorBox from the TV's own remote, without a phone.
- **Source options: test, pause, put in order, remove** ([docs/sources.md](docs/sources.md#source-options)): every source (each IPTV provider, Jellyfin, Plex, TorBox and each add-on) has an Options menu in Settings › Sources and a Source options section on the setup page. Test connection says whether it is reachable, signed in and how long it took, and for an Xtream IPTV account the expiry date and connections in use. Pause hides a source from the guide, library and Versions without losing its login; Resume brings it back. Move up and Move down set the order Play and Versions prefer sources in, after the quality rules (a clearly better picture or the right language still wins). Remove asks first. (#219)
  Household: a provider that is down or being rebuilt can be paused and resumed instead of removed and set up again, and you can say which source to prefer.

- **Emby, and Jellyfin, Plex and Emby together** ([docs/emby.md](docs/emby.md)): Emby Server can be connected (setup page › Emby, name and password), and any of Jellyfin, Plex and Emby can now be connected at the same time instead of one replacing the other. Their films and series are merged on Home, Films, TV and Search, a title on two servers is a single card with a copy from each under Versions, Continue watching and Mark as watched go to whichever server the title is on, and one server being off never hides the others. Emby's intro and credits markers come from its chapter markers. Built from the servers' API documentation and not yet tried against real Emby or two live servers. (#216, #217)
  Household: you can connect Emby, and keep Jellyfin and Plex connected together, all in one library.

- **Nuvio works as an add-on link** ([docs/nuvio.md](docs/nuvio.md)): checked what "Nuvio" is in a source list. The Nuvio Streams server is a Stremio add-on, which the Hub already supports in Settings › AIOStreams / add-ons, so no new client is needed; the doc says how to add it. (#220)

## 2026-11-04

- **Share Play** ([docs/share-play.md](docs/share-play.md)): a one-off link to the film or episode on the TV. Whoever opens it watches along in any web browser, with nothing to install, pausing and skipping together with the TV through Sync play. Make one from the phone remote (Browse › Elsewhere › Share, which sends it through the phone's share sheet) or on the TV (Options › Share Play, a QR code). The first browser to open a link keeps it; it ends when the TV moves on, when it's cancelled, or after 6 hours, and the browser never sees Jellyfin. Links work on the home Wi-Fi, and for someone in another house once `tools/share/setup-tunnel.sh` has published `/share/` (and nothing else of the Hub) through a Cloudflare Tunnel. (#214)
  Household: send someone a link and watch the same film together, in step, even if they don't have the app.

- **Watch on other screens, and Sync play** ([docs/watching-elsewhere.md](docs/watching-elsewhere.md)): every TV, phone and tablet now says what it's playing, and any other screen can carry it on from the same place (Resume here), take it over and stop it there (Move here), or play it in step (Sync play), where pausing or skipping on one does it on all of them. On the TV it's the On other screens row on Home; in the Android app (0.7.0) Home › Elsewhere and a TV button in the player; on the phone remote Watch › Elsewhere. (#211)
  Household: swap from the TV to a phone or tablet and back without losing your place, or watch the same thing in two rooms with Sync play.
- **Versions: English only**: Settings › Picture and sound › Versions (and the setup page) now chooses between your audio language first (as before), only your audio language, or all languages. Torrent and addon copies marked FRENCH, GERMAN and so on, or with a foreign flag, now count as other languages too. (#213)
  Household: films and shows can be set to offer English versions only.
- **Projected clips show on the TV box again**: the box no longer takes its desktop's "no animations" as Reduce motion, and a clip sent from the phone that the TV can't show or play now says why on the TV. (#212)
  Household: clips sent from the phone play on the TV again, and if one can't, the TV says why.
- **The box pauses when the TV turns off**: it used to rely on hearing the TV announce standby over CEC, and it never heard anything: watching the CEC bus needs a permission the app's user hasn't got, so the watcher failed quietly, and many TVs (Hisense among them) go to standby without announcing it anyway. The box now also asks the TV whether it's on every 20 seconds, the box update installs a copy of `cec-ctl` allowed to watch the bus, and a new setting (Settings › Picture and sound › When the TV turns off, and the setup page) picks Pause (the default), Stop or Keep playing. Pause pauses films and episodes and stops live TV, which would otherwise hold the IPTV connection; when the TV comes back on, the paused film is on screen and OK carries on. (#208)
  Household: turning the TV off now pauses the film on the box, ready to carry on when the TV comes back on.
- **The top menu stops at its last item**: pressing right on the profile at the end of the top menu used to drop down into the screen below; now it stays put, and left on Home does the same. Right from the music chip also moves on to the weather and the profile instead of jumping back to Search. (#209)
  Household: pressing right along the top menu now stops on your profile instead of falling into the screen.
- **CI builds the PlayStation 5 app** ([docs/ps5.md](docs/ps5.md)): a new `ps5-console` job fetches the PS5 payload SDK and the homebrew libraries, builds the app and the tile on every pull request, and on a merge to `main` replaces `UltimateTV-PS5.elf` and `UltimateTV-PS5-tile.zip` on the PS5 release. Before this the release was built by hand and could lag behind `main`. (#182)

- **The PlayStation 5 app tries every way of drawing before it gives up** ([docs/ps5.md](docs/ps5.md)): with the sound fixed, the window opened and then SDL answered "Couldn't find matching render driver" — its one-line summary of every driver failing, which says nothing about why any of them did. The app now lists the render drivers the console's SDL was built with and tries each by itself: software first (the console's SDL can always back it with its own framebuffer, and trying OpenGL first can hand the display to Mesa and lock the software path out), then every other driver, then drawing straight into the window's surface, then a 1080p and a 720p window. It also stops SDL quietly backing the window with a GPU texture. Every attempt and its reason, the SDL version, the video driver, every display mode and every render driver go into `/data/ultimatetv/last-run.log`, along with whether the first three frames reached the console. A renderer can be put first without a new build by writing its name into `/data/ultimatetv/renderer.txt` (or `--renderer=NAME`). (#182)
  Household: the PlayStation 5 app should now show its picture where it used to stop with a render driver error.

- **The PlayStation 5 app draws a picture instead of stopping at the first frame** ([docs/ps5.md](docs/ps5.md)): it asked the console for the window, the pad and the sound in one call, and on a current console the audio driver refuses to initialise — and leaves a stale "Unknown pixel format" behind from the cursor code. So one refused part took all three down, the app reported a window problem that wasn't one, and the screen stayed black. The three are now asked for one at a time: the window is required, a pad or a silent console are not, and films simply play without sound on a console that gives none. The reason each one failed goes to `/data/ultimatetv/last-run.log`. (#182)
  Household: the PlayStation 5 app shows its picture on a current console instead of a black screen.

- **Say why a `.pkg` won't launch, precisely** ([docs/ps5.md](docs/ps5.md)): the docs said the fake-package patch "was never ported past 12.00". The actual rule is narrower and checkable — kstuff-lite's `get_ppr_profile()` returns `NULL` for any firmware above 11.60, so the console refuses the mount on 12.00 through 13.60 even though the profiles for those firmwares are still in the source. The notes now name the guard and the two commits that introduced and then disabled it, and `make -C ps5 ffpkg UFS2_TOOL=...` builds the one-file UFS2 image that the projects which do work on a current console actually ship. The tile's `param.json` also gained the metadata block a shipping title carries, which the console's patch cache and update checker read. (#182)
  Household: no visible change; the PlayStation 5 notes now say exactly which firmwares a package works on and which route to use instead.

- **The PlayStation 5 app starts on a current console** ([docs/ps5.md](docs/ps5.md)): a console on firmware 12.00 or above installs a fake `.pkg` and then refuses to launch it, because the console's own package filesystem mount fails — a rule of the console, not of this app, and the same for every fake package on those firmwares. `make -C ps5 homebrew` now builds the one thing that has nothing for the console to refuse: a plain folder for `/data/homebrew/`, which a folder mounter registers as a tile. The tile and the folder are on the PS5 release page, the package is still there for older firmwares, and the docs say which to use. The app also writes `/data/ultimatetv/last-run.log` on every start — which window, which address, what the Hub said — so a black screen can be read rather than guessed at, and it can finally be pointed at the Hub from the controller, a number at a time, instead of only from the command line. (#182)
  Household: the PS5 app now installs the way a current console accepts, and a black screen comes with a note on the console saying what went wrong.

- **The PlayStation 5 app fills a 4K television** ([docs/ps5.md](docs/ps5.md)): it used to ask the console for a 1080p picture and draw everything at that size, so a 4K film was shrunk to 1080p and then stretched back up by the console — two resamplings of every frame for nothing. It now takes the biggest picture the console offers (up to 3840×2160) and scales the text and the layout with it, so the picture is real 4K and the writing is the same size on the wall either way; the film decoder is told the real size too. Decoding is still done by the console's own processor, so a 4K film may drop frames — `ultimatetv.elf --1080p` asks for a smaller picture when it does. (#182)
  Household: on a 4K television the PlayStation 5 now shows the picture at 4K instead of stretching a smaller one.

## 2026-11-03

- **No Google Play services, and nothing quietly reporting on you** ([docs/dependencies.md](docs/dependencies.md)): the Android apps used Google's barcode scanner, which only works where Play services is installed and which made the Fire TV build crash at launch. Reading the TV's pairing code is now this project's own code — CameraX for the camera, ZXing for the decoding — so it needs nothing from Google. A test fails CI if Play services, an analytics or advertising library comes back, or if a new runtime dependency appears without being named. The new page lists every library the apps are built from and every service the Hub can talk to, with what each one is sent. (#198)
  Household: no visible change, except that the app no longer needs anything from Google to scan the TV's code.
- **UltimateTV on a PlayStation 5, as a homebrew app** ([docs/ps5.md](docs/ps5.md)): a native console app that sits on the PS5's home screen and starts like a game — the same Home, guide, live TV, films with Resume and profiles with a PIN, all from the Hub and all on the controller. It needs a jailbroken console and is built with `make -C ps5 package`. `make -C ps5 pkg` wraps the same tile in a `.pkg` for a console that installs packages rather than folders. (#182)
  Household: a jailbroken PlayStation 5 can now be another screen for UltimateTV.
- **The TV app measures itself, so "slow" can be pointed at** ([TESTING.md](TESTING.md#10-when-the-tv-app-feels-slow)): Settings › About › Measure the UI times the picker, Home taking a key press, a step in the guide and the gap between frames while a film plays, against the targets the TV app is meant to hit. The numbers go to the Hub and show on the Stats page and in the diagnostics. On the development machine everything was already well inside target at 4K, so this adds the measuring rather than a change to how the screens draw. (#108)
  Household: no visible change — this is how a slow TV gets looked at instead of guessed about.
- **A Fire TV app, on Fire OS sticks and boxes** ([docs/firetv.md](docs/firetv.md)): a second Android
  build with no Google Play services in it, because a Fire OS stick has none and the old single APK
  crashed at launch on one. It sits in the Fire TV home row, the remote's D-pad, Select, Back,
  Play/Pause and skips work, and pairing is by typing the TV's code since a stick has no camera.
  Updates come from the Hub, and Vega OS devices can't run it at all. (#183)
  Household: Fire TV sticks can install UltimateTV from the Hub now, and update it from there.

- **The six things people do most on the TV, tested by a machine**
  ([docs/TESTING.md](docs/TESTING.md#0-the-journeys-ci-runs-by-itself)): picking a
  profile, tuning a channel from the guide, recording a programme, setting a series link, playing a
  film from Home and resuming it, and checking a Kids profile can't reach Settings are each driven
  with the remote's own keys in a real browser, against a demo Hub. A run that leaves a screen with
  nothing focused, or that makes the browser report an error, fails and keeps a picture of the screen
  at that moment. It takes about half a minute. (#104)
  Household: no visible change — this catches broken screens before an update reaches the TV.

- **The Android apps are signed with the house's own key, kept out of the repo**
  ([docs/android-signing.md](docs/android-signing.md)): the two Android apps used to be signed with a
  keystore committed to the repository, password and all, so anyone who could read the code could
  build an update the phones would accept. The key now lives in the repository's secrets and is only
  written out for the seconds a build needs it. Installing the new build is a one-time uninstall on
  each phone, because Android won't install over an app signed with a different key; both apps say so
  before you tap. (#93)
  Household: installing the phone apps once more, with an uninstall first, and then updates are
  normal again.

## 2026-11-02

- **The TV app on Windows and a Mac** ([docs/desktop.md](docs/desktop.md)): the desktop app now has a
  Windows installer and Mac disk images beside the Linux AppImage. The Windows one installs for the
  current user with no administrator prompt and puts a shortcut in the Start menu (there is a .zip
  for PCs that block installers); the Mac one is a .dmg per architecture, Apple Silicon and Intel,
  and because it isn't signed with a paid Apple certificate the first start is right-click → Open.
  Both carry their own mpv, keep their settings in the folder each system expects, and update
  themselves from the same release the AppImage uses — on Windows and the Mac by downloading the new
  installer and opening it, since an installed app can't swap its own files the way an AppImage can.
  The TV's Settings › Apps for your devices and the phone's Apps section show links and QR codes for
  all three platforms, served from the Hub so the download works without GitHub. (#127, #128)
  Household: the TV app now installs on a Windows PC and on a Mac, with the player included, and the
  TV's settings page shows a code to scan on that computer.
- **Music controls on every screen**: music, the radio and podcasts now have a chip at the top right
  of every screen but the Music tab, naming what's playing and pausing it in a press. (#181)
  Household: you can see what's playing and pause it without leaving the screen you're on.
- **Settings for the radio and podcasts**: keep the screen awake while the radio plays, leave the
  station off the screensaver, turn off what's playing, hide podcasts from the Music tab, and put
  your own stations first or list the lot by name. On the TV's Settings and the setup page. (#180)
  Household: the radio can be made to behave the way you want it to, from the TV or a phone.
- **Plex instead of Jellyfin** ([docs/plex.md](docs/plex.md)): Settings › Plex connects a Plex
  server with its address and token, or with a PIN approved in a browser, and the Hub uses it for
  the same job Jellyfin does: Home's Continue watching (Plex's On Deck), Next up (derived from a
  show's episodes, as Plex has no such list), Recently added, search, Details, playback direct from
  the original file, progress both ways, Mark as watched, intro and credits skip markers and
  external subtitles. One media server at a time: connecting Plex disconnects Jellyfin and the other
  way round. The setup page has the same box. What it doesn't do is Plex's smaller 720p copy (a
  Plex title plays its original file) or tell Plex about a single new file (the Hub asks it to
  rescan its libraries instead, and says so). (#187)
  Household: a Plex household can now use UltimateTV with the library it already has, without
  running Jellyfin as well.
- **The remote on an iPhone** ([docs/phone-remote.md](docs/phone-remote.md#on-an-iphone)): the phone
  remote at `/remote/` is a proper web app now, so an iPhone adds it to the Home Screen with
  **Share › Add to Home Screen** and gets a full-screen TV Remote with its own icon, its own dark blue
  splash screen and no address bar. The page carries a manifest, a 180×180 apple-touch-icon and the
  apple-* tags Safari reads, and shows a one-line banner on an iPhone saying where the button is —
  dismissible, and never shown once the remote is on the Home Screen. A versioned service worker keeps
  the page and its icons on the phone, so it opens instantly and still opens on a flaky connection,
  while everything under `/api/` always goes to the Hub. (#129)
  Household: an iPhone can keep the remote on its Home Screen like an app, and it opens in a moment
  even when the Wi-Fi is poor.
- **A TV app without the Hub: Limited mode** ([backup.md](docs/backup.md#when-the-hub-is-down-limited-mode)): with the Hub off the box no longer shows a dead screen. While the Hub is up it keeps a small saved copy of the channel list (with each channel's own address), a week of guide, every profile's rules and the Jellyfin sign-in; with the Hub down it runs a reduced TV app from that copy, playing live TV and Jellyfin films itself and reporting where you got to. Recording, series links, TorBox/saves and settings are there but off, each with a sentence saying why, and Kids rules still apply from the saved profile. When the Hub answers it swaps back to the full app by itself, waiting for a playing film to finish instead of cutting it off. (#78)
  Household: if the Hub is down or restarting, the TV still has live channels, a week of guide and your Jellyfin films, and it goes back to normal on its own.
- **A TV app that draws nothing now shows the box's own screen**: the box only watched the Hub, so a
  Hub that answered while the app it sent drew nothing left the TV black with nothing in any log and
  no way out but a restart. The box now looks at what the page drew, reloads it without the cache,
  and falls back to its own screen (and keeps trying the app) if it stays blank. (#184)
  Household: if a bad update ever leaves the TV black again, the box puts its own screen up with
  what's wrong instead of sitting there, and comes back to the TV app by itself.
- **The TV app comes back on screen**: an update on 2 November left the TV showing a black screen on
  both the box and the desktop app. The app started a piece of background work before it was ready
  and stopped before drawing anything; it now starts that work once the screen is up. (#178)
  Household: the TV shows its screen again after the 2 November update, with no uninstall or reset.
- **A second TV box in another room**: pair a second box and name it, and each room gets its own
  now-playing card, sleep timer and pop-ups; the phone remote grows a picker at the top and
  remembers which room it is for. With one box nothing changes. (#103)
  Household: a TV in the bedroom and one in the living room now both work with the same Hub, and
  each phone remote knows which one it is working.
- **Bluetooth headphones, speakers and controllers**: Settings › Bluetooth on the TV (and the same
  section on the phone's Settings page) finds nearby devices and pairs and trusts them in one press.
  Headphones take the sound over when they connect and hand it back when they go, decoded to stereo
  because Dolby and DTS can't travel over Bluetooth, with a sound delay setting for lip-sync.
  Controllers work in RetroArch, Moonlight, Steam Link and GeForce NOW. (#102)
  Household: wireless headphones now work in the TV without unplugging anything, and the sound goes back to the TV's speakers when they're off.

- **The TV in the phone's notifications, Quick Settings and home screen** ([docs/phone-remote.md](docs/phone-remote.md#from-the-shade-and-the-home-screen)): the Android app now puts a player in the phone's notifications while the TV is playing — the title, the episode or year, the picture, how far through it is, and Pause, Back 30 seconds, Forward a minute and Back, with Channel − and Channel + in place of skipping on a live channel — which goes away when the TV stops. A **TV Remote** tile in Quick Settings plays and pauses, and a resizable **TV Remote** widget on the home screen has Play/Pause, Back, Home and, at full size, the d-pad with OK and the four colour keys. Nothing polls: the Hub holds one request open until the TV's state changes (`GET /api/remote/now`), so a phone with nothing playing leaves nothing running, and the state is the same one the Hub reports to Home Assistant, so the shade, the tile and Home Assistant agree. The app is version 0.7.0, so phones already on it get the update banner. (#109)
  Household: you can pause the telly from the phone's lock screen or home screen without opening the remote.
- **Check the TV and the remote from the TV** ([docs/diagnostics.md](docs/diagnostics.md#the-self-test)): Settings › About › Self-test plays six short clips — 4K HDR10, HLG, 23.976 and 50 frames a second, surround sound and left/right stereo — and asks you whether each looked and sounded right, then asks you to press every button on the remote and notes the ones that never arrived. Each answer is kept with what the box was doing at the time: the screen mode it picked, the picture and sound format, and whether the graphics chip did the decoding. That is what tells "this TV can't do HDR" apart from "the TV was in the wrong picture mode". The last run is shown on the phone's Stats page and in the Hub's diagnostics, and the box makes the clips itself if they are missing, so nothing large is kept in the repo. (#105)
  Household: the TV can check itself — HDR, the picture rate, the sound and every button on the remote — and say what it found.
- **The Android app saves for later, queues and saves to the NAS** ([docs/android-client.md](docs/android-client.md#saved-for-later-and-the-queue)): a film's or show's page has **Save for later** and **Add to queue** beside Play, and Home has **Saved for later** and **Queue** buttons that open both lists. Saving keeps the title in the household's list, so it turns up on Home on the TV and on the phone remote's Saved tab; queueing puts a film, or the episode that plays next, on the end of the household's play queue, which the TV plays in order. The queue screen plays a thing here or on the TV, moves it up and takes it off, with **Clear the queue** for the lot. **Save to NAS** is now on a title's page as well as in its Versions list, with how far each save has got underneath ("S1 E2 · 42%", then "Saved, and in Jellyfin"). Both lists are the Hub's, so a Kids profile only sees what it may watch, and the Hub refuses Save to NAS for Kids. The app is version 0.5.0, so phones already on it get the update banner. (#76)
  Household: the Android app can save things for later and line them up to play on the TV, and the lists are the same ones the TV has.
- **Radio and podcasts in the Music tab** ([docs/music.md](docs/music.md#playing)): the TV's Music tab now lists UK radio stations (BBC Radio 1–6, 1Xtra, 4 Extra, Asian Network, World Service, Classic FM, Heart, Smooth, Capital, Radio X, LBC, Gold and Radio Paradise, plus Fun Kids for children), each showing what it's playing where its stream says. Add your own station with its stream address. Podcasts: find a show by name or paste its feed, follow it, see new episodes marked and pick up an episode where you left off. Play/Pause works from any screen and the screensaver says what's on. The phone remote has Watch › Radio, and "play Radio 2" works by voice. Kids profiles get the Music tab with just the children's stations (Fun Kids and Fun Kids Junior) and the podcasts a grown-up chose to follow, and none of the grown-ups' Spotify or Deezer. (#86)
  Household: Radio and podcasts are on the TV's Music tab, the phone remote and by voice.

- **A parent can say yes or no to what Kids sees** ([docs/profiles.md](docs/profiles.md#what-a-parent-allows)): the rating limit is blunt — most IPTV titles carry no certificate, and the ones that do were written for another country — so an adult profile gets **Allow for Kids** and **Hide from Kids** on a film, series or channel's page. An allowed title plays even at 15 or 18 and a hidden one is kept back even at U; pressing the button again goes back to the rating. Both lists are on `/setup/` under each Kids profile, matched by the title's id where there is one and by name otherwise (a broadcast's id is one airing), and the Hub enforces them everywhere — Home, the guide, search, favourites, the watchlist and playback — not just on the screen that made the change. (#110)
  Household: a parent can approve a film the rating would block, or hide one it would allow, for the Kids profile.

- **The week a Kids profile watched, on the phone** ([docs/profiles.md](docs/profiles.md#the-week-a-kids-profile-watched)): `/setup/` shows, under each Kids profile, the last seven days — how long it watched each day, what it played, the week's total, and how many PIN lockouts there were. The minutes come from the same clock the TV time limits use and the titles from what the profile was playing, so a title only on for a minute still shows while the total stays honest. (#110)
  Household: you can see what the Kids profile has been watching this week without turning the TV on.

- **Save for later says when a saved title is next on TV** ([docs/everyday-extras.md](docs/everyday-extras.md#save-for-later)): the Hub matches each saved title against the next fortnight of the guide and the card says where and when ("On Film4 · Sat 21:00") where the year normally goes, on Home and on the phone's Saved tab. Pressing the card on the TV offers Record it and Remind me in one press, and the phone row grows a record and a bell button. Matching is on the title and, when both sides know it, the year, so a saved Dune (2021) doesn't claim Dune: Part Two; only channels that profile could watch are suggested, and music video channels are left out. (#74)
  Household: the Saved for later list now tells you when something is on telly, and records it for you in one press.

- **Home shows the rows each profile wants, in its own order** ([docs/profiles.md](docs/profiles.md#rows-on-home)): Settings › Rows on Home lists every Home row with a switch and up and down, with Simple Home (Live now, Continue watching and Recently recorded) and Everything to start from. The same list is on a phone at `/setup/`, where you also pick which profile you're changing. Each profile's list is kept on the Hub and forgotten when the profile goes. A row that's switched off is never fetched — no Continue watching row means no ask to Jellyfin for it — so Home opens faster. (#99)
  Household: everyone can choose the rows they see on Home, and take away the ones they never watch.

- **What you watch away from home reaches Jellyfin when you get back** ([docs/travel.md](docs/travel.md#back-home-travelsh-home), [docs/downloads.md](docs/downloads.md#watching)): while Jellyfin can't be reached the Hub keeps the place for its films and episodes, and sends them on when it can — home from a trip, at startup, when Jellyfin is set up, or on the hourly tick. If Jellyfin was played somewhere else more recently, its place is the one kept. The queue lives in the Hub's database, so `travel.sh home` carries it back with everything else, and the Android app's own offline queue now says when it watched something so the same rule applies. (#80)
  Household: a film watched on a trip shows the right place, and the right Continue watching, back at home.

- **Adverts are found even when comskip misses them** ([docs/FEATURES.md](docs/FEATURES.md)): when comskip finds no breaks in a recording over 20 minutes, ffmpeg looks for black frames either side of silence and the stretches that fit become the breaks. Settings › Recording says how many breaks comskip found, how many the fallback found and how many recordings had none, and so does the text diagnostics. (#73)
  Household: the Skip adverts button now turns up on more recordings.

- **Reminders have a list of their own** ([docs/everyday-extras.md](docs/everyday-extras.md)): Recordings has a Reminders tab, and so does the phone remote, so a reminder set in the TV guide can be seen and taken back without hunting for the programme again. The phone's guide can set one too. (#159)
  Household: you can see every reminder you've set, and cancel one, on the TV and on a phone.
- **A recording clash can be settled on the TV** ([docs/FEATURES.md](docs/FEATURES.md)): the clash banner in Recordings is a button now — OK lists the programmes that clash with their channel and time, and keeping one cancels the rest. "Keep them all" records what the connection allows and cancels nothing. (#161)
  Household: when two recordings clash, you can choose which one to keep instead of doing it by hand.
- **The nightly backup can be kept somewhere other than the NAS** ([docs/backup.md](docs/backup.md)): the NAS sits in the same room as the Hub, so a fire or a flood takes both. `BACKUP_OFFSITE` now names a second destination, either a path on another disk (`BACKUP_OFFSITE=/mnt/usb/ultimatetv`) or an rclone remote, which can be encrypted (`BACKUP_OFFSITE=gdrive:UltimateTV/backups`); `BACKUP_OFFSITE_DIR` and `BACKUP_OFFSITE_RCLONE` pick one explicitly. The copy goes across after the NAS copy has landed, keeps its own shorter rotation (`BACKUP_OFFSITE_KEEP_DAYS`, 7 daily by default, then `BACKUP_OFFSITE_KEEP_WEEKS`, 4 weekly), and never touches the NAS copy: a second copy that fails is listed in Settings › About and on the setup page, raises its own alert, and can be restored from when the NAS copy has gone. rclone is optional, so the Hub says so plainly when it isn't installed instead of failing the night's backup. (#97)
  Household: the Hub's nightly backup can also go to a second disk or an encrypted cloud remote, so losing the NAS doesn't lose the household's settings.
- **A Guest profile for visitors and babysitters** ([docs/profiles.md](docs/profiles.md#a-guest-profile)): Add a profile offers **Guest** beside Kids and Adult. A Guest sees titles rated up to its own limit (12 to start), has its own pick of sections, and never has Settings, recordings or downloads — the Hub refuses those even from a browser or the phone, as it does for Kids. Nothing it watches is kept: no Continue watching, no "Because you watched", and Jellyfin is never told, so there's nothing to clear when the visit ends. (#101)
  Household: visitors and babysitters get their own profile that leaves no trace of what they watched.

- **A title can come off Continue watching** ([docs/FEATURES.md](docs/FEATURES.md)): the Continue watching cards on Home open an Options menu with Resume, Mark as watched and Remove from Continue watching. Remove hides the card for that profile and keeps the progress, so a film abandoned after ten minutes stops sitting at the front of Home; it comes back by itself once it's played again, and a toast offers Undo for a few seconds. Mark as watched finishes it and tells Jellyfin too, so Jellyfin's own resume row goes with it. Both actions are on the phone remote's title sheet as well. (#100)
  Household: a title you gave up on can be taken off Continue watching, with Undo, or marked watched.

## 2026-11-01

- **Advert breaks shaded on the seek bar**: the breaks comskip found in a recording now show as shaded marks on the player's seek bar, so you can see where they are before you reach one. The marks follow the bar as it grows under the pointer, leave the clicking and dragging alone, are kept inside the recording when comskip gives a time past either end, and recordings without comskip data show no marks at all. (#72)
  Household: the advert breaks in a recording are shaded on the seek bar.
- **Series links can keep only the latest few** ([docs/FEATURES.md](docs/FEATURES.md)): a series link now keeps every episode or just the latest 3, 5 or 10, picked on the TV or when setting one up from the phone. Older recordings are deleted as soon as a new one finishes, along with their Jellyfin entry, but never one that is still recording or waiting in the play queue. (#98)
  Household: a series link can keep just the latest 3, 5 or 10 episodes, and tidies the rest away.
- **What's new is for the household now** ([docs/FEATURES.md](docs/FEATURES.md)): a change in this file can carry a `Household:` line saying what it means in one sentence, and only those lines are what the TV pops up after an update; the rest is internal work and never interrupts anyone. Each profile on the TV is told once, so everyone gets it rather than only whoever turned the TV on first, and a TV that was used before this carries its old note over. Settings › About now has the last three of them, and the phone remote and setup page read the same wording. (#111)
- **The overview docs now say what is true** ([docs/FEATURES.md](docs/FEATURES.md)): FEATURES claims to be current instead of frozen at PR #61, stops promising that a recording clash offers what to drop (it only warns), and admits there is no list of the reminders you have set. TESTING's clash step says the same, and ROADMAP is labelled as a snapshot of 30 October with CHANGELOG as the live record. (#106)
- **Alerts can be set up from a phone** ([docs/FEATURES.md](docs/FEATURES.md)): the settings page at `/setup/` was meant to be everything the TV's Settings is, but Alerts was missing, so a webhook or an ntfy topic could only be typed on the TV. It now has the same section: the webhook and ntfy addresses, how many days before a subscription runs out to warn, how full the NAS may get, whether to show them on the TV, Check now and Send a test alert, plus what the Hub is currently worried about. (#106)
- **Dependency updates are split by size** ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)): Dependabot now opens one pull request a week for the minor and patch bumps in an ecosystem and a separate one for the major versions, so a major that needs a migration can no longer hold back the small updates behind it. npm, Gradle, the GitHub Actions and the Docker images all work this way. (#146)
- **A Saved tab on the phone remote** ([docs/phone-remote.md](docs/phone-remote.md#watch-on-the-tv)): the phone's Watch tab now has Saved next to Queue, listing what is saved for later, the household's list and the TV profile's own together. Every row plays on the TV, adds to the queue or takes the thing off the list, and the TV's Home row updates as soon as you do. Kids see only what their rating allows, and the tab goes away with Recordings when a household switches that off. (#75)
- **The Android apps build on AGP 9 and Gradle 9.8** ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#build-and-ci)): the Android Gradle plugin moved to 9.5, which compiles Kotlin itself, so the separate Kotlin plugin is gone and the Compose compiler plugin carries on. The watching client compiles against API 37 because androidx.core now asks for it, and CI provisions Gradle 9.8.2 for both APKs. The apps themselves are unchanged. (#147)
- **Every write route says what it needs**: the Hub now lists each route that changes something as paired, adult-only or deliberately open with a reason beside it, and a test fails if one is added without saying so. Seven routes that were wide open now need a paired device: choosing which list the guide opens on, the TV's playback report, recording a programme, marking one watched, a series link, and adding or cancelling a reminder. Nothing changes on screen for a paired TV, phone or app; an unpaired browser on the network can no longer ask the Hub to record something. `node tools/hub/route-auth.mjs` prints the whole table. (#94)
- **PIN guesses are limited**: five wrong PINs lock the profile and the TV or phone that guessed for a minute; each further wrong try doubles the wait, up to an hour. The TV and the phone show how long to wait, the counts are kept on the Hub so restarting it changes nothing, a right PIN clears them, and `reset-pins.js` clears them along with the PINs. (#92)
- **The Hub says when it keeps restarting** ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#health-and-auto-restart)): each start is now counted in the Hub's database, so three restarts inside six hours raise an alert that goes to the webhook or ntfy and to the card on the TV, and turns red at six. It clears by itself once the restarts are old. `DEMO=1` isn't counted. (#96)
- **The Hub now checks itself, and Docker can restart it** ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#health-and-auto-restart)): `/api/health` used to say ok whatever happened. It now tests the database, the free space on the data volume, that the recording loop is still ticking and that the data folder can be written, and lists in plain words what is wrong. The TV app and the update scripts carry on as before. The Docker image has a health check (so `docker ps` shows healthy or unhealthy), and an opt-in `autoheal` service restarts the Hub when it stays unhealthy. (#96)
- **Green-screen jump scares** ([docs/halloween.md](docs/halloween.md#green-screen-clips-a-zombie-over-the-film)): a video filmed on a green screen, such as a zombie, can have the green taken out so only the zombie appears and the film, TV or menu keeps playing behind it. Add it on the phone remote's Clips tab and tap Green screen on it (a file with "green screen" in its name is done by itself). (#139)
  Household: A zombie filmed on a green screen can walk over the film or the menu, with the green taken out.
- **Jump scare sound during films**: a scare's sound now plays over films with Dolby or DTS sound, not just live TV. The film's sound is decoded for the few seconds the clip is on, then goes back to passthrough. (#139)
  Household: A jump scare's sound now plays over films with surround sound, not just live TV.
- **PLAN.md is marked historical** ([docs/PLAN.md](docs/PLAN.md)): the original plan now opens by saying it is the October 2026 design record, lists the decisions that changed since (profiles with PINs, two Android apps and casting are all in the app), and points at FEATURES, ARCHITECTURE and ROADMAP for what exists today. A new decision record, [ADR 0003](docs/adr/0003-profiles-and-mobile-apps-in-scope.md), explains why those three moved into scope, and the README's docs table says PLAN is historical. (#107)
- **Automated dependency updates**: Dependabot checks the npm workspaces, both Android apps, the GitHub Actions and the Hub's and PXE server's base images once a week, opening one grouped pull request per ecosystem rather than one per package, for a person to review and merge. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) says what is checked. (#95)
- **yt-dlp keeps itself current** ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)): the Hub image takes the latest yt-dlp release when it is built and the Hub updates the binary once a day, so there is no version to pin or check; the box gets yt-dlp from its distro and the weekly system update refreshes it. Nothing to do, and the architecture page now says so. (#95)
- **The desktop app works with a mouse** ([docs/desktop.md](docs/desktop.md#using-it)): point at something to select it, click to choose it, right-click or the mouse's back button to go back, and the wheel to scroll pages, rows and the guide. The coloured key hints along the bottom are buttons, and the player has a seek bar to click or drag, buttons for play and pause, volume, audio and subtitles and full screen, and double-click for full screen. The pointer hides when you stop moving it. The TV box is unchanged. (#138)
  Household: You can now use the desktop app with a mouse: click to pick things, right-click to go back, wheel to scroll.
- **Live TV in the desktop app's guide preview**: the preview at the top of the guide now shows the channel, as on the TV box, rather than staying black with only the sound. It uses no extra IPTV connection. (#138)
  Household: The guide preview at the top of the desktop app now shows the channel instead of a black box.
- **Recent searches**: Search remembers what each profile searched for and shows it before you type, and as suggestions while you type; press OK on one to search again. Clear removes one, Clear all the lot. The phone remote's Search shows the same list. (#137)
  Household: Search remembers what each profile looked for and offers it before you type.
- **Continue watching remembers where you were**: stopping a film or episode part way puts it first on Home, with its progress bar, whether it played from Jellyfin, IPTV or online. A series shows once, on the episode you were on, and Resume carries on from there. When you finish an episode the next one shows instead, and finished films drop off. (#136)
  Household: A film or episode you stop half way now sits first on Home with its progress bar, on every screen.
- **Favourites for each profile** ([docs/profiles.md](docs/profiles.md#favourites)): every profile now has its own favourite films, shows and channels. Press Blue on a film's page, Green while watching, or hold OK on a channel in the guide; the phone remote and the Android app have a heart button too. The guide's Favourites list follows the profile watching, Home has a Favourites row, and Films and TV Shows can show just your favourites. Channels that were favourites before are now favourites on every profile. Android app 0.4.0. (#135)
  Household: Everyone in the house now has their own favourites, kept apart from the other profiles.
- **TV apps button removed**: the TV apps tab along the top, its setting in Picture and sound and on the setup page, its line in the help screen and the phone remote's Go to the TV's apps button are gone. Netflix and the TV's other apps are still on the Hisense's own Home button. Saved settings from before load as normal. (#125)
- **Features on each screen** ([docs/features-per-screen.md](docs/features-per-screen.md)): switch Live TV, Films, TV shows, Music, Recordings, Downloads, Search, Cast & games, Weather, music video channels, projected clips or pop-ups off on one screen only. In TV Settings › Features on this screen, for every paired screen on the Hub's settings page, and in the Android app's Settings. A switched-off feature leaves the menu, Home, the colour keys and help, and nothing opens it there. The phone remote follows the TV. (#133)
  Household: You can now switch off Live TV, Films, Music or any other part of the app, screen by screen.
- **Screen pairing code stays put**: a screen waiting to be let in (such as the desktop app) keeps the same four-letter code until it's let in or the code runs out after fifteen minutes. Before, two waiting screens that reached the Hub from one address kept replacing each other's code every few seconds. (#122)

## 2026-10-31

- **OK and Back on the TV remote**: the box now always loads its own button list onto the CEC adapter, before the screen opens the remote, so OK, Back, the colour keys, numbers and channel up/down work as well as the arrows. (#121)
  Household: OK and Back now work on the TV remote every time the box starts.
- **TV remote over the Pulse-Eight adapter**: the box now tells the adapter its HDMI address (from the TV's EDID) so the TV sends it the remote's buttons, and sets the adapter up again if it's plugged in after the app has started. (#120)
- **Save to Jellyfin from the Android app** ([docs/save-to-nas.md](docs/save-to-nas.md)): a film's
  Other versions and an episode's Versions now have **Save to NAS + Jellyfin**, as the TV and the
  phone remote do. It keeps the version you picked on the NAS and adds it to Jellyfin for every
  screen, which is different from Download (a copy on the phone for away from home). Adult profiles
  only. Android app 0.3.3. (#119)
- **Desktop app for any Linux** ([docs/desktop.md](docs/desktop.md)): the TV app as an AppImage for Fedora, Omarchy and other Linux desktops. It opens in a normal window, plays in the computer's own mpv, leaves the screen and sound alone, ignores the phone remote (that stays with the TV), and updates itself from Settings › About. (#118)

## 2026-10-30

- **Android app fills the screen**: on newer phones (Android 15) the app left a big empty band
  above the title bar, because the space for the status bar was added twice. It now sits just under
  the status bar, in portrait and landscape, and keeps clear of the camera cut-out. Android app 0.3.2. (#117)
- **Accessibility** ([docs/accessibility.md](docs/accessibility.md)): each profile has Settings ›
  Accessibility, also on the phone's setup page. Audio description plays the described soundtrack
  when a film or channel has one, text can be 125% or 150% on every screen, Bold focus puts a thick
  yellow ring round whatever is picked, and Reduce motion stops sliding screens, projected clips,
  jump scares and moving screensavers. (#116)
- **Skip intro everywhere** ([docs/watching-extras.md](docs/watching-extras.md#skip-intro-everywhere)):
  with Jellyfin's Intro Skipper plugin (a script installs and checks it), Skip intro and Skip credits
  show on every series, recordings in Jellyfin included. When the credits are marked, the next
  episode starts 15 seconds into them instead of at the very end. (#116)
- **The box undoes a bad update by itself** ([docs/box-install.md](docs/box-install.md#updates-and-rolling-back)):
  after each update the box checks, within 5 minutes, that the TV app starts, reaches the Hub, plays a
  test clip and still sees the CEC adapter. If not, it goes back to the snapshot from before the
  update, reboots, and won't install that version again by itself. A card on the TV, Home Assistant
  or ntfy and Settings › About say what happened. There's also Roll back last update in Settings ›
  About and on the phone. Untested on the box so far. (#115)
- **Kids TV time and bedtime** ([docs/profiles.md](docs/profiles.md#tv-time-and-bedtime)): each Kids
  profile can have a daily allowance (30 minutes to 4 hours, counted only while something plays,
  back to zero at midnight) and a bedtime for school nights and for Friday and Saturday. Warnings
  at 5 and 2 minutes; when time's up what's on can finish (30 minutes at most), then the TV goes
  back to Who's watching?, where a grown-up's PIN gives 15, 30 or 60 minutes more or no limits
  until the morning. The Hub enforces it, so the Android app (0.3.1) and a browser can't get round
  it, and it can tell Home Assistant or ntfy. Set it on the TV or the phone's settings page. (#114)
- **Home Assistant both ways** ([docs/notifications.md](docs/notifications.md#home-assistant-the-other-way-the-tv-as-a-media-player)):
  Home Assistant can add the TV as a media player that shows what's on (title, picture, position,
  channel, profile) and can play, pause, stop, change channel, set the box's volume and put the TV
  in standby, all with the Hub's API key. A new playback events webhook is told when a film or
  programme starts, pauses, resumes, stops or reaches the credits, the channel changes or someone
  switches profile, so the lights can dim for a film. The docs have the Home Assistant set-up and
  example automations. Update the Hub and the box to get it. (#113)
- **What's new** ([CHANGELOG.md](CHANGELOG.md)): this list is now in the apps. The TV has Settings ›
  What's new, the setup page a What's new section, and after an update the TV's Home, the phone
  remote and the Android app (0.3.0, Settings › What's new) show what has changed since they last
  looked, once. Kids profiles don't get the pop-up. API: `GET /api/changelog?seen=<id>`. Update the
  Hub to get it. (#112)
- **The phone remote sideways** ([docs/phone-remote.md](docs/phone-remote.md)): the remote turns to
  landscape in the browser, the installed web app and the Android app (0.6.0, which follows the
  phone's rotation lock). Sideways the d-pad sits in the middle with keys either side, the tabs move
  to a rail down the edge and Now Playing shrinks to a strip. The pairing screen and the Android
  app's Hub screen scroll when they don't fit. (#68)
- **YouTube playlists on music channels** ([docs/music-channels.md](docs/music-channels.md)): a
  channel can follow a YouTube playlist. Every video in it is downloaded to the NAS and played
  offline like the rest; the Hub reads the playlist again every six hours, fetching videos added
  since and taking off ones removed from it. The TV (channel › Add a YouTube playlist) and the
  phone's settings page show progress, what was skipped and any video that failed, with Check now,
  Stop following and Remove. API: `POST/DELETE /api/mix-channels/:id/playlists`. (#67)
- **Android client 0.2.1: Hub setup page opens straight away.** Settings › Hub setup page in the
  Android app used to land on "Pair with your TV", because Chrome doesn't share the app's key. The
  app now asks the Hub for a one-time code (`POST /api/pair/handoff`) and opens
  `/api/pair/open?code=…`, which gives Chrome a key of its own (listed as "<phone> (browser)" in
  Phones and remotes) and goes on to the page. The same goes for "Phone remote for the TV" when the
  remote app isn't installed. (#66)
- **TV apps, trailers, scores and subtitles** ([docs/watching-extras.md](docs/watching-extras.md)):
  a **TV apps** button along the top (and on the phone's Cast sheet) hands the screen to the TV's
  own Home over HDMI-CEC for Netflix, Prime Video and Disney+; Input on the TV remote comes back.
  Film and series pages get a **Trailer** button, **review scores** (TMDB, plus IMDb, Rotten
  Tomatoes and Metacritic with a free OMDb key) and a **More like this** row; Home gets **Because
  you watched**. **Subtitles** can be on, off or only for other languages per profile, come from
  **OpenSubtitles** when a film has none (by themselves, or Options › Find more online), and can be
  bigger, boxed, yellow or raised. Add the OMDb and OpenSubtitles keys on the setup page (Scores and
  subtitles), then update the box too: the TV apps button and fetched subtitles need the new shell.
  (#65)
- **Weather** ([docs/weather.md](docs/weather.md)): today's weather on Home ("Rain from 4pm"), the
  temperature next to the clock, a forecast page with the next hours and the week, and the weather
  under the screensaver's clock. Set your town or postcode in Settings › Weather on the TV or the
  phone; the forecast is Open-Meteo's (free, no key). "What's the weather like" by voice, and Watch
  › Weather on the phone remote. (#64)
- **Hub backup and the box without the Hub** ([docs/backup.md](docs/backup.md)): every night at
  03:30 the Hub copies its database and clips to `/mnt/nas/.ultimatetv-backups` and keeps the last
  14; `update.sh` takes one before each update. Settings › About on the TV and ⚙ Settings on the
  phone show how the last one went, with Back up now; the phone can restore one, and so can
  `tools/hub/restore.sh` on the server. Alerts say when a backup fails or none has worked for two
  nights. When the Hub is down the box shows its own screen instead of a blank one: the time, what's
  wrong, downloads on the box (Kids only see theirs), games and AirPlay, and it goes back to the TV
  app when the Hub answers. Update the Hub and the box. (#63)

## 2026-10-29

- **Projected clips** ([docs/projected-clips.md](docs/projected-clips.md)): jump scares become clips
  for any occasion. A snowman walks along the bottom at Christmas, the Easter bunny hops across,
  hearts float up on Valentine's, a banner drops in on a birthday, fireworks for Bonfire Night and
  New Year. Built clips say which occasion they're for (Auto goes by the date), can walk, hop, fly,
  float up, drop in or peek, and can sit see-through over the whole screen. **Play on a loop** turns
  the TV into a window projector. Six starter packs come with the Hub. Clips can be shared as a pack
  file or a link and QR code, and the phone's **Browse packs** reads a curated community list from
  this repository (GitHub only, checksummed, every file checked). The phone's Scares tab is now
  **Clips**; Settings › Jump scares is **Projected clips**. Update the Hub and the box. (#61)
- **Cast and games** ([docs/casting-and-games.md](docs/casting-and-games.md)): a new screen (Blue on
  Home) for putting other screens on the TV. iPhones, iPads and Macs mirror over **AirPlay** (UxPlay
  on the box). Any laptop shares its screen from Chrome, Edge or Firefox at
  `https://<hub>:8096/cast/`, after the TV asks; add a virtual display first to use the TV as a
  second screen. Android phones send a **link** (YouTube, a video, a stream) or a **photo or video**
  from the phone remote's new **Cast** sheet, which the installed remote also opens from Android's
  share menu. **Games** open full screen from the same screen: RetroArch, Moonlight (games from a PC
  running Sunshine), Steam Link and GeForce NOW, and the TV app comes back when they close. Nothing
  can be cast onto the Kids profile, and games there are off unless allowed. Update the Hub (it now
  also serves HTTPS on `HUB_HTTPS_PORT`, 8096 by default) and run the box installer again. (#60)
- **What the buttons do** ([docs/everyday-extras.md](docs/everyday-extras.md)): a strip along the
  bottom of each screen says what the colour keys do there, and Info opens a help screen with the
  remote drawn. On Home the colour keys are shortcuts. (#60)
- **Sleep timer**: 15 minutes to 2 hours or the end of the programme, from Options, the phone's moon
  button or by voice. A minute before it asks "Still watching?"; then the sound fades, playback
  stops and the TV goes to standby. (#60)
- **Alerts before things break**: the IPTV or TorBox subscription running out, the guide not
  updating, failed recordings, a full NAS and live TV not starting go to a Home Assistant webhook or
  ntfy, and to a small card on the TV for grown-ups. Settings › Alerts. (#60)
- **Save for later**: a watchlist per profile from the TV (Red on a title), the phone and voice
  ("save Dune for later"), as a row on Home. (#60)
- **Skip the adverts in recordings**: comskip (now in the Hub's image) finds the breaks; recordings
  show Skip adverts, or skip them by themselves (Settings › Recording). (#60)
- **Seasonal clips**: now and then a sleigh, a bunny, fireworks or a ghost drifts across the TV for
  the season, drawn by the TV or uploaded from the phone. A community library
  ([community/clips](community/clips/README.md)) shares clips and jump scares between households.
  (#60)
- **Spotify and Deezer sign-in fixed**: Spotify showed nothing because the receiver was set to wait
  for a sign-in code with phones also turned on, and in that state it can't answer the TV, so the TV
  thought it wasn't installed. It now signs in the usual Spotify Connect way (pick the TV in the
  Spotify app on your phone) and remembers the account, with a code as the other way. The Music tab
  always shows a Spotify card and says what's needed: not installed, starting, not starting (with
  the reason and a Restart button), or how to sign in. The phone remote's Music page shows the same.
  Deezer's phone login now copes with a cookie banner and a login in two steps, and tells the phone
  how it went: logged in, Deezer's own error, or that Deezer wants a puzzle or code on the TV. New
  guide: docs/music.md. Needs a Hub update and a box update. (#56)
- **Themes** ([docs/themes.md](docs/themes.md)): Settings › Theme on the TV and ⚙ › Theme on the
  phone choose from Dark, Light, Slick, Cyberpunk, Ocean, Forest, Sunset, Halloween, Christmas,
  Easter and Valentine's. On the TV, moving over a theme tries it on the whole app, and OK keeps it.
  The phone remote and the web pages wear the theme too. **Seasonal themes** (on by default) bring
  out Halloween, Christmas, Easter and Valentine's on their days and put your theme back after.
  Christmas has snow and fairy lights, Easter blossom, Valentine's hearts and Cyberpunk a neon grid.
  Update the Hub and the box. (#54)
- **Save to NAS and Jellyfin, before and while watching**
  ([docs/save-to-nas.md](docs/save-to-nas.md)): Save to NAS now works for episodes and whole series
  too, Red in Versions saves that exact version, the player's Options has **Keep a copy** for the
  copy that's playing, and the phone has Save buttons (title sheet, 💾 per episode, Now Playing). The
  Hub checks the file lands in one of Jellyfin's library folders before telling Jellyfin, and the TV
  says when it's saved and in Jellyfin (or where Jellyfin looks instead). Pressing Save twice keeps
  one copy. (#53)
- **Get the Android apps again**: TV Settings › Android apps and the phone's ⚙ Settings › Android
  apps show a QR code and the link for each app (the watching app and the remote). Scan with a
  phone's camera, or tap Download on the phone, to install. Home Wi-Fi only, as before. (#52)
- **Phone settings › Guide lists and channels**: put the TV Guide's lists (favourites, custom
  guides, categories) in your own order, choose which list each profile's guide opens on, build and
  reorder custom guides, and give any channel a new number (taking another's swaps them), a
  different category (kept through channel refreshes), a favourite star or hide it. (#51)

## 2026-10-28

- **Download to the TV box** ([docs/downloads.md](docs/downloads.md)): films, episodes, whole series
  and recordings can be copied onto the box's own disk from the TV (**Download to box**) or the
  phone remote (⤓, and its **On the box** tab). They play from there with the NAS and Jellyfin out
  of reach, so they're for trips, and start at once at home. A **Downloaded** tab on the TV lists
  them with the space used. The box keeps 10 GB free and deletes downloads after 14 days, or a day
  after they're watched (both can be changed). Kids see only what their profile allows. Update the
  Hub and the box. (#50)
- **Steady update status**: the phone's Updates card no longer flips between "Couldn't check" and
  "Update available". The Hub keeps GitHub's last answer (a quick reload used to drop it), shares
  one check between everyone asking, waits a minute after a failure and falls back to git's own
  endpoint when the API's 60-an-hour limit runs out. The box's reports keep its last check too. When
  the answer is over 15 minutes old the card says when it was checked. (#49)
- **Build your own jump scares** ([docs/halloween.md](docs/halloween.md#building-your-own)): the
  phone remote's Scares tab now takes sounds as well as pictures and videos, and **Build a scare**
  puts a picture or video and a sound together, placed in one of nine spots (or full screen) at the
  size you pick, with the video's own sound off if you like. A transparent GIF floats over the film
  rather than blacking it out. Update the Hub and the box. (#48)
- **Take the Hub on a trip** ([docs/travel.md](docs/travel.md)): `sudo bash tools/hub/travel.sh
  away` on the box builds a Hub there, takes the home Hub's data (profiles, settings, channels,
  pairing, scare clips), copies the music videos onto the box and points the TV app at it;
  `travel.sh home` sends what changed back, with anything recorded or downloaded on the trip. The
  home Hub stands by meanwhile, so the two never share the IPTV connection. QR codes from a Hub on
  the box point phones at the box's address. Update the Hub and the box before the first trip. (#47)
- **Screen dimming and screensavers** ([docs/screensaver.md](docs/screensaver.md)): with nothing
  playing and no button pressed, the screen dims (after 10 minutes unless changed) and later a
  screensaver starts (after 20). Twelve moving themes drawn live (Northern lights, Fireplace,
  Aquarium, Deep space, Snowy night, Rainy window, Sunset sea, Lava lamp, Fireworks, Halloween,
  Christmas, Bouncing logo), endless generated Landscapes and Modern art, your own photos and short
  videos from a NAS folder, a black screen, or Shuffle. The first button press only wakes the
  screen. Set it up in the TV's Settings › Screensaver or the phone's settings page. (#46)
- **Halloween: a theme, Spooky TV and jump scares** ([docs/halloween.md](docs/halloween.md)):
  Settings › About › Theme wears a Halloween look (orange on deep purple, cobwebs, drifting fog and
  the odd bat) and starts on "auto", which puts it on from 25 October to 1 November and takes it off
  after. Three easter eggs are hidden on the remote, starting with Up Up Down Down Left Right Left
  Right. **Spooky TV** (channel 393) is a new made-up channel of haunted houses, foggy graveyards
  and ghost sounds: a channel can now be an "atmosphere" one, where long clips are welcome and
  nothing has to look like a single (Channel options › Plays). **Jump scares** cut one of your own
  clips in full screen over whatever is on, now and then: set up and set off from the phone remote's
  new Scares tab, or the TV's Settings › Jump scares, and never on a Kids profile. Update the Hub
  and the box to get all of it. (#45)
- **Play queue**: line up films, episodes and recordings to play one after another. On the TV, Add
  to queue (or Green) on a film, "Queue S1 E3" on a series, or Green on any episode; on the phone,
  Add to queue and the + beside each episode, and the new Watch › Queue tab to reorder, remove or
  clear. Home shows "Your queue"; select something there to play it now, play it next or take it
  off. When a film or episode ends, the first thing queued plays (with the Up Next card and its
  countdown); with nothing queued, the next episode of the series carries on as before. The queue
  lives on the Hub, so it survives restarts. Update both the Hub and the box. (#43)

## 2026-10-27

- **Music channels can play video files already on the NAS**: browse to a file or a whole folder on
  the TV (a channel › Add videos from the NAS) or the phone (a channel's Videos). They play from
  where they are and are never deleted. (#44)

## 2026-10-26

- **Quality badges in the guide**: each channel shows the best quality it comes in (SD, HD, FHD, 4K)
  under its name. (#42)
- **Pairing phones with the TV** ([docs/pairing.md](docs/pairing.md)): only phones that have scanned
  the code in the TV's new Settings › Phones and remotes can press keys, play things, send pop-ups
  and news flashes, change settings or start updates. The same screen lists every paired phone and
  screen to rename or remove. Home Assistant and scripts send pop-ups with an API key (`X-Api-Key`),
  shown on the phone's settings page: **existing Home Assistant commands need the header added**
  (docs/notifications.md). The box pairs itself when the Hub updates; phones get a pairing screen.
  Scanning needs Android remote 0.5.0 and Android app 0.2.0 (both can type the code instead).
  `PAIRING=off` in the Hub's `.env` turns it off. (#41)
- **Android app 0.1.1**: gets past Who's watching and shows the Hub's app name. (#40)
- **Pop-ups on the TV**: a doorbell showing who's at the door, a meeting, an alarm. Send a title,
  text, a picture, a video or a mix, from the phone remote's new **Pop-up** button or from Home
  Assistant and scripts through `POST /api/notify`, and choose where it goes (middle, a corner, top,
  bottom, full screen), its size, how long it stays and its sound. It can pause the film while it
  shows. See docs/notifications.md. Needs a Hub and a box update; picking a photo in the Android
  remote needs its new version (0.4.0). (#39)
- **Android app for phones and tablets** (`/api/client/app.apk`,
  [docs/android-client.md](docs/android-client.md)): watch live TV, catch-up, recordings, films and
  TV on the home Wi-Fi, and download films, episodes and recordings to watch anywhere. Jellyfin
  titles can download a smaller 720p copy. When the phone would take the IPTV connection from the
  TV, it asks first. Update the Hub to get it. (#34)

## 2026-10-25

- **Music channels skip songs they already have**: Music channels no longer take a second upload of
  a song they already have (a lyric video and a clip of the same song, say). (#38)
- **Music channels: no more stuck downloads**: a download that hangs is stopped after five quiet
  minutes and tried again, so it no longer holds up every download behind it. Channels made from a
  search or two (a Christmas channel, say) now keep reading further down YouTube's results until
  they're full. (#37)
- **Rename the app**: call it GazosTV (or anything up to 24 characters) from the phone's settings
  page (App name) or the TV's Settings › About › App name. The new name shows on the TV's top bar,
  the phone remote, the settings pages, the box's "can't reach the Hub" screen and in the Spotify
  app's device list. Needs a Hub and a box update. (#36)
- **Breaking news from the phone**: the remote's News button puts a BBC News style "BREAKING NEWS"
  bar along the bottom of the TV, over whatever is on, with your own message (and channel name). It
  stays for 30 seconds to 15 minutes, or until you take it down. Needs a Hub and a box update. (#35)
- **Updating the Hub shows what's new**: the Hub asks GitHub what's on main since the code it runs
  and lists the merged changes by name, with the count, on the phone's Updates and in the TV's
  Settings › About (which can now update the Hub too). Both check again every 5 minutes while open.
  (#33)
- **Music video downloads and space in Settings**: Settings shows how many music videos have
  downloaded and the space they take, per channel and in total: on the TV (Music channels and About)
  and at the top of the phone's settings page. (#32)
- **Music video channels fill the screen**: black bars baked into a video are cropped off, and any
  other shape is zoomed to fill. A caption at the bottom shows the artist and song as each video
  starts, and what's coming up next for its last five seconds. Needs a Hub and a box update. (#31)
- **Music channels download sooner**: videos you pick download while other channels are still being
  filled. (#30)
- **Next episode**: looked up ahead, shown on an Up Next card in the corner, and it starts without a
  gap. (#28)
- **Truer heat readings**: Stats judge the box's heat by the processor's own sensor. (#27)
- **Phone arrows work in the TV's Settings**: the phone remote's arrows now move around the TV's
  Settings (and any screen that was still loading): focus no longer jumps back to the first item
  after a key from the phone or HDMI-CEC. (#26)
- **The phone's settings page has a Music channels section**: add, edit, turn off, reshuffle and
  delete channels, look for more videos, and add or remove videos by link. (#26)
- **Phone remote: Now Playing, Watch tab and Stats**: a Now Playing card with a progress bar, skip,
  live and track buttons; a Watch tab to start anything on the TV from the phone (guide, films, TV,
  recordings, Spotify, search); and a Stats page for the box and the Hub (playback quality, HDMI,
  CPU, GPU, memory, disks, network, warnings and logs). Update the Hub and the box to get it. (#25)
- **Deezer login from the phone**: the Music tab shows a QR code (until the box is logged in). Scan
  it, type your Deezer email and password on the phone, and the TV opens Deezer and fills in its
  login page. The Hub only holds what you typed in memory, for two minutes at most, and hands it to
  the TV once. (#24)
- **Android remote downloads from the Hub**: the Hub serves the Android remote at
  `/api/remote/app.apk` (CI publishes each build from main), and the remote shows a banner when a
  newer app is out. The app (0.3.0) is now always signed with the same key, so updates install over
  it; uninstall 0.1/0.2 once first. (#23)
- **Music tab: Spotify and Deezer**: Spotify and Deezer on the TV. The box is a Spotify Connect
  speaker ("UltimateTV" in the Spotify app, via go-librespot, which the box installer now builds).
  Sign in once with the code the TV shows (spotify.com/pair, Premium needed), then play your
  playlists, albums, artists and Liked Songs from the remote, with a big Now Playing panel, shuffle,
  repeat and volume. Deezer opens its own web player over the app, driven by the remote (arrows move
  a highlight, OK presses, Back returns to the app and the music carries on). Play/Pause controls
  the music from any screen; a film pauses the music, and Spotify and Deezer pause each other. Not
  on the Kids profile. (#22)
- **Music video channels**: the Hub makes its own live channels from music videos it downloads to
  the NAS (`Music Videos` folder) in HD or 4K with yt-dlp. It starts with Clubland TV (390), House
  TV (391) and Halloween TV (392), about 30 videos each, and every pass through a channel is a fresh
  shuffle. They're in the guide under Music with a programme for each video. Create your own, add
  artists or songs, take videos off and reshuffle in Settings › Music channels. See
  [docs/music-channels.md](docs/music-channels.md), which also covers the API an AI curator will
  use. (#21)
- **Channel names in the TV Guide**: each channel shows its name next to its logo (the live banner
  too). (#20)
- **Channel lists above the guide**: the channel lists sit above the grid, so you can pick one with
  the remote (Up from the top row) as well as step through them with Blue. Empty categories are left
  out and each list shows how many channels it has. (#20)
- **Custom guides**: build your own guide with your choice and order of channels (TV Guide › New
  guide), keep as many as you like, and make any list the one a profile's guide opens on (Make
  default). Channel up and down on live TV stay within the list you were browsing. (#20)
- **Search finds channels**: search finds channels by name with or without spaces ("bbcone", "itv
  1") and shows what's on them now. (#20)
- **Phone remote: settings for everything**: a ⚙ Settings button opens the phone settings page,
  which now covers everything the TV's Settings does (picture and sound, recording, every profile
  and PIN, playback stats) plus updating the Hub and the box, reloading the TV app and refreshing
  the guide. (#19)
- **Voice control from the phone**: voice control. Tap Voice and say a channel ("watch BBC One",
  "channel 101"), a search ("search for Dune") or a command ("pause", "go home", "down three
  times"). The Android app (0.2.0) uses the phone's speech recogniser; in Chrome, the keyboard's mic
  key stands in. (#19)
- **A card while a film starts**: starting a film or episode shows a card with the title, what it's
  waiting on, a moving bar, the seconds so far and the download speed. After 25 s it says TorBox may
  still be fetching the file (Back cancels). The box now waits up to 5 minutes for a slow TorBox
  link instead of mpv's 60 s. (#18)
- **Failed versions say so**: a version that fails to play says so, with Choose another version and
  Back (it used to leave a black screen). (#18)
- **Series get Versions too**: a Versions button for the next episode, and the yellow button on any
  episode, so IPTV and TorBox copies of an episode can be picked. (#18)
- **IPTV copies match more films**: copies tagged with the TMDB id and copies that only match by
  name are both listed, and prefixes such as "4K-FR-HDR - " and "[DE] " are dropped from VOD names.
  (#18)
- **Versions list scrolls**: the Versions list scrolls with the selection. (#18)
- **Cancel series links**: each link has a Cancel button to its right. (#18)
- **The right film plays**: English IPTV copies come first, and the TV says plainly when the IPTV
  connection is busy. (#17)

## 2026-10-24

- **Full volume on the box**: the box's sound output is at full volume (the TV's remote sets the
  volume); it had kept the analog output's 40%. (#16)
- **Phone remote pad stays still**: Phone remote: pressing an arrow no longer moves buttons around
  the pad (the pressed look shared the Down arrow's class name). (#16)
- **Sound reaches the TV**: the box moves the sound card to the connected HDMI output's stereo
  profile at start and before each play (WirePlumber had picked the analog headphone output). Dolby
  and DTS still pass through. `HDMI_AUDIO=0` in box.env turns it off. (#15)
- **Sharper, lighter TV output**: the TV's output runs at scale ×1 (KDE picked ×2.7 on the 4K
  Hisense, which made the compositor resample every frame). (#15)
- **Frame-rate match for live TV**: live TV and other streams without a frame rate from the Hub
  switch the screen's refresh rate once mpv reads it from the stream. (#15)
- **Guide follows the selected channel**: the list follows the selected channel on every screen
  size. On a 21:9 monitor the bottom rows used to sit off screen; the UI is now sized by the
  screen's height when it's wider than 16:9, and the guide shows as many rows as fit. (#14)
- **Rolling detailed logs**: rolling detailed logs on the Hub (`data/logs`: the Hub at debug level,
  every box log line and every playback sample), each capped at 50 MB, read at
  `/api/diagnostics/logs/hub|box|playback`. `docker logs` rolls over at 30 MB. The box logs more of
  what mpv does (file loaded, seeks, buffering, why playback ended). (#13)
- **Guide download and setup page fixes**: guides served gzipped load again, IPTV requests are
  logged, and the setup page's Remove buttons work. (#12)
- **Custom refresh rates for films**: screens with no refresh rate that fits a film and no variable
  refresh (the Huawei monitor over HDMI) get a custom mode at a whole multiple of the film's frame
  rate, e.g. 71.928 Hz for 24p: three refreshes a frame, no judder. It's checked the screen takes it
  and added only once; `CUSTOM_MODES=0` in `/etc/ultimatetv/box.env` turns it off. (#11)
- **More AIOStreams links work**: AIOStreams links ending in `/configure` (as DuckStreams hands out)
  and `stremio://` links work. (#11)
- **IPTV sources fixed**: no duplicate channels, big catalogues load, and Live TV is no longer
  empty. (#10)
- **Diagnostics**: the box sends the Hub its recent log, a playback sample every 10 seconds (frame
  rate, screen mode, sync, dropped and late frames, buffer) and the screen's details. Read it all at
  `http://<hub>:8095/api/diagnostics?format=text` (or as JSON without `?format=text`). Addresses are
  cut to their host, so IPTV logins and API keys never appear. See `docs/diagnostics.md`. (#8)
- **Smoother playback on any screen**: playback on screens with no refresh rate that fits the video
  (24p film on a 50/60/100 Hz monitor) no longer resamples to the screen, which mistimed and dropped
  frames all the time. (#8)
- **Stats show the frame-rate match**: the stats overlay says how the screen was matched to the
  video's frame rate. (#7)

## 0.2.0 (2026-10-24)

The first install on the real box.

- PXE reinstall works on the GMKtec K7 Plus: the PXE server can hand out the box's address
  itself, serves the Arch installer over plain HTTP, and copes with the box's two network ports. (#4)
- Box installer: builds `inputattach` (no longer in Arch's repos), downloads Electron during the
  install, and keeps the GitHub token where services can read it. (#3, #4)
- Playback stats overlay (blue button). (#4)
- Box updates from Settings › About, with a version check against GitHub. (#4)
- "From Jellyfin / IPTV / TorBox" badges on titles and in the player. (#4)
- Films and TV only show discovery titles when an addon can play them. (#4)
- Start again plays from the beginning. (#4)
- Versions: the Hub records its commit and build date; the TV app's page is never cached, so the
  TV picks up a Hub update. (#5)

## 0.1.0

The whole app, built before testing on hardware (#2).
