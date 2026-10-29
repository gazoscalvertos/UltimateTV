# Features

Everything UltimateTV does as of 2026-10-29: what's on main (up to PR #56). Almost all of it is untested on the Hisense; [ROADMAP.md](ROADMAP.md) says what has run on real hardware. [CHANGELOG.md](../CHANGELOG.md) has the detail of each change.

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

- One library from Jellyfin (Quick Connect or login), IPTV VOD and series, and AIOStreams/Stremio addons with TorBox. TMDB supplies artwork, discovery rails and metadata. Addon links ending in `/configure` and `stremio://` links work.
- Each title appears once; **Versions** lists every copy (library first) for films and episodes, with source badges (From Jellyfin / IPTV / TorBox).
- Discovery titles only show when an addon can play them.
- Home: a hero, your play queue, live now, continue watching, recently recorded, films on TV tonight, trending and recently added.
- Player: seek bar, skip intro, audio and subtitle tracks (Yellow), resume and Start again, Up Next with a countdown.
- A starting card shows what playback is waiting on and how fast it's arriving, and says when TorBox is still fetching (the box waits up to 5 minutes). A version that fails says so and offers another.
- **Play queue**: line up films, episodes and recordings from the TV or the phone; the queue plays before the next episode and survives restarts.
- **Save to NAS**: TorBox/AIOStreams titles download to the NAS with Jellyfin naming and are announced to Jellyfin. Files dropped in the Inbox share are tidied too. Save from Versions (Red saves that exact version), the player (Options › Keep a copy) or the phone, for films, episodes and whole series ([save-to-nas.md](save-to-nas.md)).
- **Download to box** ([downloads.md](downloads.md)): films, episodes, series and recordings copied onto the box's disk for trips, with a Downloaded tab, a 10 GB free-space floor and automatic clean-up.

## Picture and sound (on the box)

- Refresh rate matched to each title with `kscreen-doctor`, and a custom mode at a whole multiple of 24p for screens with no matching rate (`CUSTOM_MODES=0` turns it off).
- HDR switched on for HDR video so the TV enters its HDR mode; Dolby Vision and HDR10+ play as HDR10.
- Dolby Digital Plus (Atmos) and DTS passed through untouched; the sound output is moved to the TV's HDMI at full volume.
- Output kept at scale ×1 on 4K screens; the UI sizes by height on screens wider than 16:9.
- Playback stats overlay (Blue while playing): frame rate, screen mode and how it was matched, dropped frames, buffer.

## Profiles

- "Who's watching?" profiles with optional PINs; it returns to the picker when the TV turns on.
- A locked-down **Kids** profile: kids' channels only, films and series up to PG, no Settings, Music, scares or downloads it isn't allowed. ([profiles.md](profiles.md))
- Changes to the setup and deletions need an adult profile and its PIN.

## Music

- **Music video channels** ([music-channels.md](music-channels.md)): the Hub makes its own live channels from music videos it downloads with yt-dlp in HD or 4K. Clubland TV (390), House TV (391), Halloween TV (392) and Spooky TV (393) fill themselves; make your own from artists, songs or searches. Each pass is a fresh shuffle, songs aren't duplicated, black bars are cropped, and a caption shows the song and what's next. Videos already on the NAS can be added too. An API is ready for an AI curator.
- **Music tab**: the box is a Spotify Connect speaker ("UltimateTV", via go-librespot; Premium needed) with your playlists, albums, artists and Liked Songs, Now Playing, shuffle, repeat and volume. Deezer's web player opens over the app, driven by the remote, with a phone login. Play/Pause works from any screen and a film pauses the music.

## Phone remote ([phone-remote.md](phone-remote.md))

- Works in any phone browser at `/remote/`, or as a small Android app served by the Hub at `/api/remote/app.apk` (with an update banner). TV Settings › Android apps and the phone's settings show QR codes and links for both apps.
- Pairing by scanning the TV's code; only paired phones can control anything ([pairing.md](pairing.md)).
- Arrows, OK, Back, colour keys, numbers and typing into Search; volume keys change channel in the Android app.
- Now Playing card with progress, skip, live and track buttons; a Watch tab to start anything on the TV (guide, films, TV, recordings, Spotify, search, queue); On the box tab for box downloads.
- Voice: "watch BBC One", "search for Dune", "pause", "down three times".
- Settings page (`/setup/`) covering everything the TV's Settings does, plus updating the Hub and the box, reloading the TV app and refreshing the guide.
- Stats page for the box and the Hub: playback quality, HDMI, CPU, GPU, memory, disks, network, warnings and logs.

## Android app ([android-client.md](android-client.md))

- A separate app for phones and tablets at `/api/client/app.apk`: live TV, catch-up, recordings, films and TV on the home Wi-Fi, asking before it takes the IPTV connection from the TV.
- Downloads films, episodes and recordings to watch anywhere; Jellyfin titles can download a smaller 720p copy.

## On-screen extras

- **Pop-ups** ([notifications.md](notifications.md)): a title, text, picture or video sent from the phone or Home Assistant (`POST /api/notify` with `X-Api-Key`), placed, sized and timed, optionally pausing the film.
- **Breaking news**: a BBC News style bar along the bottom with your own message.
- **Screen dimming and screensavers** ([screensaver.md](screensaver.md)): twelve live scenes, generated landscapes and modern art, NAS photos and videos, black, or shuffle.
- **Halloween** ([halloween.md](halloween.md)): an automatic theme from 25 October to 1 November, three hidden easter eggs, and jump scares (your own clips, or ones built from a picture or video plus a sound), never on Kids.
- **Themes** ([themes.md](themes.md)): Dark, Light, Slick, Cyberpunk, Ocean, Forest and Sunset, plus seasonal Halloween, Christmas, Easter and Valentine's themes that come out on their days, on the TV, the phone remote and the web pages.
- **App name**: call it GazosTV or anything else; it shows everywhere, including Spotify's device list.

## Running and looking after it

- **Setup page** at `/setup/` for IPTV, Jellyfin, AIOStreams, TorBox and every TV setting.
- **Updates**: the Hub lists what's new on GitHub since the code it runs, and updates with `tools/hub/update.sh` or from the phone (with the helper installed). The box updates weekly at 4 am after a btrfs snapshot, or from Settings › About or the phone. Both show the commit they run.
- **Box install**: one script on Arch (Debian 13 as a fallback), or an unattended network install from the PXE server ([box-install.md](box-install.md), [pxe.md](pxe.md)).
- **Diagnostics** ([diagnostics.md](diagnostics.md)): the box sends its log, a playback sample every 10 seconds and the screen's details to the Hub; read them at `/api/diagnostics?format=text`, with rolling 50 MB logs. Logins and keys are cut from addresses.
- **Trips** ([travel.md](travel.md)): `travel.sh away` runs a Hub on the box with the household's data and music videos; `travel.sh home` sends back what changed and what was recorded.
- **Demo Hub and screenshots**: `DEMO=1` fills a Hub with made-up channels, films and recordings; `npm run screenshots` regenerates [docs/screenshots](screenshots/README.md).
