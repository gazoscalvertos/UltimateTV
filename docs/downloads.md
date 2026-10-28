# Downloading to the TV box

Films, episodes and recordings can be copied onto the TV box's own disk for a while. They then play from the box with the NAS and Jellyfin out of reach (on a trip, see [travel.md](travel.md)), and at home they start straight away.

## Downloading

| Where | How |
|---|---|
| A film on the TV | **Download to box** on its page |
| A series on the TV | **Download to box**, then pick the episode you're on, the whole series you're looking at, or every series |
| A recording on the TV | Recordings, OK on it, **Download to box** |
| The phone remote | **Download to TV box** on a film or a series, ⤓ beside an episode or a recording |

The box fetches one at a time, in the order you asked, and picks up where it stopped after a dropped connection or a restart. It tries a failed one three times before showing it as failed. IPTV films wait while someone is watching or recording, because there's one IPTV connection.

Kids profiles can't start downloads, but they see and play the downloads their profile allows: films by their certificate, recordings by their channel.

## Watching

Once something is downloaded, a **Downloaded** tab appears on the TV's top menu. Press OK on a download to play it, or Red to delete it. Playing a downloaded film from its own page also uses the download (the badge says **Downloaded**), unless you pick a version by hand. The box remembers where you got to, so it resumes even with the Hub's progress out of reach.

## Room and how long they're kept

- The box keeps 10 GB of its disk free. A download that wouldn't fit stops with "Not enough room on the box".
- The **Downloaded** screen shows the space used and free, and sets how long downloads are kept: 3, 7, 14 (the default) or 30 days from when each one finished, or until you delete them.
- **Delete a day after watching** (on by default) removes a download a day after you watch it to the end.
- Nothing is deleted while it's playing.

## How it works

| Part | |
|---|---|
| `box/src/downloads.ts` | The box shell asks the Hub how to fetch each one (`POST /api/offline`, as the Android app does), then saves the file, its poster and its subtitles. The list is in `downloads.json` beside them. |
| Where they go | `~tv/.local/share/ultimatetv/downloads`, or `DOWNLOADS_DIR` in `/etc/ultimatetv/box.env` |
| `ui/src/downloads.ts` | The TV app's side: the buttons, the list, and playing from the disk. |
| `POST /api/offline/allowed` | The Hub says which downloads a Kids profile may see, from the certificate saved with each one. |
| Phone remote | Asks the TV app through the Hub (`/api/tv/call/downloads`, `download` and `downloadRemove`). |

The Hub and the box both need updating for this: the buttons only show once the box shell has it.
