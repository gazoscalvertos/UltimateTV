# Community clips and packs

Two kinds of thing live here: single **clips** (below) and **packs** of built clips with their
pictures and sounds ([further down](#packs)).

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

<a id="packs"></a>
## Packs

Packs of projected clips anyone with UltimateTV can add from the phone remote's
**Clips › Browse packs**. See [docs/projected-clips.md](../../docs/projected-clips.md) for what a
pack is and how the Hub keeps it safe.

### Sending one in

1. Build your clips on the phone remote and **Share as a pack › Send the file**.
2. Fork this repository and put the `.utvpack` file in `community/clips/packs/`.
3. Run `npm ci && npm run build -w shared -w hub && node tools/packs/index-packs.mjs` and commit
   the updated `index.json`.
4. Open a pull request saying what's in it and that you made the pictures and sounds yourself (or
   that their licence lets anyone share them).

### For reviewers

Before merging, for every pack:

- Look at every picture and video, and listen to every sound, on a real screen.
- Check the name and description say honestly what it is, and that the occasion fits.
- Anything that could frighten a child: add its id to [`scary.json`](scary.json) and rerun the
  index script, so the list labels it **scary**.
- Nothing copyrighted without permission (film clips, chart music, characters).
- No adverts, no links, no people who haven't agreed to be in it.
- CI must pass: it runs the Hub's own checks on every pack and checks `index.json` matches the
  files.

To take a pack down, delete its file, rerun the index script and merge. Hubs that already have it
keep their copy until they press Remove.
