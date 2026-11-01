# The Android app (phones and tablets)

**UltimateTV for Android** watches everything the TV does, on a phone or tablet on the home Wi-Fi: live TV and the guide, catch-up, recordings, films and TV from Jellyfin, TorBox and IPTV, and the music video channels. It also downloads films, episodes and recordings to watch away from home. It's a separate app from the [phone remote](phone-remote.md), and both can be installed.

## Installing

1. On the phone, open `http://192.168.0.19:8095/api/client/app.apk` in Chrome. The Hub fetches the latest build from GitHub. It's also in the latest CI run's `ultimatetv-client-apk` artifact.
2. Open the downloaded file and allow installing from Chrome the first time.
3. Open **UltimateTV** and choose who's watching. Profiles with a PIN ask for it, and a Kids profile only sees what it sees on the TV.

The app looks for the Hub at `http://192.168.0.19:8095`. Change it in Settings if the Hub moves. Settings › Check for updates offers a newer build when the Hub has one, and it installs over the top (same signing key).

## Watching

- **Home, Films & TV, Search** work as on the TV. A title page lists every version the sources have (4K remux, 1080p, IPTV…) under **Other versions** or an episode's **Versions**. Pick one to play it, or (adult profiles) **Save to NAS + Jellyfin** to keep that version in the house's Jellyfin library for good ([save-to-nas.md](save-to-nas.md)). That's not the same as downloading it to the phone.
- **TV Guide** shows what's on now and next for each channel list. The calendar button opens a channel's day: earlier programmes can be watched from the start when the provider keeps catch-up, and later ones can be recorded or series-linked.
- The **player** is ExoPlayer: it plays the Hub's live TV, MKV and HEVC files directly, and an FFmpeg decoder covers Dolby Digital, Dolby Digital Plus, DTS and TrueHD sound. It has subtitles and audio tracks (the gear button), Skip intro, Next episode and picture-in-picture when you leave the app.
- **On the TV** (the TV button) starts the same thing on the TV instead.

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
