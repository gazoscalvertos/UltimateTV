# Setting up sources from the TV

Settings › Sources lists every provider with a status that says what to do next. Press OK on a
row to set it up or change it; the phone's QR code stays beside the list for the times typing on
a phone is quicker.

![Settings › Sources](screenshots/114-settings-sources.png)

| Row | OK does |
| --- | --- |
| IPTV playlist (M3U) | Asks for the playlist link. When one is added, offers to add another or remove one. |
| Xtream Codes | Asks for the server, username and password. |
| Jellyfin | Lists servers found on the network (or type an address), then Quick Connect or username and password. |
| Plex | Lists servers found on the network (or let plex.tv choose, or type an address), then shows a code for plex.tv/link. |
| AIOStreams and add-ons | Adds a Stremio add-on by link (`https://` or `stremio://`), or removes one. |
| TorBox | Asks for the API key; offers a different key or removal once set. |
| TV guide, TMDB | Read-only here: TMDB's key is added on the phone. |

![The on-screen keyboard](screenshots/115-sources-keyboard.png)

The keyboard has the punctuation a web address needs, `http://` and `https://` shortcuts, and
takes text sent from the phone remote too. Passwords and keys show as dots.

## Finding servers

`GET /api/discover` asks the network for servers (about 1.5 seconds) and the TV lists what answers:

- **Jellyfin**: a UDP broadcast of `who is JellyfinServer?` to port 7359; servers reply with JSON
  (`Address`, `Id`, `Name`).
- **Plex**: a GDM multicast `M-SEARCH * HTTP/1.0` to 239.255.255.250:32414; servers reply with
  headers (`Resource-Identifier`, `Name`, `Content-Type: plex/media-server`, `Port`) from their own
  address.

Broadcasts don't cross a Docker bridge network, so a Hub in a default container may find nothing
(run it with host networking to find servers). That is never an error: the TV falls back to
**Type an address**, and Plex can also be left to plex.tv.

## Who can do it

Only adult profiles: Kids and Guest never see the setup (Settings itself is closed to them) and
the Hub's setup routes, including `/api/discover`, ask for an adult and the profile's PIN. If the
PIN hasn't been entered yet, the TV asks for it when you try.

## Adding a provider (for developers)

`ui/src/sources.ts` builds the rows from a generic list (id, label, kind, status, next step);
`ui/src/screens/Sources.tsx` maps each id to its setup in `setups`, and `rowOptions` is where a
per-row Options menu (test, pause, remove, reorder) plugs in.
# Sources

## Source options

Every source has an **Options** menu: each IPTV provider, Jellyfin, Plex, TorBox and each Stremio add-on. On the TV it is Settings › Sources › the source's "options" row (OK). On the phone it is the **Source options** section of the setup page, with the same buttons.

- **Test connection**: reachable, signed in and how long it took. For an Xtream IPTV login it also shows the account's expiry date and the connections in use out of the most it allows (from `player_api.php`); for an M3U playlist it fetches the playlist and counts its entries.
- **Pause / Resume**: a paused source is left out of the guide (its channels go), the library, search and Versions, and out of the IPTV connection limit. Its login and settings are kept, so Resume brings it straight back.
- **Move up / Move down**: the order Play and Versions prefer sources in. Quality rules come first (a camera copy, the wrong language or an oversized file still sink, and a clearly better picture still wins); the order then settles copies of a similar standard, giving each place above the last a small bonus (10 points, up to 3 places).
- **Remove**: asks first, then deletes the source's login. Pause keeps it.

### For developers

Sources are string keys: `iptv:<id>`, `jellyfin`, `plex`, `torbox`, `addon:<hash of the url>`; new providers add their own. The Hub lists them in `providerOrder` and `pausedProviders` of `GET /api/settings`. Routes (all adult-only): `POST /api/sources/:id/test`, `POST /api/sources/:id/pause {paused}`, `PUT /api/sources/order {order}`, `DELETE /api/sources/:id`. The logic is in `hub/src/sourceoptions.ts`; the TV menu is `openSourceOptions(key)` in `ui/src/sourceOptions.ts`.
