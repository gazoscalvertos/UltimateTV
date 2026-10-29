# Community clip packs

Packs of projected clips anyone with UltimateTV can add from the phone remote's
**Clips › Browse packs**. See [docs/projected-clips.md](../../docs/projected-clips.md) for what a
pack is and how the Hub keeps it safe.

## Sending one in

1. Build your clips on the phone remote and **Share as a pack › Send the file**.
2. Fork this repository and put the `.utvpack` file in `community/clips/packs/`.
3. Run `npm ci && npm run build -w shared -w hub && node tools/packs/index-packs.mjs` and commit
   the updated `index.json`.
4. Open a pull request saying what's in it and that you made the pictures and sounds yourself (or
   that their licence lets anyone share them).

## For reviewers

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
