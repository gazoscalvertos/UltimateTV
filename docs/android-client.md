# The Android app (phones and tablets)

**UltimateTV for Android** watches everything the TV does, on a phone or tablet on the home Wi-Fi: live TV and the guide, catch-up, recordings, films and TV from Jellyfin, TorBox and IPTV, and the music video channels. It also downloads films, episodes and recordings to watch away from home. It's a separate app from the [phone remote](phone-remote.md), and both can be installed.

## The look: the same as the TV

The app is drawn like the TV app, and wears the same theme (Dark, Ocean, Halloween, … and the
seasonal ones; [themes](themes.md)). The Hub sends today's palette (`GET /api/theme`) each time the
app comes to the front, and the last one is kept for away from home.

- **Fire TV and other TVs, and tablets:** the TV app's top bar: the app's name, pill tabs (Home, TV
  Guide, Films, TV Shows, Recordings, Downloads, Search, Settings), the clock and who's watching.
  There is no side rail. Under the remote a tab, button or chip turns solid and lifts a little; a
  poster gets a white ring and lifts. A TV is drawn on a fixed 120 × 67.5 rem canvas like the TV
  app's own screens (1 rem is 10 dp in the code), so it looks the same on a 720p stick and a 4K one.
  Rails, titles and gutters use the same sizes as `ui/src/styles.css`.
- **Vertical (portrait):** the whole app, the player included, turns with the phone or tablet (it follows the rotation lock). A tablet held upright keeps the top bar, whose tabs scroll sideways if they do not fit.
- **Phones:** a slim bar with the name, Search, Settings and who's watching, and the tabs along the
  bottom (Films and TV shows share one tab, with a chip to choose). Same colours, cards and rails.

Everything else (Settings, Downloads, the lists) takes its colours from the theme too, so a change of
theme on the TV or the phone remote reaches the app.

## Installing

1. On the phone, open `http://192.168.0.19:8095/api/client/app.apk` in Chrome. The Hub fetches the latest build from GitHub. It's also in the latest CI run's `ultimatetv-client-apk` artifact.
2. Open the downloaded file and allow installing from Chrome the first time.
3. Open **UltimateTV** and choose who's watching. Profiles with a PIN ask for it, and a Kids profile only sees what it sees on the TV.

**On a Fire TV:** this page is for phones and tablets. A Fire TV stick or Fire TV takes a separate build with no Google Play services in it, installed a different way ([firetv.md](firetv.md)).

The app looks for the Hub at `http://192.168.0.19:8095`. Change it in Settings if the Hub moves. Settings › Check for updates offers a newer build when the Hub has one, and it installs over the top.

**0.6.0 is a one-time uninstall.** Every build is signed with the household's own key, kept in the repository's secrets ([android-signing.md](android-signing.md)); 0.5.0 and older were signed with a key that used to be committed, and Android refuses to install over a different one. Check for updates explains it before it downloads: uninstall the old app, install the new one, then pick your profile and pair again. Downloads saved on the phone are kept.

## Watching

- **Home, Films & TV, Search** work as on the TV. A title page lists every version the sources have (4K remux, 1080p, IPTV…) under **Other versions** or an episode's **Versions**. Pick one to play it, or (adult profiles) **Save to NAS + Jellyfin** to keep that version in the house's Jellyfin library for good ([save-to-nas.md](save-to-nas.md)). That's not the same as downloading it to the phone.
- **TV Guide** shows what's on now and next for each channel list. The calendar button opens a channel's day: earlier programmes can be watched from the start when the provider keeps catch-up, and later ones can be recorded or series-linked.
- The **player** is ExoPlayer: it plays the Hub's live TV, MKV and HEVC files directly, and an FFmpeg decoder covers Dolby Digital, Dolby Digital Plus, DTS and TrueHD sound. It has subtitles and audio tracks (the gear button), Skip intro, Next episode and picture-in-picture when you leave the app.
- **On the TV** (the TV button) starts the same thing on the TV instead.
- **Favourites**: the heart on a title's page, and beside each channel in the TV Guide, stars it for the profile the app is on. Films & TV has **Everything / Favourites** chips; the guide's Favourites list and Home's Favourites row are that profile's ([profiles.md](profiles.md#favourites)).
- **Save to NAS** is on a title's page for films the sources have a TorBox or addon copy of, and on a title's **Versions** list for that exact copy, with how far each save has got underneath ("S1 E2 · 42%", then "Saved, and in Jellyfin"). Grown-ups only.

### Saved for later and the queue

Both lists are the household's, kept on the Hub, so the TV shows the same things within a moment.

- **Save for later** on a film's or show's page keeps it for another evening. It shows on Home under **Saved for later** on the TV, and the phone remote's Saved tab; a title that's on the channels in the next fortnight says where and when ("On Film4 · Sat 21:00") and has a record button beside it ([everyday-extras.md](everyday-extras.md#save-for-later)).
- **Add to queue** puts a film on the end of the play queue, or an episode of a show: the button says which one ("Queue S2 E4"), and the episode that plays next is the one that goes on. The queue plays on the TV, one after another, and survives restarts ([FEATURES.md](FEATURES.md#films-and-tv)).
- **Saved** and **Queue** are two buttons at the top of Home: Saved lists what's kept for later with play, add to queue and remove on each row, and Queue lists what's lined up in order with play here, play on the TV, move up, take off and **Clear the queue**.
- Kids profiles see only what a Kids profile may watch: the Hub leaves the rest out of both lists, and the Hub itself refuses Save to NAS for Kids.

### Watching elsewhere and Sync play

Home › **Elsewhere** lists what the TVs and the other phones and tablets are playing: **Resume
here** and **Move here** (which stops it there) carry on from the same place, **Sync play** plays
it here in step with them, and **On the TV** puts another phone's film on the TV. In the player, the
TV-and-phone button at the top right moves what's playing to the TV, or Sync plays it with the TV.
Needs the phone paired with the TV. See [watching-elsewhere.md](watching-elsewhere.md).

### One IPTV connection

The IPTV plan allows one stream at a time, shared by the TV, the phone and recordings. Watching the same channel as the TV shares its stream. Anything else would take the connection from the TV, so the app asks first ("Your IPTV connection is in use on the TV"). Jellyfin, TorBox and recordings don't use the IPTV connection.

## Downloads

Tap **Download** on a film, the download button on an episode (or **Download all** for a season), or **⋮ › Download to this phone** on a recording.

- Downloads wait for Wi-Fi unless you turn off **Settings › Only on Wi-Fi**. They carry on with the app closed (there's a notification), and pick up where they stopped after a dropped connection or a restart.
- **Smaller copy:** for Jellyfin titles, the download sheet can ask Jellyfin for a 720p copy (about 1.4 GB an hour) instead of the original file, which can be 20–60 GB for a 4K film. Jellyfin makes it as the download runs, so it takes about as long as the film for a big file. For other sources, pick a smaller version in the list.
- **IPTV films and catch-up** download through the IPTV connection, so they wait while anyone is watching TV.
- Live TV can't be downloaded: record it, then download the recording.
- The **Downloads** tab is the one that works away from home. Where you got to is kept on the phone and sent to the Hub (and Jellyfin) the next time the phone is home, so the TV carries on from there.

## Features on this phone

Settings › Features on this phone switches Live TV, Films, TV shows, Recordings, Downloads or Search off on this phone only (the phone has to be paired with the TV). The Hub's settings page can set it too. See [features-per-screen.md](features-per-screen.md).

## Away from home

The Hub is only reachable on the home network, so away from home only downloads play. Streaming away from home would need a VPN such as Tailscale on the Docker LXC; that isn't set up.

## Building

`cd android && gradle :client:assembleDebug` (needs the Android SDK). The code is in `android/client`: Kotlin, Jetpack Compose and Media3.

| File | What it does |
|------|--------------|
| `Hub.kt` | The Hub's API, with the `X-Profile` and `X-Device` headers, and `X-Device-Token` once paired with the TV (Settings › Pair with the TV, needed for Play on the TV; see [pairing.md](pairing.md)) |
| `Offline.kt`, `DownloadsService.kt` | Downloads (Media3), saved artwork and subtitles, offline progress |
| `PlayerActivity.kt` | The player |
| `ui/` | The screens |
