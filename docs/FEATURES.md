# Features

Everything UltimateTV does as of 2026-10-30: what's on main (up to PR #61). Nothing has run on the Hisense yet. Items marked **(tested)** have run on the real box, Hub or phone; everything else is built and passes its tests against the demo Hub but is untested on the hardware. [ROADMAP.md](ROADMAP.md#tested-or-untested-feature-by-feature) has the full table. [CHANGELOG.md](../CHANGELOG.md) has the detail of each change.

## Live TV and the guide

- IPTV from M3U playlists or Xtream Codes logins, with XMLTV guides; several sources and several feeds per channel, merged into one channel list with names cleaned up and quality badges (4K / FHD / HD).
- Sky-style TV guide: live TV keeps playing in the corner, the highlighted programme's details beside it, a channel/time grid, digits jump to a channel. Channel names show next to their logos.
- Channel lists above the grid: all channels, favourites, categories, and **custom guides** built by hand with your own choice and order (TV Guide › New guide). Any list can be a profile's default, and channel up/down stays within it. ([profiles.md](profiles.md#custom-guides))
- The phone's settings page arranges the guide's lists, builds and reorders custom guides, and renumbers, recategorises, stars or hides any channel.
- Live player with the now-and-next banner, browsing other channels with up/down without changing, number tuning and channel up/down.
- Pause and rewind live TV (mpv keeps up to a gigabyte behind the live point).
- Catch-up and "watch from the start" on channels that offer it.
- Reminders on programmes.
- Live TV switches the screen's refresh rate once mpv reads the stream's frame rate.
- Search finds channels with or without spaces ("bbcone"), what's on this week, recordings, films and series, with an on-screen keyboard or typing from the phone.

## Recording and series link

- Record a single programme or a whole series from the guide (Red). Recordings land on the NAS with ffmpeg stream copy and show up in Jellyfin.
- Series links schedule new episodes as the guide refreshes; each has a Cancel button.
- The one IPTV connection is shared: watching and recording the same channel uses one stream, and clashes warn and offer what to drop.
- Recordings screen: recorded (grouped by series), coming up, series links, clashes and NAS downloads.

## Films and TV

- One library from Jellyfin (Quick Connect or login; Jellyfin playback on the box is **tested**), IPTV VOD and series, and AIOStreams/Stremio addons with TorBox. TMDB supplies artwork, discovery rails and metadata. Addon links ending in `/configure` and `stremio://` links work.
- Each title appears once; **Versions** lists every copy (library first) for films and episodes, with source badges (From Jellyfin / IPTV / TorBox).
- Discovery titles only show when an addon can play them.
- Home: a hero, your play queue, live now, continue watching, recently recorded, films on TV tonight, trending and recently added.
- Player: seek bar, skip intro, audio and subtitle tracks (Yellow), resume and Start again, Up Next with a countdown.
- **Skip intro everywhere** ([watching-extras.md](watching-extras.md#skip-intro-everywhere)): Jellyfin's Intro Skipper plugin marks intros, recaps and credits across the library (`tools/jellyfin/intro-skipper.mjs` installs and checks it); marked credits bring Up Next in 15 seconds after they start.
- **Accessibility** ([accessibility.md](accessibility.md)): per profile, the audio description track when there is one, text at 125% or 150%, a bold yellow focus ring and reduced motion (no sliding screens, projected clips, jump scares or moving screensavers). Also on the phone's setup page.
- **Trailers and review scores** ([watching-extras.md](watching-extras.md)): a Trailer button (TMDB's official trailer, played by mpv through yt-dlp) and TMDB, IMDb, Rotten Tomatoes and Metacritic scores (OMDb key) on every film and series page.
- **More like this** under each title and a **Because you watched** rail on Home, from TMDB's recommendations, kept to what a source can play and what the profile may see.
- **Subtitles** ([watching-extras.md](watching-extras.md)): on, off or only for other languages per profile; missing ones fetched from OpenSubtitles by themselves or picked from Options › Find more online; size, a dark box, yellow and a raised position for an 85" screen.
- **TV apps** ([watching-extras.md](watching-extras.md)): a button along the top (and on the phone's Cast sheet) hands the screen to the Hisense's own Home over HDMI-CEC for Netflix, Prime Video and Disney+; Input on the TV remote comes back.
- A starting card shows what playback is waiting on and how fast it's arriving, and says when TorBox is still fetching (the box waits up to 5 minutes). A version that fails says so and offers another.
- **Play queue**: line up films, episodes and recordings from the TV or the phone; the queue plays before the next episode and survives restarts.
- **Save to NAS**: TorBox/AIOStreams titles download to the NAS with Jellyfin naming and are announced to Jellyfin. Files dropped in the Inbox share are tidied too. Save from Versions (Red saves that exact version), the player (Options › Keep a copy) or the phone, for films, episodes and whole series ([save-to-nas.md](save-to-nas.md)).
- **Download to box** ([downloads.md](downloads.md)): films, episodes, series and recordings copied onto the box's disk for trips, with a Downloaded tab, a 10 GB free-space floor and automatic clean-up.

## Picture and sound (on the box)

- **(tested** on the Huawei monitor, smooth 24p at 71.928 Hz**)** Refresh rate matched to each title with `kscreen-doctor`, and a custom mode at a whole multiple of 24p for screens with no matching rate (`CUSTOM_MODES=0` turns it off).
- HDR switched on for HDR video so the TV enters its HDR mode; Dolby Vision and HDR10+ play as HDR10.
- Dolby Digital Plus (Atmos) and DTS passed through untouched; the sound output is moved to the TV's HDMI at full volume.
- Output kept at scale ×1 on 4K screens; the UI sizes by height on screens wider than 16:9.
- Playback stats overlay (Blue while playing): frame rate, screen mode and how it was matched, dropped frames, buffer.

## Profiles

- "Who's watching?" profiles with optional PINs; it returns to the picker when the TV turns on.
- A locked-down **Kids** profile: kids' channels only, films and series up to PG, no Settings, Music, scares or downloads it isn't allowed. ([profiles.md](profiles.md))
- Changes to the setup and deletions need an adult profile and its PIN.

## Music

- **Music video channels** ([music-channels.md](music-channels.md)): the Hub makes its own live channels from music videos it downloads with yt-dlp in HD or 4K (the downloads are **tested** on the Hub). Clubland TV (390), House TV (391), Halloween TV (392) and Spooky TV (393) fill themselves; make your own from artists, songs or searches. Each pass is a fresh shuffle, songs aren't duplicated, black bars are cropped, and a caption shows the song and what's next. Videos already on the NAS can be added too. An API is ready for an AI curator.
- **Music tab**: the box is a Spotify Connect speaker ("UltimateTV", via go-librespot; Premium needed) with your playlists, albums, artists and Liked Songs, Now Playing, shuffle, repeat and volume. Deezer's web player opens over the app, driven by the remote, with a phone login. Play/Pause works from any screen and a film pauses the music.

## Phone remote ([phone-remote.md](phone-remote.md))

- **(tested, in daily use)** Works in any phone browser at `/remote/`, or as a small Android app served by the Hub at `/api/remote/app.apk` (with an update banner). TV Settings › Android apps and the phone's settings show QR codes and links for both apps.
- Pairing by scanning the TV's code; only paired phones can control anything ([pairing.md](pairing.md)).
- Arrows, OK, Back, colour keys, numbers and typing into Search; volume keys change channel in the Android app.
- **(untested)** Portrait or landscape: sideways it puts the d-pad in the middle, keys either side and the tabs down the edge.
- Now Playing card with progress, skip, live and track buttons; a Watch tab to start anything on the TV (guide, films, TV, recordings, Spotify, search, queue); On the box tab for box downloads.
- Voice: "watch BBC One", "search for Dune", "pause", "down three times".
- Settings page (`/setup/`) covering everything the TV's Settings does, plus updating the Hub and the box, reloading the TV app and refreshing the guide.
- Stats page for the box and the Hub: playback quality, HDMI, CPU, GPU, memory, disks, network, warnings and logs.

## Android app ([android-client.md](android-client.md))

- **(tested:** runs on Gary's phone**)** A separate app for phones and tablets at `/api/client/app.apk`: live TV, catch-up, recordings, films and TV on the home Wi-Fi, asking before it takes the IPTV connection from the TV.
- Downloads films, episodes and recordings to watch anywhere; Jellyfin titles can download a smaller 720p copy.

## On-screen extras

- **Pop-ups** ([notifications.md](notifications.md)): a title, text, picture or video sent from the phone or Home Assistant (`POST /api/notify` with `X-Api-Key`), placed, sized and timed, optionally pausing the film.
- **Breaking news**: a BBC News style bar along the bottom with your own message.
- **Screen dimming and screensavers** ([screensaver.md](screensaver.md)): twelve live scenes, generated landscapes and modern art, NAS photos and videos, black, or shuffle.
- **Halloween** ([halloween.md](halloween.md)): an automatic theme from 25 October to 1 November, three hidden easter eggs, and jump scares (your own clips, or ones built from a picture or video plus a sound), never on Kids.
- **Themes** ([themes.md](themes.md)): Dark, Light, Slick, Cyberpunk, Ocean, Forest and Sunset, plus seasonal Halloween, Christmas, Easter and Valentine's themes that come out on their days, on the TV, the phone remote and the web pages.
- **Weather** ([weather.md](weather.md)): today's weather on Home with the one thing worth knowing ("Rain from 4pm"), the temperature next to the clock, a forecast page with the next hours and the week, the weather on the screensaver, voice ("what's the weather like") and the phone. Open-Meteo, free and keyless; a town, UK postcode or latitude and longitude.
- **App name**: call it GazosTV or anything else; it shows everywhere, including Spotify's device list.
- **Button hints and help** ([everyday-extras.md](everyday-extras.md)): a strip along the bottom says what the colour keys do on each screen; Info opens a help screen with the remote drawn. On Home the colour keys are shortcuts.
- **Sleep timer**: 15 minutes to 2 hours or the end of the programme, from Options, the phone or voice. "Still watching?" a minute before, then the sound fades, playback stops and the TV goes to standby over CEC.
- **Alerts**: IPTV or TorBox expiry, the guide not updating, failed recordings, a full NAS and live TV failing go to a Home Assistant webhook or ntfy, and to a card on the TV for grown-ups.
- **Save for later**: Red on a title saves it to that profile's list; saves from the phone or by voice ("save Dune for later") go to a household list every profile sees. Shown as a row on Home.
- **Advert skip**: comskip in the Hub's image finds the breaks in recordings; playback offers Skip adverts or skips them itself.
- **Seasonal clips** ([everyday-extras.md](everyday-extras.md#seasonal-clips)): a sleigh, a bunny, fireworks, a ghost and more drift across the TV for Christmas, New Year, Valentine's, Easter, Halloween, Bonfire Night and birthdays, drawn by the TV or uploaded from the phone, with a community library in [community/clips](../community/clips/README.md).
- **Projected clips and packs** ([projected-clips.md](projected-clips.md)): built clips (a picture and a sound, placed and walking, hopping, flying, rising or falling) for each occasion, six starter packs (Christmas, Easter, Valentine's, Birthday, Halloween, Fireworks), `.utvpack` packs to share by file, link or QR code, a community pack list, and a loop mode for a window projector. Never on Kids.

## Other screens and games ([casting-and-games.md](casting-and-games.md))

- **AirPlay** from an iPhone, iPad or Mac (UxPlay on the box); Back ends it, and Kids can't be cast to.
- **Laptop screen share** from Chrome, Edge or Firefox at `https://<hub>:8096/cast/`, after the TV asks.
- **Links and photos from a phone**: the phone remote's Cast sheet, also in Android's share menu; YouTube plays through mpv and yt-dlp.
- **Games**: RetroArch, Moonlight, Steam Link, GeForce NOW and Steam open full screen from Cast and games (Blue on Home), and the TV app comes back when they close. Off on Kids unless allowed.

## Running and looking after it

- **Setup page** at `/setup/` for IPTV, Jellyfin, AIOStreams, TorBox, OMDb, OpenSubtitles and every TV setting.
- **Updates** **(tested)**: the Hub lists what's new on GitHub since the code it runs, and updates with `tools/hub/update.sh` or from the phone (with the helper installed). The box updates weekly at 4 am after a btrfs snapshot, or from Settings › About or the phone. Both show the commit they run.
- **What's new** ([CHANGELOG.md](../CHANGELOG.md)): the change log, served by the Hub at `/api/changelog`, in the TV's Settings › What's new, on the setup page and in the Android app. After an update the TV's Home, the phone remote and the Android app show what changed since they last looked, once (not on Kids profiles).
- **Box install** **(tested** over PXE on the GMKtec K7 Plus**)**: one script on Arch (Debian 13 as a fallback), or an unattended network install from the PXE server ([box-install.md](box-install.md), [pxe.md](pxe.md)).
- **Diagnostics** ([diagnostics.md](diagnostics.md)) **(tested)**: the box sends its log, a playback sample every 10 seconds and the screen's details to the Hub; read them at `/api/diagnostics?format=text`, with rolling 50 MB logs. Logins and keys are cut from addresses.
- **Nightly Hub backup** ([backup.md](backup.md)): the database and clips to the NAS at 03:30, the last 14 kept, one before each update; status on the TV and phone, restore from the phone or `tools/hub/restore.sh`, an alert when it fails.
- **Box without the Hub** ([backup.md](backup.md#when-the-hub-is-down)): the box's own screen with the time, what's wrong, downloads (Kids-safe), games and AirPlay; back to the TV app when the Hub answers.
- **Trips** ([travel.md](travel.md)): `travel.sh away` runs a Hub on the box with the household's data and music videos; `travel.sh home` sends back what changed and what was recorded.
- **Demo Hub and screenshots**: `DEMO=1` fills a Hub with made-up channels, films and recordings; `npm run screenshots` regenerates [docs/screenshots](screenshots/README.md).
