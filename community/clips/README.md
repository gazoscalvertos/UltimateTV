# Community clips

Seasonal projections (a robin hopping along the bottom at Christmas, a chick hatching at Easter) and
jump scares that anyone running UltimateTV can download from **Settings › Seasonal clips › Shared by
others** on the TV. The Hub reads [`index.json`](index.json) from this folder on GitHub (or another
address set with `PUT /api/projections { communityUrl }`) and downloads a clip into its own clip
store when someone picks it.

## Sharing one

1. Make the clip: an animated WebP or GIF with a see-through background drifts over the picture best.
   A short MP4 or WebM works too (it plays with a black box round it). Keep it under 5 MB.
2. Add the file here and an entry to `index.json`:

   ```json
   {
     "id": "robin-hop",
     "name": "Hopping robin",
     "use": "projection",
     "season": "christmas",
     "motion": "across-bottom",
     "url": "robin-hop.webp",
     "type": "image/webp",
     "sizeBytes": 67946,
     "author": "Your name",
     "licence": "CC0"
   }
   ```

   - `use`: `projection` (drifts across for a season) or `scare` (a jump scare).
   - `season`: `christmas`, `newyear`, `valentines`, `easter`, `halloween`, `bonfire`, `birthday` or `any`.
   - `motion` (projections): `across-top`, `across-bottom`, `fall`, `rise` or `corner`.
   - `url`: the file name here, or a full `https://` address.
3. Open a pull request. Only share clips you made or that are free to share (CC0 or CC BY), and keep
   them friendly: the Kids profile gets seasonal projections too.

The three starter clips were drawn for the project and are CC0.
