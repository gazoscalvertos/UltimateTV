# Seek-bar preview pictures (#227)

Dragging along the seek bar shows a small frame of the film above it, so "the bit before the ad
break" is easy to find.

## Where the pictures come from

Jellyfin 10.9+ makes **Trickplay** sheets: one JPEG holds a grid of small frames, one every few
seconds. Turn it on in Jellyfin (Library › Display › "Enable trickplay image extraction" and run the
"Trickplay Images" scheduled task). The Hub asks for the single item with `Fields=Trickplay`, picks the
biggest frame size up to 480 wide, and sends the player a `trickplay` block in `PlaybackInfo`:

```
trickplay: { url: ".../Videos/<id>/Trickplay/320/{n}.jpg?...", intervalMs, width, height, tileWidth, tileHeight, count }
```

`{n}` is the sheet number. No `trickplay` block (Emby, Plex, TorBox, IPTV, recordings, or a Jellyfin
film without the sheets) means nothing is shown and nothing is fetched.

## The players

- **TV app / desktop** (`ui/src/screens/Player.tsx`): with a mouse, hovering or dragging on the seek bar
  shows the frame above the time tip. Sheets are fetched once per session; the frame appears only after
  its sheet has loaded, so there is never a broken picture. The TV remote seeks in steps (±10/30 s, no
  scrubbing), so it has no preview.
- **Android and Fire TV** (`SeekPreview.kt`): attaches to the player's own seek bar, so a touch drag and
  the remote's held left and right both show it. Only the one frame is decoded (a region decoder), to be
  kind to a Fire stick's memory.

## Recordings

Recordings are plain files on the NAS, so Jellyfin has no sheets for them until its next scan (and
never for a `.ts` it can't process). The Hub makes its own (`hub/src/seeksheets.ts`):

- When a recording finishes, it joins a one-at-a-time queue. ffmpeg reads only the keyframes (cheap on
  the N150, two threads) and writes a 320x180 frame every 10 seconds, 100 to a JPEG, to
  `<data>/seek-sheets/<recording id>/0.jpg, 1.jpg ...` with a small `meta.json`.
- On start the Hub also looks at recordings finished in the last fortnight that have no sheets, after a
  ten-minute pause so it isn't busy while settling in.
- Playing the recording adds the same `trickplay` block as Jellyfin gives
  (`/api/recordings/<id>/seek/{n}.jpg`), so the TV, desktop and Android players need nothing new.
- Deleting a recording (by hand, a prune, or auto-delete of watched ones) deletes its sheets.
- No ffmpeg, a failed pass, or a recording still in progress means no `trickplay` block: nothing is
  shown and nothing is waited for. Uses `FFMPEG_PATH` when set, like the advert search.

## Not done

TorBox copies play from a remote link, so the Hub can't cheaply make sheets for them. Saved to the NAS,
they are in Jellyfin and get its trickplay. Unsaved TorBox streams still show no preview.
