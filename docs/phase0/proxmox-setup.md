# Hub setup on Proxmox (Intel N150)

This assumes the current setup: a Proxmox host, Jellyfin in one LXC container, Docker in another, and SMB/SFTP shares for media. Commands marked **host** run in the Proxmox host shell. Commands marked **docker CT** run inside the Docker container.

## 1. Share the media folder between Jellyfin and Docker

Jellyfin and the Hub must see the same files at the **same path**, so a recording the Hub writes is the file Jellyfin scans. Pick the host folder that already holds your media (examples use `/tank/media`) and the path Jellyfin already uses inside its container (examples use `/media`).

**host:** check what Jellyfin already has, then give the Docker container the same mount. Replace `<docker-ctid>` with the Docker container's ID, and use the next free `mpN` number.

```sh
pct config <jellyfin-ctid> | grep '^mp'
pct set <docker-ctid> -mp1 /tank/media,mp=/media
```

Make the folders the Hub will write to:

```sh
mkdir -p /tank/media/Recordings /tank/media/Inbox /tank/media/test-clips
```

**Permissions:** unprivileged containers shift user IDs by 100000. If Jellyfin can't read files the Hub writes, give both containers the same owner ID mapping, or make the media folders group-writable for a shared group. Phase 0 checks this with a test file (step 5).

## 2. Pass the N150's graphics chip into the Docker container

Jellyfin probably already has this. The Docker container needs the same.

**host:** find the render device and its group ID:

```sh
ls -ln /dev/dri
# crw-rw---- 1 0 104 226, 128 … renderD128   ← 104 is the render group on the host
```

On Proxmox 8.2 or later, add the device in the container's config (UI: *Container → Resources → Add → Device Passthrough*, path `/dev/dri/renderD128`, GID `104` or whatever the container's `render` group is). Or from the shell:

```sh
pct set <docker-ctid> -dev0 /dev/dri/renderD128,gid=104
pct reboot <docker-ctid>
```

**docker CT:** check the device is there and note its group ID for `RENDER_GID`:

```sh
ls -ln /dev/dri
```

## 3. Start the Hub

**docker CT:**

```sh
git clone https://github.com/gazoscalvertos/UltimateTV.git
cd UltimateTV
cp .env.example .env      # set MEDIA_DIR=/media and RENDER_GID from step 2
docker compose up -d --build
docker compose logs -f hub   # wait for "UltimateTV Hub ready"
```

Give the Docker container a fixed IP (DHCP reservation in your router) so the TV bookmark never breaks.

## 4. Check Quick Sync from the Hub

Open `http://<server-ip>:8080/api/system` in a browser. You want:

```json
"renderNode": "/dev/dri/renderD128",
"checks": { "av1HardwareDecode": true, "hevcHardwareEncode": true, "hevc10HardwareEncode": true }
```

The same checks show on the probe's *Send report* tab. If `renderNode` is `null`, step 2 didn't take effect. If the render node is there but the checks are `false`, run `docker compose exec hub vainfo --display drm --device /dev/dri/renderD128` and share the output.

## 5. Check Jellyfin can see what the Hub writes

**docker CT:**

```sh
docker compose exec hub sh -c 'echo test > /media/Recordings/hub-write-test.txt'
```

**Jellyfin container:** `cat /media/Recordings/hub-write-test.txt` should print `test`. Then delete the file.

## 6. Make the test clips

```sh
docker compose exec hub make-test-clips
```

This writes about 13 clips (20 s each) plus `clips.json` to `/media/test-clips`. It takes roughly 10 minutes on the N150 because the 4K HEVC and AV1 clips are encoded in software. See [test-clips.md](test-clips.md) for adding real Dolby Vision samples.
