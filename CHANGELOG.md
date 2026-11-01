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

## Updating

- **Hub** (on the Docker LXC): `bash /containers/UltimateTV/tools/hub/update.sh`. It pulls, rebuilds
  with the version recorded, restarts and checks the Hub is up. The TV loads the new app the next
  time it opens it (Settings › About › Reload the app does it straight away).
- **Box**: Settings › About › Update the box, or wait for Monday 4 am. Over SSH: `sudo systemctl
  start ultimatetv-update`. If the box doesn't work afterwards it rolls itself back; Settings ›
  About › Roll back last update (or `sudo systemctl start ultimatetv-rollback`) does it by hand.
- **From the phone**: the remote's ⚙ Settings › Updates updates either one. The Hub's button needs
  the helper installed once: `sudo bash tools/hub/update.sh --phone-updates`.

## 2026-11-01

- **The desktop app works with a mouse** ([docs/desktop.md](docs/desktop.md#using-it)): point at something to select it, click to choose it, right-click or the mouse's back button to go back, and the wheel to scroll pages, rows and the guide. The coloured key hints along the bottom are buttons, and the player has a seek bar to click or drag, buttons for play and pause, volume, audio and subtitles and full screen, and double-click for full screen. The pointer hides when you stop moving it. The TV box is unchanged. (#138)
- **Live TV in the desktop app's guide preview**: the preview at the top of the guide now shows the channel, as on the TV box, rather than staying black with only the sound. It uses no extra IPTV connection. (#138)
- **Recent searches**: Search remembers what each profile searched for and shows it before you type, and as suggestions while you type; press OK on one to search again. Clear removes one, Clear all the lot. The phone remote's Search shows the same list. (#137)
- **Continue watching remembers where you were**: stopping a film or episode part way puts it first on Home, with its progress bar, whether it played from Jellyfin, IPTV or online. A series shows once, on the episode you were on, and Resume carries on from there. When you finish an episode the next one shows instead, and finished films drop off. (#136)
- **Favourites for each profile** ([docs/profiles.md](docs/profiles.md#favourites)): every profile now has its own favourite films, shows and channels. Press Blue on a film's page, Green while watching, or hold OK on a channel in the guide; the phone remote and the Android app have a heart button too. The guide's Favourites list follows the profile watching, Home has a Favourites row, and Films and TV Shows can show just your favourites. Channels that were favourites before are now favourites on every profile. Android app 0.4.0. (#135)
- **TV apps button removed**: the TV apps tab along the top, its setting in Picture and sound and on the setup page, its line in the help screen and the phone remote's Go to the TV's apps button are gone. Netflix and the TV's other apps are still on the Hisense's own Home button. Saved settings from before load as normal. (#125)
- **Features on each screen** ([docs/features-per-screen.md](docs/features-per-screen.md)): switch Live TV, Films, TV shows, Music, Recordings, Downloads, Search, Cast & games, Weather, music video channels, projected clips or pop-ups off on one screen only. In TV Settings › Features on this screen, for every paired screen on the Hub's settings page, and in the Android app's Settings. A switched-off feature leaves the menu, Home, the colour keys and help, and nothing opens it there. The phone remote follows the TV. (#133)
- **Screen pairing code stays put**: a screen waiting to be let in (such as the desktop app) keeps the same four-letter code until it's let in or the code runs out after fifteen minutes. Before, two waiting screens that reached the Hub from one address kept replacing each other's code every few seconds. (#122)

## 2026-10-31

- **OK and Back on the TV remote**: the box now always loads its own button list onto the CEC adapter, before the screen opens the remote, so OK, Back, the colour keys, numbers and channel up/down work as well as the arrows. (#121)
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
