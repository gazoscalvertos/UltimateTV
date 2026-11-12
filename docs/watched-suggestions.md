# Watched titles in suggestions

Suggestions should offer something new. The Hub keeps track of what each profile has watched and
holds those titles back (or shows them last) in every suggestion row.

## What counts as watched

- A film or episode played to the end on the TV, the desktop app or the phone, **or** watched for
  a minute or more (so a half-watched series is known too). Recorded per profile: the Kids
  profile's viewing never changes an adult's suggestions, and a Guest keeps nothing.
- Anything Jellyfin, Plex or Emby report as played, from any device (every 15 minutes, and 30
  seconds after the Hub starts). These servers have one viewer, so they count for every profile.
- "Mark as watched" on a Continue watching card; "Mark as not watched" undoes it.

Titles are matched by id and by name and year (a year out by one still matches), so a film watched
from Jellyfin is known when TMDB suggests it, and the other way round.

## The setting

Settings › Playback › **Titles you've already watched** (also on the phone setup page, Playback):

| Choice | Effect |
| --- | --- |
| Put last (default) | Watched titles stay but move behind the rest of the row. |
| Hide | Watched titles are left out; a row left empty isn't shown. |
| Show as normal | No change from before. |

## Where it applies

Home: Because you watched, Family films, Cartoons and kids' shows, Films on TV today, Recently
added, Trending this week, New films from your IPTV, Next up (an episode the Hub saw finished isn't
offered again) and the hero. Films and TV Shows pages: every row, including the Kids top rated,
age, genre and Best of each year rows. Details: More like this. Search: watched titles go behind
the others but are never hidden, because the viewer asked for them.

Not touched: Continue watching, Saved for later, Favourites, Recently recorded, the Kids "Watch
again" row (that one is meant to show watched titles), and the player's Up Next, which carries on
to the next episode of the series being watched.

The New episodes row (docs/coming-up.md) leaves out an episode already watched, and nothing else. The Hub has no separate "Art" or random-pick rows today; when they are added they
should call `ContentFilter.unseen()` on their titles.

## For developers

`hub/src/watchedtitles.ts` holds the store; `ContentFilter.unseen()` / `watched()` (profiles.ts)
are what rows call. The setting is `playback.watchedSuggestions` (`end` | `hide` | `off`).
`MediaServer.played()` is implemented for Jellyfin (and so Emby) and Plex. Tests:
`hub/test/watchedtitles.test.ts`.

Untested on a real Jellyfin, Plex or Emby server: the played lists (Plex's show handling in
particular), and the box/phone Settings screens.
