# Saving to the NAS and Jellyfin

**Save to NAS** keeps a TorBox, online (AIOStreams) or IPTV copy of a film or episode for good. The Hub downloads it into the Films or TV folder with Jellyfin's naming (`Movies/Heat (1995)/Heat (1995).mkv`, `TV/Slow Horses (2022)/Season 01/Slow Horses - S01E02 - Title.mkv`), then tells Jellyfin about the new file, so it's in the library without waiting for a scan. From then on it plays from Jellyfin. It's different from **Download to box**, which copies something onto the TV box for a while (see [downloads.md](downloads.md)).

## Saving

| Where | How |
|---|---|
| A film's page | **Save to NAS** (hidden once it's in Jellyfin) |
| A series' page | **Save to NAS**, then the episode you're on or the whole series you're looking at |
| Versions (Yellow) | Move onto a version and press **Red** to save that exact one |
| While it plays | Yellow (or Down) for Options, then **Keep a copy › Save to NAS and Jellyfin**: it saves the copy that's playing |
| The phone remote | **Save to NAS** on a film, **Save this series to the NAS**, 💾 beside an episode, or **Save** on the Now Playing card |

Pressing Save twice keeps one copy. The TV says when each one is saved and whether Jellyfin has it; Recordings › Downloads shows how far each one has got. Torrents that TorBox hasn't fetched yet wait for TorBox first.

Kids profiles can't save, and the Hub refuses Save from them too. With a PIN on an adult profile, the Hub asks for it as for any other change.

## How Jellyfin hears about it

The Hub uses Jellyfin's API with the account it signed in with (Settings › Jellyfin):

1. `GET /Library/VirtualFolders` lists the folders Jellyfin's libraries watch. If the saved file isn't inside any of them, the Hub doesn't pretend: the TV says where Jellyfin looks instead.
2. `POST /Library/Media/Updated` tells Jellyfin about the one new file, so it's added in seconds.
3. If that fails, `POST /Library/Refresh` scans every library.

Both need the Jellyfin account to be an administrator. Without one the file is still saved and Jellyfin picks it up on its own scheduled scan.

The Hub must see each library at the same path Jellyfin does (see `docker-compose.override.example.yml`). The Films and TV folders default to `/mnt/nas/Movies` and `/mnt/nas/TV`; set `MOVIES_PATH` and `TV_PATH` in the Hub's `.env` if Jellyfin's libraries live elsewhere.
