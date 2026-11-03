# Plex instead of Jellyfin

The Hub can use **Plex** for its own library instead of Jellyfin. It does the same job: Home's
Continue watching, Next up and Recently added rails, search, Details pages, playback direct from
the file with mpv, progress back to the server, Mark as watched, and a rescan after a save or a
recording.

**One media server at a time.** There is a single slot: connecting Plex disconnects Jellyfin, and
vice versa. Both are chosen in Settings › Plex (or the setup page's **Plex instead** box).

## Connecting

A Plex token is a per-account key; the Hub needs one with access to the server's libraries.

**URL and token** (the simpler way, and the fallback when discovery can't reach the server):

1. In Plex, open a film or episode › ⋯ › **Get Info** › **View XML**. The URL contains
   `X-Plex-Token=…`; that is the token. The address it was loaded from (`http://192.168.0.23:32400`)
   is the server URL.
2. Settings › Plex: the server's address and the token, then **Connect**. The Hub fetches the
   server's name, so a wrong token or a wrong address says so there and then.

**PIN**: Settings › Plex › **Sign in with Plex** shows a four-character code and a link to
`app.plex.tv/auth`. Approve it in a browser and the Hub picks up the token within a few seconds.
The PIN signs the Hub in but does not say *which* server: either fill the address in first, or pick
one from the list the Hub asks `plex.tv` for (the household's servers, local addresses first). With
no address the Hub says so rather than guessing.

The token is kept on the Hub like Jellyfin's, and never leaves it: the TV and phones only see the
server's name.

## What works

| | Notes |
|---|---|
| Home rails | Continue watching is Plex's **On Deck**. Recently added is its recently added films |
| Search and browse | Every film or show library, with the Kids profile's certificate limit applied by the Hub (Plex has no query for it) |
| Next up | **Derived**, because Plex has no equivalent list: for each show in On Deck the Hub reads all its episodes and takes the first unwatched one after the last watched |
| Details | The poster, backdrop, logo, overview, cast, certificate, runtime and provider ids (TMDB/IMDb/TVDB) from Plex's metadata |
| Playback | Direct: the original file, streamed to mpv, at full quality. No transcoding |
| Progress both ways | Plex's `viewOffset` becomes the resume point, and the Hub reports back through Plex's timeline endpoint |
| Mark as watched | Continue watching's **Mark as watched** scrobbles the title in Plex (and **Remove** doesn't touch it) |
| Skip markers | Plex's intro and credits markers, so Skip intro and Up Next after the credits work as they do with Jellyfin |
| External subtitles | Every `.srt`/`.ass` sidecar stream Plex lists as external; subtitles inside the file are mpv's own business |
| Library rescan | After a save or a recording, the Hub asks Plex to scan its sections |
| Kids profiles | Certificate limits and the profile's own picks, applied on the Hub |

Provider ids are what let one title be one card: a Plex film with a TMDB id is the same film as
the TMDB trending entry, so its Plex version appears in **Versions** rather than as a second card.

## What does not work

- **The "smaller copy" 720p path.** Plex's transcoder (`/video/:/transcode/universal/start.m3u8`)
  is fiddly enough that the Hub doesn't implement it. Asking for a smaller copy of a Plex title
  plays the original file instead — on the phone and in the Android app's downloads too. Nothing
  breaks; it is just a bigger file.
- **Per-file library refresh.** Jellyfin can be told "this one file is new". Plex cannot: the Hub
  asks Plex to rescan its sections, which reads whole folders again, and says so ("Plex picks new
  files up in its next scan"). Large libraries may take a while to show a new save.
- **Progress while the server is away.** Jellyfin places are queued and sent when it answers again
  (#80). Plex's are not queued: the Hub's own Continue watching still holds the place, so a film
  resumes from this Hub, but Plex's own resume row is only updated while it can be reached.
- **Plex's own users.** The Hub signs in as the server's owner (the token's account); it doesn't
  map Plex home users or their watched state to the Hub's profiles.
- **Music and photos.** Plex's music and photo libraries are ignored, as Jellyfin's are: the Hub's
  libraries are films and TV.

## Setup page

`/setup/` has the same Plex box: server address and token, **Sign in with Plex** for the PIN, and
**Disconnect**. It writes the same settings as the TV, and the TV picks the change up without a
restart.
