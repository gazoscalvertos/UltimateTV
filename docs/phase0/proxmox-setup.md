# Hub setup on Proxmox (Intel N150)

This setup has a Proxmox host, Jellyfin in one LXC container (101) and Docker in another (107). Both are privileged containers created by the community helper scripts, and both mount host folders with `lxc.mount.entry` lines. Commands marked **host** run in the Proxmox shell. Commands marked **docker LXC** run inside container 107.

Phase 0 only needs two things: the N150's graphics chip inside the Docker LXC, and a folder for test clips. The media libraries are wired up in Phase 2 (see the end of this page).

## 1. Pass the graphics chip into the Docker LXC

**First check the host has it.** On the host, `ls -ln /dev/dri` must list `renderD128`. If `/dev/dri` doesn't exist, the host has no graphics driver for the N150 (`lspci -nnk -s 00:02.0` shows no "Kernel driver in use"). Proxmox 8.4's default 6.8 kernel doesn't load i915 for the N150 (`8086:46d4`). Install the opt-in kernel and reboot the host:

```sh
apt update && apt install proxmox-kernel-6.14
reboot
```

Containers with `onboot: 0` (Jellyfin here) need starting again afterwards. To go back, choose 6.8 in the boot menu, or run `proxmox-boot-tool kernel pin <old version>`.

Jellyfin (101) already has it. The Docker LXC (107) already allows all devices (`lxc.cgroup2.devices.allow: a`) but doesn't mount `/dev/dri`.

**host:** add the same two mount lines Jellyfin uses to 107's config. Put them **above** any `[snapshot]` section, because lines after a `[...]` header belong to that snapshot and are ignored. Open the file with `nano /etc/pve/lxc/107.conf` and add:

```
lxc.mount.entry: /dev/dri dev/dri none bind,optional,create=dir
lxc.mount.entry: /dev/dri/renderD128 dev/dri/renderD128 none bind,optional,create=file
```

Then restart the container from the host. Restarting from inside it doesn't reload the config.

```sh
pct reboot 107
```

Rebooting 107 restarts every Docker app in it for a minute or so.

> While you're in that file: there's a leftover template line `lxc.cgroup2.devices.allow: c <major>:<minor> rwm`. It isn't needed, because the `a` line already allows everything. It's safe to delete.

**docker LXC:** check the device is there and note the group number:

```sh
ls -ln /dev/dri
# crw-rw---- 1 0 104 226, 128 … renderD128   ← 104 goes in RENDER_GID
```

## 2. Start the Hub

**docker LXC:**

```sh
cd /containers            # or wherever you keep compose projects
git clone -b claude/project-thread-at31u9 https://github.com/gazoscalvertos/UltimateTV.git
cd UltimateTV
cp .env.example .env
nano .env                 # set RENDER_GID to the number from step 1
docker compose up -d --build
docker compose logs -f hub   # wait for "UltimateTV Hub ready", then Ctrl+C
```

Once the PR is merged, use `git pull` on `main` instead of the branch.

If the repo is private, `git clone` asks for a username and password. Use your GitHub username and a personal access token as the password.

## 3. Check Quick Sync from the Hub

Open `http://192.168.0.19:8080/api/system` in a browser on any computer. You want:

```json
"renderNode": "/dev/dri/renderD128",
"checks": { "av1HardwareDecode": true, "hevcHardwareEncode": true, "hevc10HardwareEncode": true }
```

If `renderNode` is `null`, step 1 didn't take effect. If the render node is there but the checks are `false`, send the output of:

```sh
docker compose exec hub vainfo --display drm --device /dev/dri/renderD128
```

## 4. Make the test clips

```sh
docker compose exec hub make-test-clips
```

This writes about 13 clips (20 s each) and `clips.json` to `./test-clips` next to the compose file. It takes roughly 10 minutes on the N150, because the 4K HEVC and AV1 clips are encoded in software. The folder isn't in Jellyfin's library, so the clips won't appear there. To add real Dolby Vision samples, copy them into `./test-clips` (see [test-clips.md](test-clips.md)).

## 5. Run the probe on the TV

See [README.md](README.md), step 3 onwards. The TV address is `http://192.168.0.19:8080/`.

## Later (Phase 2): shared media paths

The Hub will write recordings and downloads where Jellyfin can scan them. Each library must be at the **same path** inside the Hub as inside Jellyfin:

| Host folder | Jellyfin (101) sees it at | Docker LXC (107) sees it at | Hub container must see it at |
|-------------|---------------------------|-----------------------------|------------------------------|
| `/storage_non_critical/video` | `/mnt/nas` | `/mnt/nas/video` | `/mnt/nas` |
| `/mnt/pve/Flexible/docker/video` | `/mnt/nas2` | `/mnt/nas-flexible/video` | `/mnt/nas2` |

`docker-compose.override.example.yml` already has these two mounts. Copy it to `docker-compose.override.yml` when Phase 2 lands. Both LXCs are privileged, so file ownership matches and Jellyfin can read what the Hub writes.
