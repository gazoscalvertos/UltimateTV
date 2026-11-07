# Nuvio

Issue #220 asked what "Nuvio" means as a source. Findings:

- **Nuvio** is a Stremio-style player app. Its streams come from **add-ons**, in particular **Nuvio
  Streams** ([tapframe/NuvioStreamsAddon](https://github.com/tapframe/NuvioStreamsAddon)), a normal
  Stremio add-on that can be self-hosted or run on a hosting service (ElfHosted sells one).
- So it needs **no new client**. The Hub already speaks the Stremio add-on protocol
  (`hub/src/services/stremio.ts`): its streams join **Versions** and Play like AIOStreams, ranked by the
  same quality rules.

## Adding it

Setup page › AIOStreams / add-ons › paste the Nuvio Streams add-on URL (the one ending in
`/manifest.json`, or the `/configure` or `stremio://` link, which the Hub accepts). The add-on's own
name (from its manifest) labels its streams.

This has not been tried against a live Nuvio Streams server. A separate named "Nuvio" row in the
Sources screen is left to the Sources screen work (#218/#219), which lists every add-on by its
manifest name. The PS5 route that borrows from the *Nuvio PS5 homebrew* is a different project
(see `docs/ps5.md`).
