# Emby, and several media servers at once

The Hub can use **Emby** as a library, and any of **Jellyfin, Plex and Emby** can be connected at the
same time (#216, #217). Both are built from the servers' API documentation and have not been tried
against a real Emby server or two live servers yet.

## Connecting Emby

Setup page (`/setup/#jellyfin`) › **Emby**: the server's address (usually `http://<ip>:8096`) and an
Emby user's name and password. The Hub signs in once, checks the server answers, and keeps only the
access token (never the password). Emby has no Quick Connect for other apps, so there is no code
option. **Disconnect Emby** removes it.

Emby is the Jellyfin client with a few differences (`hub/src/services/emby.ts`): the sign-in header,
the subtitle URL, and skip markers, which Emby keeps as chapter markers (`IntroStart`, `IntroEnd`,
`CreditsStart`) rather than Jellyfin's media segments. It plays the original file like Jellyfin.

## Several servers at once

Connecting one no longer disconnects another.

- **Rails and search** merge the servers: Continue watching by most recently played, the others
  taking a turn from each server so one big library doesn't fill every row.
- **One title, one card.** A film on two servers with the same TMDB id shows once; **Versions** lists
  a copy from each, labelled with its server.
- **Plays and progress go to the right server.** A place is saved to the server the title came from
  (and in the Hub's own progress); Mark as watched is sent to that server.
- **Saves and recordings** tell every server about the new file, and say what each one did.
- **If one is off**, the others carry on; its titles simply aren't listed until it answers.
- **Not merged:** each server keeps its own watched state; they are not synced with each other.
  Jellyfin's offline progress queue (#80) is still Jellyfin's only.

How it works: `services/combined.ts` puts the servers behind one `MediaServer`. Item ids inside the
Hub's library code are `jellyfin~abc` / `plex~42` / `emby~55` so two servers' ids can't collide; the
title ids and progress keys everyone else sees stay `jellyfin:abc`, `plex:42`, `emby:55`.
