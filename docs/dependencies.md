# What UltimateTV is built from, and what it can talk to

This is a plain list of what the app is made of and what it contacts, written so a household can
see for itself that nothing is quietly reporting on it. It is checked in, so it can be reviewed
and diffed like any other file.

Read the second half if you only want the answer to "does this send my data anywhere?".

## The Android apps

### Google Play services are gone

The Android apps (the phone remote and the watching client) used to read the TV's pairing code
with Google's barcode scanner, `com.google.android.gms:play-services-code-scanner`. That library
is *unbundled*: it is a thin wrapper that asks Google Play services to do the scanning, so on a
device without Play services — every Amazon Fire TV — it fails, and with it the app. The library
also adds a component, `MlKitInitProvider`, that the system starts with the app, which is why the
Fire TV build crashed at launch rather than when the scanner was used.

**That dependency is gone (#198).** The code is now in `android/scanner`, this project's own
library:

| Library | What it does | Licence |
| --- | --- | --- |
| `androidx.camera:camera-core`, `-camera2`, `-camera-lifecycle`, `-camera-view` 1.5.3 | Camera preview, one frame at a time, on the phone | Apache-2.0 |
| `com.google.zxing:core` 3.5.3 | Turns those pixels into a QR code — the decoder only, no camera, no network | Apache-2.0 |

Both are open source, run entirely on the device, and need no Google account, no Play services
and no network. The camera work is in `android/scanner/src/main/java/tv/ultimate/scanner/`, and
`QrDecodeTest` reads a real QR code from a synthetic frame on a plain JVM, so the decoder is
tested without a phone.

The app still declares these other libraries, all of which are on the device only: AndroidX
(Compose, navigation, lifecycle, core), Media3/ExoPlayer for playback, and the Jellyfin FFmpeg
decoder. None of them is an analytics or advertising SDK — no Firebase, no Crashlytics, no
Google Analytics, no AdMob, no Facebook. `hub/test/dependencies.test.ts` fails if one appears.

### What the apps send

- **To the Hub**, at the address you set, over the LAN: the pairing request, what you are
  watching and how far you got, and (if you turn it on) a crash report. Nothing else.
- **To the wider internet**: nothing, directly. Video that comes from Jellyfin or IPTV is fetched
  from your own server; the phone asks the Hub for the stream and plays it.
- **Crash reports** are written to a file on the phone (`last-crash.txt`) and shown on the next
  start. They are not sent anywhere unless you copy them out.

## The Hub and the TV app

The Hub is a Node program; the TV app is a web page it serves. Their dependencies are:

| Package | What it does | Licence |
| --- | --- | --- |
| `fastify`, `@fastify/static`, `@fastify/websocket` | The HTTP and websocket server | MIT |
| `qrcode` | Draws the pairing square (on the Hub, not over the network) | MIT |
| `sax` | Reads podcast RSS/Atom feeds | ISC |
| `mpegts.js` | Plays MPEG-TS in the TV's browser | Apache-2.0 |
| `solid-js` | The TV app's UI framework | MIT |
| `electron` (box only) | The application window on the box | MIT |

Everything else in `node_modules` is a build or test tool (`typescript`, `vitest`, `esbuild`,
`tsx`, `playwright-core`) and does not ship to the Hub, the TV or the phone.

`hub/test/dependencies.test.ts` pins that list, refuses any package whose name looks like
analytics, tracking or advertising, and checks that only `esbuild` and `fsevents` run code while
installing (the two that do, so npm can build them).

## What the Hub talks to

The Hub is the only part that reaches the internet, and only for the things you have asked it to
do. Each one is a setting you can leave empty or turn off:

| Address | Why | What is sent | When it is off |
| --- | --- | --- | --- |
| `api.themoviedb.org`, `image.tmdb.org` | Film and TV names, descriptions, posters | The title name or id you are looking up | No artwork or synopsis; everything else works |
| `api.omdbapi.com` | A second opinion on ratings and plot | A title and year | Only if you configured it (it needs your own key) |
| `api.open-meteo.com`, `geocoding-api.open-meteo.com`, `api.postcodes.io` | The weather on Home | A postcode or place name | Weather chip disappears |
| `itunes.apple.com` | Podcast search | Your search words | Podcast search finds nothing; feeds you added still work |
| Your podcast feeds, e.g. `media-ice.musicradio.com`, `sounds.files.bbci.co.uk` | The shows you subscribed to | A normal HTTP request for the feed or episode | You choose which feeds |
| `stream.radioparadise.com`, `listen-funkids.sharp-stream.com` and other radio hosts | Internet radio stations | A normal stream request | Radio is silent |
| `api.torbox.app` | Cloud downloads | Your own TorBox API key and the item you asked for | Off unless you set a key |
| `api.opensubtitles.com` | Subtitles | The film's name, and your key if you have one | Off unless you set a key |
| `github.com`, `api.github.com`, `raw.githubusercontent.com` | Hub updates, the Android APK, the desktop installers | Which release the Hub is on | No update check; everything else works |
| `ntfy.sh` (or any URL you set) | A notification to your phone when something goes wrong | One line about the problem | Off unless you set a topic |
| `intro-skipper.org`, Plex at `plex.tv`, Jellyfin at your own address | Optional extras you configured | What you asked it to do | Off unless configured |

There is **no** account, no sign-in, no device fingerprint, no unique id sent to a third party,
and no third-party script in the TV app. The web page loads only its own files; there is no
analytics tag, no font from a content network, no CDN.

## The box

The box runs Electron, which is Chromium plus Node. It loads the TV app from the Hub over the LAN
and nothing else. Its own dependencies are Electron itself and the system's `mpv`.

## What this repository cannot promise

The Hub runs on your own machine and the household's data stays there. If you point the Hub at a
third-party service, that service sees what you send it — that is what it is for. What has been
removed, deliberately, is the class of dependency that reports on a device without being asked to:
there is no crash reporter, no analytics, no advertising library and no Play services anywhere in
this repository.

`hub/test/dependencies.test.ts` is the guard. If a future change adds one of those, CI fails.
