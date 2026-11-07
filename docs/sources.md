# Sources

## Source options

Every source has an **Options** menu: each IPTV provider, Jellyfin, Plex, TorBox and each Stremio add-on. On the TV it is Settings › Sources › the source's "options" row (OK). On the phone it is the **Source options** section of the setup page, with the same buttons.

- **Test connection**: reachable, signed in and how long it took. For an Xtream IPTV login it also shows the account's expiry date and the connections in use out of the most it allows (from `player_api.php`); for an M3U playlist it fetches the playlist and counts its entries.
- **Pause / Resume**: a paused source is left out of the guide (its channels go), the library, search and Versions, and out of the IPTV connection limit. Its login and settings are kept, so Resume brings it straight back.
- **Move up / Move down**: the order Play and Versions prefer sources in. Quality rules come first (a camera copy, the wrong language or an oversized file still sink, and a clearly better picture still wins); the order then settles copies of a similar standard, giving each place above the last a small bonus (10 points, up to 3 places).
- **Remove**: asks first, then deletes the source's login. Pause keeps it.

### For developers

Sources are string keys: `iptv:<id>`, `jellyfin`, `plex`, `torbox`, `addon:<hash of the url>`; new providers add their own. The Hub lists them in `providerOrder` and `pausedProviders` of `GET /api/settings`. Routes (all adult-only): `POST /api/sources/:id/test`, `POST /api/sources/:id/pause {paused}`, `PUT /api/sources/order {order}`, `DELETE /api/sources/:id`. The logic is in `hub/src/sourceoptions.ts`; the TV menu is `openSourceOptions(key)` in `ui/src/sourceOptions.ts`.
