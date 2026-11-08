# Sync delay and remembered tracks

Issues #223 (lip-sync and subtitle delay) and #228 (remember audio and subtitles per series).
**Not tested on hardware** — see the end.

## Sound delay and subtitle delay (box)

Player › Options › Lip-sync. Each opens a small control: **left/right** move 50 ms (shown as
"+150 ms"), Reset sets 0, Back finishes. Limit ±10 s (`DELAY_LIMIT_MS`).

- **Sound delay** is mpv `audio-delay`, added to the Bluetooth delay from #102 (`Player.setSoundOffset`
  in `box/src/player.ts`; the box sends the sum). It is kept in the UI's local storage per sound
  output — `tv`, or each Bluetooth device's address — and applied when a title starts
  (`ui/src/delays.ts`).
- **Subtitle delay** is mpv `sub-delay`. It resets to 0 for each new title.
- The phone remote's Sound and subtitles sheet has both (TV method `delay`; `TvNow.delays` carries
  the current values).

Older box shells without `setSoundOffset` / `setSubtitleDelay` simply don't show the rows.

## Remembered tracks (Hub)

`hub/src/trackprefs.ts`: `GET/PUT/DELETE /api/track-prefs?title=<id>`, one list per profile
(kv `track-prefs:<profile>`, newest 300 kept). A pref is a language and kind, never a track number:
`{ audio: { lang, description? }, subtitle: "off" | { lang } }`. Matching is in
`shared/src/trackprefs.ts` (`rememberedAudio`, `rememberedSubtitle`; "eng", "en" and "en-GB" are
one language), so it works across Jellyfin, TorBox and recordings.

The key is the title id (the series, or the film), so the next episode, Up Next and Resume all see
it. Live TV and links have none. When a pref exists it wins over the profile's defaults, and
OpenSubtitles auto-fetch and audio description auto-switch stay out of the way. Options › Default
deletes it.

## Fire TV / Android player

The Fire remote's Select was always play/pause and left/right always seeked, so the player's CC
button could never be reached and subtitles couldn't be turned off. Now:

- **Menu**, **Down** (or the remote's captions/audio key) opens *Audio and subtitles*, a plain list
  with **Off**, the tracks, and *Default* (forget my choice).
- **Up** focuses the *Audio and subtitles* button in the top bar; with a button of ours focused,
  Select clicks it and the D-pad moves between buttons.
- The choice is saved per series and applied when the tracks appear.

Not on Android yet: sound delay and subtitle delay (ExoPlayer has no built-in audio offset).

## Untested

Nothing here has run on the box, a Fire stick or a phone. The Android code was not compiled (no SDK
in the cloud session). The Hub and shared logic have tests; the UI type-checks.
