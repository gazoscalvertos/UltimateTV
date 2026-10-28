# Taking the TV box away (the Hub on the box)

The Hub normally runs on the Docker LXC at home, and the box only shows the TV app. For a trip, the Hub can move onto the box for a while and come home again afterwards. One script on the box does both directions:

| | |
|---|---|
| `sudo bash /opt/ultimatetv/tools/hub/travel.sh away` | At home, before you pack the box. |
| `sudo bash /opt/ultimatetv/tools/hub/travel.sh home` | Back home, with the box on the home network again. |
| `sudo bash /opt/ultimatetv/tools/hub/travel.sh sync` | Copies the music videos again, at home while the Hub is away (to pick up files that failed, or after freeing space). |
| `sudo bash /opt/ultimatetv/tools/hub/travel.sh status` | Where the Hub is now. |
| `sudo bash /opt/ultimatetv/tools/hub/travel.sh cancel` | Calls the trip off. The home Hub carries on with the data it had, and anything changed on the box is dropped. |

Run them over SSH as your admin account (`gazos`), or on the box with a keyboard.

## Before you go: `travel.sh away`

1. Run `away` at home. The first time it installs Docker and builds the Hub on the box, which takes a few minutes. The TV keeps working from the home Hub meanwhile.
2. It asks for a code. On the TV, open **Settings › Phones and remotes** and type the 8-letter code it shows. That proves someone is at the TV before the Hub's data leaves.
3. It takes the home Hub's data: the profiles and PINs, settings, IPTV sources and channels, the guide, series links, what you've watched, paired phones, the Home Assistant key, and the jump scare clips.
4. It copies the **music videos** onto the box. That covers every video the music channels play (Clubland, House, Halloween, Spooky TV and your own), including the ones linked from elsewhere on the NAS. It shows how much there is and stops if the box hasn't got room, keeping 10 GB spare. Files already on the box from an earlier trip aren't copied again, and a copy that gets interrupted picks up where it stopped. The copies live in `/var/lib/ultimatetv/media`.
5. It starts the box's Hub with the data, and the TV app restarts on the box's own Hub (`127.0.0.1:8095`). It stays paired, and nothing on the TV looks different.

While the box is away, the **home Hub stands by**. It makes no recordings, doesn't refresh the guide, and doesn't download music videos. That way the two Hubs never use your one IPTV connection at the same time. It comes back to life when the box sends its data home. Until then, phones at home see the home Hub as it was when the box left.

The data `away` took is also kept on the box at `/var/lib/ultimatetv/travel/`, along with `/etc/ultimatetv/travel.env`. Don't delete those during the trip, because they hold the key that brings the home Hub back.

## At the hotel

### Getting the box online

The box needs the internet for live TV. The TV app has no web browser, so it can't click through a hotel Wi-Fi sign-in page. Hotel Wi-Fi also often stops devices on it from seeing each other, which stops the phone remote reaching the box.

- **Best: a small travel router** (a GL.iNet Beryl or Slate, for example). You sign it in to the hotel Wi-Fi once from your phone, then plug the box into it with a cable. The box, your phone and the router get a private network of their own, so the phone remote works. Most travel routers can also run Tailscale or WireGuard back home (see below).
- **Phone hotspot:** connect the box to it over SSH with `nmcli device wifi connect "<hotspot>" password "<password>"`. Live TV uses about 2 to 4 GB an hour in HD.
- **Hotel Wi-Fi directly:** this only works when it has no sign-in page. Use the same `nmcli` command.

### The phone remote

The box's Hub has its own address on the hotel network. The TV's QR codes (Settings › Phones and remotes) now point there, because the Hub swaps `127.0.0.1` for the box's real address in anything meant for a phone.

- **Android remote and Android app:** in their Settings, change the Hub address to `http://<box address>:8095`. They stay paired, because their pairing came along with the data.
- **Web remote:** scan the TV's QR code again, because a browser keeps its pairing per address.

### What works away from home

| | Away, with internet | Needs a VPN home |
|---|---|---|
| Live TV, guide, catch-up, IPTV films and series | ✓ The IPTV provider is on the internet. Some providers block other countries or VPNs. | |
| TorBox, TMDB rails, Spotify, Deezer | ✓ | |
| Profiles, PINs, Kids, jump scares, the screensaver themes | ✓ | |
| The music video channels (Clubland, House, Halloween, Spooky TV and your own) | ✓ Copied onto the box. New videos for them download on the box too. | |
| New recordings | ✓ Saved on the box, then sent to the NAS when you get home | |
| Films, episodes and recordings you **downloaded to the box** | ✓ Even with no internet at all | |
| Jellyfin films and TV | | ✓ Jellyfin is at 192.168.0.23 (or download them to the box before you go) |
| Recordings made before the trip, the photo screensaver | | ✓ They're on the NAS, and only the music videos are copied |

With no internet at all, the box still plays what you downloaded to it (see below) and the music video channels. Films downloaded to a phone with the Android app still play there.

### Downloading to the box before you go

At home, before the trip, choose **Download to box** on a film, a series (one episode, a whole series, or every series) or a recording (Recordings › OK). The phone remote does the same from its title pages (**Download to TV box**, or ⤓ beside an episode or recording), and its **On the box** tab shows what's there. The box fetches them one at a time onto its own disk, and the TV gets a **Downloaded** tab listing them. Press OK on one to play it. Anything downloaded plays from the box's disk wherever the Hub is, so it works in the hotel with no VPN home, and at home it starts straight away. See [downloads.md](downloads.md) for the details.

`travel.sh away` and `travel.sh status` say how much is downloaded. Downloads and the music video copies share the box's disk, and each keeps 10 GB free.

### Reaching home (optional): Tailscale

To get Jellyfin at the hotel, put Tailscale on both ends:

- **At home:** install Tailscale on one machine that stays on (a small LXC on the Proxmox host is fine) and advertise the home network: `tailscale up --advertise-routes=192.168.0.0/24`. Then approve the route in the Tailscale admin page.
- **On the box:** `sudo pacman -S tailscale && sudo systemctl enable --now tailscaled && sudo tailscale up --accept-routes`. Or run it on the travel router instead.

Jellyfin (`192.168.0.23`) then works at its usual address, so no Hub settings change. One catch: if the hotel network also uses `192.168.0.x`, the addresses clash. A travel router avoids that, because it gives you its own network (GL.iNet uses `192.168.8.x`).

## Back home: `travel.sh home`

Plug the box back into the home network and run `home`. It stops the box's Hub and sends anything recorded or downloaded on the trip back to the NAS, into the same folders. Then it sends the box's data to the home Hub (what you watched, settings you changed, new pairings and scare clips), waits for the home Hub to restart with it, and points the TV app back at it. The home Hub keeps what it replaced in `data/before-restore-<time>/` in its Docker volume, just in case.

The box's Hub is left stopped, with its data still in Docker and the music video copies still in `/var/lib/ultimatetv/media`, so the next trip only copies what's new. To get the space back, delete that folder. Run `away` again next time: it takes a fresh copy from home.

## How it works

| Part | |
|---|---|
| `tools/hub/travel.sh` | The script above. It keeps the trip's state in `/etc/ultimatetv/travel.env` (root only). |
| `docker-compose.box.yml` | The Hub on the box. It uses host networking so it can tell phones the box's address, and it sees `/var/lib/ultimatetv/media/mnt/nas` as `/mnt/nas`, so the copied files keep their NAS paths. `travel.sh` adds it through `COMPOSE_FILE` in `/opt/ultimatetv/.env`. |
| `hub/src/move.ts` | `GET /api/hub/move-out` hands over the data. It needs a phone or script paired in the last 15 minutes, then the Hub stands by. `POST /api/hub/move-in` takes data back with the key `move-out` gave. `DELETE /api/hub/move` calls the move off. `GET /api/hub/move-files` and `GET /api/hub/move-file` lend the music video files, and `PUT /api/hub/move-file` takes new ones back (only into the NAS shares, never over an existing file). All of these need the key. The data is unpacked when the Hub starts. |
| `hub/src/lan.ts` | Swaps `127.0.0.1` for the box's network address in QR codes and pairing links. |
| `box/src/main.ts` | When the Hub's address changes, the TV keeps its pairing. |
| Weekly box update | While the Hub is away, the box's Hub is rebuilt with the app. |

The Hub restarts itself after a move, and Docker starts it again (`restart: unless-stopped`). A Hub run outside Docker has to be started again by hand.
