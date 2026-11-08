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

## Not done

The issue also asks for the Hub to make a sheet with ffmpeg for finished recordings and TorBox copies.
That isn't built yet; those still show no preview.
