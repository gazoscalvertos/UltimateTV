# Features

Everything UltimateTV does as of 2026-11-02. **Nothing has run on the Hisense yet.** Items marked **(tested)** have run on the real box, Hub or phone; everything else is built and passes its tests against the demo Hub but is untested on the hardware. [CHANGELOG.md](../CHANGELOG.md) is the detail of every change, newest first, and is kept up to date with each pull request; [ROADMAP.md](ROADMAP.md#tested-or-untested-feature-by-feature) has the tested-or-untested table as it stood on 2026-10-30, and [TESTING.md](TESTING.md) is the test run to do on the hardware.

## Live TV and the guide

- IPTV from M3U playlists or Xtream Codes logins, with XMLTV guides; several sources and several feeds per channel, merged into one channel list with names cleaned up and quality badges (4K / FHD / HD).
- Sky-style TV guide: live TV keeps playing in the corner, the highlighted programme's details beside it, a channel/time grid, digits jump to a channel. Channel names show next to their logos.
- Channel lists above the grid: all channels, favourites, categories, and **custom guides** built by hand with your own choice and order (TV Guide › New guide). Any list can be a profile's default, and channel up/down stays within it. ([profiles.md](profiles.md#custom-guides))
- The phone's settings page arranges the guide's lists, builds and reorders custom guides, and renumbers, recategorises, stars or hides any channel.
- Live player with the now-and-next banner, browsing other channels with up/down without changing, number tuning and channel up/down.
- Pause and rewind live TV (mpv keeps up to a gigabyte behind the live point).
- Catch-up and "watch from the start" on channels that offer it.
- Reminders on programmes: Remind me on a programme in the guide, on the TV or from the phone's guide. The Hub fires it, the TV shows a card when it starts, and **Recordings › Reminders lists everything set** (the phone remote has the same list), so a reminder can be taken back without finding the programme again.
- Live TV switches the screen's refresh rate once mpv reads the stream's frame rate.
- Search finds channels with or without spaces ("bbcone"), what's on this week, recordings, films and series, with an on-screen keyboard or typing from the phone.
- Recent searches per profile (kept on the Hub, up to 20): shown before anything is typed and as suggestions while typing; OK runs one. Clear removes one, Clear all the lot. The phone remote's Search shows the TV profile's list.

## Recording and series link

- Record a single programme or a whole series from the guide (Red). Recordings land on the NAS with ffmpeg stream copy and show up in Jellyfin.
- Series links schedule new episodes as the guide refreshes; each has a Cancel button, and you choose whether to keep every episode or only the latest 3, 5 or 10 (the older recordings are deleted as new ones arrive, never one being recorded or lined up to watch).
- The one IPTV connection is shared: watching and recording the same channel uses one stream. When more recordings overlap than the plan has connections, Recordings shows a clash banner naming the programmes, and **OK on it chooses which one to keep**: the others are cancelled, or keep them all and the Hub records what the connection allows.
- Recordings screen: recorded (grouped by series), coming up, series links, a clash banner and NAS downloads.

## Films and TV

- One library from Jellyfin or Plex (Quick Connect or login for Jellyfin, a URL and token or a PIN for Plex; one media server at a time, and Jellyfin playback on the box is **tested**), IPTV VOD and series, and AIOStreams/Stremio addons with TorBox. Plex plays its original files (no smaller copy) and its Next up is derived from On Deck ([plex.md](plex.md)). TMDB supplies artwork, discovery rails and metadata. Addon links ending in `/configure` and `stremio://` links work.
- Each title appears once; **Versions** lists every copy (library first) for films and episodes, with source badges (From Jellyfin or Plex / IPTV / TorBox).
- Discovery titles only show when an addon can play them.
- Home: a hero, your play queue, live now, continue watching, recently recorded, films on TV tonight, trending and recently added.
- **Rows on Home, per profile** ([profiles.md](profiles.md#rows-on-home)): each profile chooses which Home rows it sees and their order, on the TV or a phone at `/setup/`, with **Simple Home** and **Everything** presets. A row that's switched off is never fetched, so Home loads faster.
- **Continuing watching, tidied** ([FEATURES.md](FEATURES.md)): OK on a Continue watching card offers Resume, Mark as watched and Remove from Continue watching. Remove hides it for that profile and keeps the progress (it returns once it's played again); Mark as watched finishes it and updates Jellyfin for Jellyfin titles. Both are on the phone remote's title sheet, and a Remove leaves an Undo for a few seconds.
- Player: seek bar, skip intro, audio and subtitle tracks (Yellow), resume and Start again, Up Next with a countdown.
- **Skip intro everywhere** ([watching-extras.md](watching-extras.md#skip-intro-everywhere)): Jellyfin's Intro Skipper plugin marks intros, recaps and credits across the library (`tools/jellyfin/intro-skipper.mjs` installs and checks it); marked credits bring Up Next in 15 seconds after they start.
- **Features on each screen** ([features-per-screen.md](features-per-screen.md)): switch Live TV, Films, TV shows, Music, Recordings, Downloads, Search, Cast & games, Weather, music video channels, projected clips or pop-ups off on one screen or app only. Set in TV Settings, on the Hub's settings page for every paired screen, or in the Android app; the phone remote follows the TV.
- **Accessibility** ([accessibility.md](accessibility.md)): per profile, the audio description track when there is one, text at 125% or 150%, a bold yellow focus ring and reduced motion (no sliding screens, projected clips, jump scares or moving screensavers). Also on the phone's setup page.
- **Trailers and review scores** ([watching-extras.md](watching-extras.md)): a Trailer button (TMDB's official trailer, played by mpv through yt-dlp) and TMDB, IMDb, Rotten Tomatoes and Metacritic scores (OMDb key) on every film and series page.
- **More like this** under each title and a **Because you watched** rail on Home, from TMDB's recommendations, kept to what a source can play and what the profile may see.
- **Subtitles** ([watching-extras.md](watching-extras.md)): on, off or only for other languages per profile; missing ones fetched from OpenSubtitles by themselves or picked from Options › Find more online; size, a dark box, yellow and a raised position for an 85" screen.
- A starting card shows what playback is waiting on and how fast it's arriving, and says when TorBox is still fetching (the box waits up to 5 minutes). A version that fails says so and offers another.
- **Play queue**: line up films, episodes and recordings from the TV, the phone or the Android app; the queue plays before the next episode and survives restarts.
- **Save to NAS**: TorBox/AIOStreams titles download to the NAS with Jellyfin naming and are announced to Jellyfin. Files dropped in the Inbox share are tidied too. Save from Versions (Red saves that exact version), the player (Options › Keep a copy), a title page in the Android app, the Android app's Versions list, the phone remote, for films, episodes and whole series ([save-to-nas.md](save-to-nas.md)).
- **Download to box** ([downloads.md](downloads.md)): films, episodes, series and recordings copied onto the box's disk for trips, with a Downloaded tab, a 10 GB free-space floor and automatic clean-up.

## Picture and sound (on the box)

- **(tested** on the Huawei monitor, smooth 24p at 71.928 Hz**)** Refresh rate matched to each title with `kscreen-doctor`, and a custom mode at a whole multiple of 24p for screens with no matching rate (`CUSTOM_MODES=0` turns it off).
- HDR switched on for HDR video so the TV enters its HDR mode; Dolby Vision and HDR10+ play as HDR10.
- Dolby Digital Plus (Atmos) and DTS passed through untouched; the sound output is moved to the TV's HDMI at full volume.
- Output kept at scale ×1 on 4K screens; the UI sizes by height on screens wider than 16:9.
- Playback stats overlay (Blue while playing): frame rate, screen mode and how it was matched, dropped frames, buffer.
- **Bluetooth headphones, speakers and controllers** (Settings › Bluetooth, or the same section on the phone): scan, pair-and-trust in one press, and the sound moves to the headphones when they connect and back when they go. Decoded to stereo over Bluetooth, with a lip-sync delay in 20 ms steps. Controllers work in RetroArch, Moonlight, Steam Link and GeForce NOW. ([watching-extras.md](watching-extras.md#headphones-over-bluetooth))

## Profiles

- "Who's watching?" profiles with optional PINs; it returns to the picker when the TV turns on.
- A locked-down **Kids** profile: kids' channels only, films and series up to PG, no Settings, Music, scares or downloads it isn't allowed. ([profiles.md](profiles.md))
- A **Guest** profile for visitors and babysitters ([profiles.md](profiles.md#a-guest-profile)): rated up to its own limit, its own pick of sections, no Settings, recordings or downloads, and nothing it watches is kept — no Continue watching and no Jellyfin progress.
- **What a parent allows for Kids** ([profiles.md](profiles.md#what-a-parent-allows)): say yes or no to one film, series or channel and have that beat the rating both ways — an allowed 15 is shown and plays, a hidden U is kept back. **Allow for Kids** / **Hide from Kids** on a title's page as an adult, and both lists on `/setup/` under each Kids profile, matched by id and by name.
- **The week a Kids profile watched** ([profiles.md](profiles.md#the-week-a-kids-profile-watched)): the last seven days on `/setup/` — minutes per day, what was played, the week's total and any PIN lockouts.
- **TV time and bedtime** for Kids ([profiles.md](profiles.md#tv-time-and-bedtime)): a daily allowance (30 minutes to 4 hours, counted only while playing, reset at midnight) and school-night and weekend bedtimes, warnings at 5 and 2 minutes, what's on may finish (30 minutes at most), then back to Who's watching? where an adult PIN gives 15, 30 or 60 minutes more or no limits until morning. Enforced by the Hub; optional alert to Home Assistant or ntfy.
- **Favourites per profile** ([profiles.md](profiles.md#favourites)): each profile stars its own films, shows and guide channels (Blue on a title's page, Green while watching, hold OK in the guide, and the phone remote and Android app). The guide's Favourites list and Home's Live now row follow the profile; Home has a Favourites row and Films and TV Shows a Favourites filter.
- Changes to the setup and deletions need an adult profile and its PIN.
- **PIN guesses are limited** ([profiles.md](profiles.md#the-pin)): five wrong PINs lock the profile and the TV or phone that guessed for a minute, doubling each further time up to an hour; the TV and phone show how long to wait, the counts survive a Hub restart and a right PIN clears them.

## Music

- **Music video channels** ([music-channels.md](music-channels.md)): the Hub makes its own live channels from music videos it downloads with yt-dlp in HD or 4K (the downloads are **tested** on the Hub). Clubland TV (390), House TV (391), Halloween TV (392) and Spooky TV (393) fill themselves; make your own from artists, songs or searches. Each pass is a fresh shuffle, songs aren't duplicated, black bars are cropped, and a caption shows the song and what's next. Videos already on the NAS can be added too. An API is ready for an AI curator.
- **Radio settings** ([music.md](music.md#changing-how-radio-behaves)): five choices for the radio and podcasts — keep the screen awake, name the station on the screensaver, say what's playing, show podcasts on the Music tab, and the station order — on the TV's Settings and the setup page, kept on the Hub.
- **Music from any screen** ([music.md](music.md#playing)): while music, radio or a podcast plays, a chip at the top right of every other screen names it and pauses it.
- **Radio** ([music.md](music.md#playing)): the Music tab lists UK stations (BBC Radio 1–6, 1Xtra, 4 Extra, Asian Network, World Service, Classic FM, Heart, Smooth, Capital, Radio X, LBC, Gold, Radio Paradise and more, with Fun Kids for children), each showing what it's playing where the stream says. Any station can be added by its stream address. Kids profiles get the Music tab with only Fun Kids, Fun Kids Junior and the podcasts the household follows, and no Spotify or Deezer. On the phone remote under Watch › Radio, and by voice ("play Radio 2").
- **Podcasts** ([music.md](music.md#playing)): find a show by name or paste its feed address, follow it, and see new episodes marked. Episodes remember where you left off. On the TV's Music tab.
- **Music tab**: the box is a Spotify Connect speaker ("UltimateTV", via go-librespot; Premium needed) with your playlists, albums, artists and Liked Songs, Now Playing, shuffle, repeat and volume. Deezer's web player opens over the app, driven by the remote, with a phone login. Play/Pause works from any screen and a film pauses the music.

## Phone remote ([phone-remote.md](phone-remote.md))

- **(tested, in daily use)** Works in any phone browser at `/remote/`, or as a small Android app served by the Hub at `/api/remote/app.apk` (with an update banner). TV Settings › Android apps and the phone's settings show QR codes and links for both apps.
- **(untested on a phone)** An installable web app on an iPhone: `/remote/` carries a manifest, a 180×180 apple-touch-icon and the apple-* tags Safari reads, so **Share › Add to Home Screen** gives a full-screen TV Remote with its own icon, and the page says how the first time an iPhone opens it. A versioned service worker keeps the page and its icons on the phone; `/api/*` is never cached ([phone-remote.md](phone-remote.md#on-an-iphone)).
- Pairing by scanning the TV's code; only paired phones can control anything ([pairing.md](pairing.md)).
- Arrows, OK, Back, colour keys, numbers and typing into Search; volume keys change channel in the Android app.
- **(untested)** Portrait or landscape: sideways it puts the d-pad in the middle, keys either side and the tabs down the edge.
- **(untested)** From 0.7.0 the Android app is in the phone's notifications while the TV plays (title, picture, progress, Pause, skips and Back, or Channel − and + on live TV), in Quick Settings as a play/pause tile, and on the home screen as a resizable widget with the d-pad, OK, Back, Home and the colour keys. None of them poll: the Hub holds one request open until the state changes.
- **(untested)** Two TV boxes in one house: each room's box is a named screen with its own now-playing, sleep timer and pop-ups. The phone remote grows a picker at the top and remembers which room it is for; `POST /api/notify` and the other TV routes take an optional `box`. With one box nothing changes and nothing new appears.
- Now Playing card with progress, skip, live and track buttons; a Watch tab to start anything on the TV (guide, films, TV, recordings, Spotify, search, queue); On the box tab for box downloads.
- Voice: "watch BBC One", "search for Dune", "pause", "down three times".
- Settings page (`/setup/`) covering everything the TV's Settings does, **Alerts included**, plus updating the Hub and the box, reloading the TV app and refreshing the guide.
- Stats page for the box and the Hub: playback quality, HDMI, CPU, GPU, memory, disks, network, warnings and logs.

## Android app ([android-client.md](android-client.md))

- **(tested:** runs on Gary's phone**)** A separate app for phones and tablets at `/api/client/app.apk`: live TV, catch-up, recordings, films and TV on the home Wi-Fi, asking before it takes the IPTV connection from the TV.
- Downloads films, episodes and recordings to watch anywhere; Jellyfin titles can download a smaller 720p copy.
- Save for later and a play queue on a title's page, with Saved and Queue lists from Home; both are the household's, so the TV shows the same things. Save to NAS is on the title page and in Versions, for grown-ups.

## On-screen extras

- **Pop-ups** ([notifications.md](notifications.md)): a title, text, picture or video sent from the phone or Home Assistant (`POST /api/notify` with `X-Api-Key`), placed, sized and timed, optionally pausing the film.
- **Breaking news**: a BBC News style bar along the bottom with your own message.
- **Screen dimming and screensavers** ([screensaver.md](screensaver.md)): twelve live scenes, generated landscapes and modern art, NAS photos and videos, black, or shuffle.
- **Halloween** ([halloween.md](halloween.md)): an automatic theme from 25 October to 1 November, three hidden easter eggs, and jump scares (your own clips, or ones built from a picture or video plus a sound, or a green-screen video keyed so only the zombie shows over the film), never on Kids.
- **Themes** ([themes.md](themes.md)): Dark, Light, Slick, Cyberpunk, Ocean, Forest and Sunset, plus seasonal Halloween, Christmas, Easter and Valentine's themes that come out on their days, on the TV, the phone remote and the web pages.
- **Weather** ([weather.md](weather.md)): today's weather on Home with the one thing worth knowing ("Rain from 4pm"), the temperature next to the clock, a forecast page with the next hours and the week, the weather on the screensaver, voice ("what's the weather like") and the phone. Open-Meteo, free and keyless; a town, UK postcode or latitude and longitude.
- **App name**: call it GazosTV or anything else; it shows everywhere, including Spotify's device list.
- **Button hints and help** ([everyday-extras.md](everyday-extras.md)): a strip along the bottom says what the colour keys do on each screen; Info opens a help screen with the remote drawn. On Home the colour keys are shortcuts.
- **Sleep timer**: 15 minutes to 2 hours or the end of the programme, from Options, the phone or voice. "Still watching?" a minute before, then the sound fades, playback stops and the TV goes to standby over CEC.
- **Home Assistant both ways** ([notifications.md](notifications.md#home-assistant-the-other-way-the-tv-as-a-media-player)): the TV as a media player in Home Assistant (what's on, play, pause, stop, channels, volume, standby) and a webhook told when a film starts, pauses, resumes, stops or reaches the credits, the channel changes or the profile switches, so the lights can follow.
- **Alerts**: IPTV or TorBox expiry, the guide not updating, failed recordings, a full NAS, live TV failing and the Hub restarting over and over go to a Home Assistant webhook or ntfy, and to a card on the TV for grown-ups. Set them up and see what the Hub is worried about on the TV, or from a phone at `/setup/`.
- **Save for later**: Red on a title saves it to that profile's list; saves from the phone or by voice ("save Dune for later") go to a household list every profile sees. Shown as a row on Home, as a Saved tab on the phone remote with Play on TV, Add to queue and Remove, and as a Saved list in the Android app. When the guide knows the title is on again in the next fortnight the card says where and when ("On Film4 · Sat 21:00"), and Record and Remind are one press away ([everyday-extras.md](everyday-extras.md#save-for-later)).
- **Advert skip**: comskip in the Hub's image finds the breaks in recordings; playback offers Skip adverts or skips them itself, and the breaks are shaded on the seek bar so you can see where they are. When comskip finds nothing in a recording over 20 minutes, ffmpeg looks for black frames either side of silence instead, and Settings › Recording and the text diagnostics say how many breaks each way found.
- **Seasonal clips** ([everyday-extras.md](everyday-extras.md#seasonal-clips)): a sleigh, a bunny, fireworks, a ghost and more drift across the TV for Christmas, New Year, Valentine's, Easter, Halloween, Bonfire Night and birthdays, drawn by the TV or uploaded from the phone, with a community library in [community/clips](../community/clips/README.md).
- **Projected clips and packs** ([projected-clips.md](projected-clips.md)): built clips (a picture and a sound, placed and walking, hopping, flying, rising or falling) for each occasion, six starter packs (Christmas, Easter, Valentine's, Birthday, Halloween, Fireworks), `.utvpack` packs to share by file, link or QR code, a community pack list, and a loop mode for a window projector. Never on Kids.

## Other screens and games ([casting-and-games.md](casting-and-games.md))

- **AirPlay** from an iPhone, iPad or Mac (UxPlay on the box); Back ends it, and Kids can't be cast to.
- **Laptop screen share** from Chrome, Edge or Firefox at `https://<hub>:8096/cast/`, after the TV asks.
- **Links and photos from a phone**: the phone remote's Cast sheet, also in Android's share menu; YouTube plays through mpv and yt-dlp.
- **Games**: RetroArch, Moonlight, Steam Link, GeForce NOW and Steam open full screen from Cast and games (Blue on Home), and the TV app comes back when they close. Off on Kids unless allowed.

## Running and looking after it

- **Setup page** at `/setup/` for IPTV, Jellyfin, Plex, AIOStreams, TorBox, OMDb, OpenSubtitles and every TV setting.
- **Updates** **(tested)**: the Hub lists what's new on GitHub since the code it runs, and updates with `tools/hub/update.sh` or from the phone (with the helper installed). The box updates weekly at 4 am after a btrfs snapshot, or from Settings › About or the phone. Both show the commit they run.
- **Automatic roll back of a bad box update** **(untested)**: after each update the box checks the app starts, reaches the Hub, plays a test clip and still sees the CEC adapter; if not, it goes back to the snapshot, reboots, skips that commit from then on, and says so on the TV, in HA/ntfy and in Settings › About. Roll back last update by hand in Settings › About or on the phone ([box-install.md](box-install.md#updates-and-rolling-back)).
- **What's new** ([CHANGELOG.md](../CHANGELOG.md)): the change log, served by the Hub at `/api/changelog`, in the TV's Settings › What's new, on the setup page and in the Android app. After an update the TV's Home, the phone remote and the Android app show what changed since they last looked, once for **each profile** (never on Kids profiles and never over playback), in the words the change log keeps for the household; Settings › About puts the last few on one line, and Settings › What's new lists every change (the internal ones too).
- **Desktop app** **(untested on real desktops)** ([desktop.md](desktop.md)): the TV app as an AppImage for any Linux desktop (Fedora, Omarchy, Ubuntu…), in a normal window with video in mpv's own window; it ignores phone commands meant for the TV and updates itself from GitHub. (#118) It works fully with a mouse (point, click, right-click for Back, the wheel, clickable key hints, a player with a seek bar and buttons), and the guide's preview shows live TV as on the box. (#138)
- **Box install** **(tested** over PXE on the GMKtec K7 Plus**)**: one script on Arch (Debian 13 as a fallback), or an unattended network install from the PXE server ([box-install.md](box-install.md), [pxe.md](pxe.md)).
- **Diagnostics** ([diagnostics.md](diagnostics.md)) **(tested)**: the box sends its log, a playback sample every 10 seconds and the screen's details to the Hub; read them at `/api/diagnostics?format=text`, with rolling 50 MB logs. Logins and keys are cut from addresses.
- **A check of the TV and the remote, on the TV** ([diagnostics.md](diagnostics.md#the-self-test)): Settings › About › Self-test plays six short clips — 4K HDR10, HLG, 23.976 and 50 frames a second, surround sound and left/right stereo — and asks whether each looked and sounded right, then asks for every button on the remote and notes the ones that never arrived. Each answer is kept with what the box was actually doing at the time (the screen mode it picked, the picture and sound format, the decoder in use), so "no HDR" can be told apart from "the TV was in the wrong mode"; the last run is on the phone's Stats page and in `/api/diagnostics?format=text`. The clips are made by the box installer, and by the box itself if one is missing, so nothing large is in the repo.
- **Nightly Hub backup** ([backup.md](backup.md)): the database and clips to the NAS at 03:30, the last 14 kept, one before each update; status on the TV and phone, restore from the phone or `tools/hub/restore.sh`, an alert when it fails.
- **A second copy of the backup** ([backup.md](backup.md#a-second-copy-somewhere-else)): `BACKUP_OFFSITE` keeps another copy on a disk or an rclone remote (which can be encrypted), after the NAS one, with its own 7-daily/4-weekly rotation; both destinations are shown in the backup status, a second copy that fails raises its own alert, and a restore can come from either.
- **Box without the Hub** ([backup.md](backup.md#when-the-hub-is-down)): the box's own screen with the time, what's wrong, downloads (Kids-safe), games and AirPlay; back to the TV app when the Hub answers. The box also watches the TV app itself, so a Hub that answers while sending an app that draws nothing gets its own screen up instead of a black one, and tries the app again every few minutes.
- **Trips** ([travel.md](travel.md)): `travel.sh away` runs a Hub on the box with the household's data and music videos; `travel.sh home` sends back what changed and what was recorded.
- **Demo Hub and screenshots**: `DEMO=1` fills a Hub with made-up channels, films and recordings; `npm run screenshots` regenerates [docs/screenshots](screenshots/README.md).
