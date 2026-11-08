# Dimming and the screensaver

When the TV is left on with nothing playing, the screen dims, and later a screensaver starts.
The first button pressed afterwards (on the TV remote, the phone remote or a keyboard) only
wakes the screen; it doesn't also do whatever that button normally does.

Set it up on the TV in **Settings › Screensaver**, or on the phone's settings page under
**Screensaver**. The settings are kept on the Hub, so both show the same thing, and a change on
the phone reaches the TV straight away.

| Setting | What it does | Default |
|---|---|---|
| Dim the screen | Minutes with no button pressed before the picture dims (or Never) | 10 min |
| How dark | 50%, 70% or 85% darker | 70% |
| Screensaver | Which one (below), or None to only dim | Shuffle |
| Start the screensaver | Minutes with no button pressed before it starts (or Never) | 20 min |
| Your photos | The NAS folder for the Your photos screensaver | not set |
| Each picture for | How long each photo, landscape or piece of art stays up | 20 s |
| Show the clock | A clock and the date, moving corner each minute, with the song if music is playing | On |

More options, for every screensaver: **Clock size**, **12-hour clock**, **Show the date**,
**Fade between pictures** (1 to 8 seconds), **Slow drift on pictures** and **At night**. At night
the screensaver carries on, gets a good deal dimmer, or goes black between the hours you set
(default 22:00 to 07:00).

**Try it now** in the TV's settings starts the chosen screensaver straight away.

## What keeps the screen awake

- Video playing, starting or buffering: live TV, the guide's preview, films, recordings, music
  channels. **Paused video counts as nothing playing**, so a film left paused dims too.
- A music web player (Deezer) open on screen.
- Pop-ups and news flashes from the Hub, and recording reminders, wake the screen so they're seen.
- Spotify playing in the background doesn't keep the screen bright, but its song shows under the
  screensaver's clock.

## The screensavers

Moving ones are drawn live by the TV app, like a looping video that never repeats exactly, at any
resolution and with nothing to download:

Northern lights, Fireplace, Aquarium, Deep space, Snowy night, Rainy window, Sunset sea, Lava lamp,
Fireworks, Halloween, Christmas and Bouncing logo (the app's name, like an old DVD player).

Pictures are made fresh each time and pan slowly, cross-fading from one to the next:

- **Landscapes**: mountains, lakes, dunes, hills and coasts at dawn, midday, golden hour, dusk and night.
- **Modern art**: Bauhaus tiles, soft colour fields, layered paper waves and rainbow rings.

**Shuffle** changes screensaver every 10 minutes. Halloween only joins it in October and
Christmas in December (both can be picked by hand any time). Your photos join it once a folder is set.

**Black screen** turns the picture black until a button is pressed.

## Your photos

Choose a folder on the NAS (the shares the Hub can see, such as `/mnt/nas`): on the TV with
Settings › Screensaver › Your photos, which browses the folders, or on the phone with Browse the
NAS or by typing the path. Every photo in it and in the folders inside it is shown in a random
order (up to 5,000).

- Photos: JPEG, PNG, WebP, GIF, AVIF and BMP. Portrait photos sit on a blurred copy of themselves.
- Videos: MP4, MOV, M4V and WebM play silently to the end (up to 90 seconds) before moving on.
  Other video files are skipped. Phone videos in HEVC play if the box's browser can decode them.
- HEIC photos (iPhone's default) aren't shown; export them as JPEG.

The Hub looks at the folder again every 10 minutes, so new photos turn up without doing anything.
If the folder is empty or has gone, the screensaver shows Landscapes instead.

## Art gallery

Famous paintings full screen, like pictures on a wall: pick **Art gallery** (or Shuffle, which
includes it once paintings are saved) in Settings › Screensaver.

| Setting | What it does | Default |
|---|---|---|
| Each painting for | 30 seconds up to 1 hour | 5 min |
| Order | Shuffled, or by artist | Shuffled |
| Paintings | Collections: Masterpieces, Impressionism, Post-Impressionism, Landscapes, Seascapes, Romantic skies, Dutch Golden Age, Flowers and still life, Animals, Japan, Portraits, Winter scenes. None ticked means all | All |
| Kids-friendly only | Only collections made for children, and titles with nudes, battles, deaths and the like are left out. Always on in a Kids profile | Off |
| Show title and artist | A museum card (title, artist, year, museum) that fades away after a while | On |
| Frame | None, Matte or Gold | Matte |
| Brightness | 50 to 100% | 90% |
| Clock over paintings | A clock on top; off, as a picture on a wall has none | Off |
| Paintings kept | How many the Hub keeps ready | 150 |

### Where the paintings come from

All three are museums' own open-access programmes, with free public APIs and no key. Only works
the museum marks as public domain / CC0 are taken, and only paintings.

| Museum | How | Picture size |
|---|---|---|
| Art Institute of Chicago | `api.artic.edu` search, IIIF images | Asked at 3840×2160 to fit; IIIF never enlarges |
| The Metropolitan Museum of Art | Collection API, Open Access (CC0) | Original files (often very large); shrunk to fit 4K by ffmpeg when over 6 MB |
| Cleveland Museum of Art | Open Access API, CC0 | The "print" JPEG, about 3400 px |

The Rijksmuseum, the National Gallery of Art and Wikimedia Commons are good sources too, and could be
added: they need more work (the Rijksmuseum's new linked-data API, the NGA's data dump, Commons'
mixed licences).

### How it works

The Hub fetches paintings in the background, a few at a time and gently, when Art gallery or
Shuffle is chosen, again each day, and straight away when you change the collections. Each is saved
as a JPEG in `data/art/` with its details in `index.json`, so the TV loads from the Hub and
paintings still show if the internet is down. Over the "Paintings kept" number, ones outside the
chosen collections go first, then the oldest. **Get paintings now** fetches more, **Remove saved
paintings** clears them. With none saved yet, the screensaver shows Landscapes instead.

The same settings are on the phone's setup page under Screensaver.
