# Reinstalling the box over the network (PXE)

A small PXE server on the Docker LXC lets the box install itself from scratch. You boot the box from the network and pick **Reinstall** from a menu. About 20 minutes later it comes back up in UltimateTV, with no keyboard needed after that. The same steps rebuild the box if it ever breaks, or set up a replacement.

**Your router's DHCP stays on.** The PXE server runs in "proxy DHCP" mode: the router still hands out addresses, and the PXE server only adds where to boot from. Nothing else on the network changes. Only the box's MAC address gets the menu, and anything else that boots from the network goes straight back to its own disk.

## What happens

1. The box asks the network for a boot file. The PXE server sends iPXE, which fetches the menu.
2. You choose **Reinstall the box (erases the disk)**. If nothing is pressed for 15 seconds, it starts from its disk as normal.
3. The Arch Linux installer boots straight from the Arch mirrors and runs `tools/pxe/auto.sh`:
   - It erases the biggest internal disk, waiting 15 seconds first so you can still pull the plug.
   - It installs Arch on btrfs with systemd-boot.
   - It sets up your admin login, SSH, the time zone and a UK keyboard.
4. On its first start, the new system clones this repository and runs the box installer ([box-install.md](box-install.md)), then restarts into UltimateTV.

## 1. Start the PXE server on the Docker LXC

The box gets the app from GitHub's `main` branch, so merge the pull request first (or set `BRANCH` below to test a branch).

```sh
cd /containers/UltimateTV && git pull
cd tools/pxe
cp .env.example .env
openssl passwd -6            # type the password you want for the box; copy the $6$... line
nano .env
docker compose up -d --build
docker logs -f ultimatetv-pxe
```

In `.env`:

| Setting | What to put |
|---|---|
| `PXE_IP` | The Docker LXC's address, `192.168.0.19` |
| `BOX_MAC` | The box's Ethernet MAC address. If you don't know it yet, leave it empty, netboot the box once and it shows its MAC. Then fill it in and run `docker compose up -d` again. |
| `ADMIN_USER`, `ADMIN_PASSWORD_HASH` | Your login on the box, with the `$6$...` line from `openssl passwd -6`. Wrap the hash in single quotes so the `$` signs survive. |
| `ADMIN_SSH_KEY` | Optional: your SSH public key, for logging in without the password |
| `HUB_URL` | `http://192.168.0.19:8095` |
| `GITHUB_TOKEN` | Only while the repository is private: a fine-grained token with read-only **Contents** access to it, so the box can download the app and its updates |

The first build compiles iPXE and takes a few minutes. The server uses UDP ports 67, 69 and 4011 and TCP port 8097 on the LXC. Nothing else there should be using them.

## 2. Set up the GMKtec

1. Plug the box into the network by cable, using the Ethernet port you'll keep using.
2. Open the BIOS (press **Del** while it starts):
   - Turn **Secure Boot** off.
   - Turn on **Network Stack** and **IPv4 PXE Support** (sometimes under Advanced › Network Stack Configuration).
   - Save and exit.
3. While it starts, press **F7** for the one-time boot menu and pick the **UEFI PXE IPv4** entry for the network port. The disk stays first in the normal boot order, so the box never netboots unless you ask it to.
4. The UltimateTV menu appears. Choose **Reinstall the box**.

You can watch it on the TV. When it says it's restarting into the new system, leave it alone. The first start installs the desktop pieces and the app (about 10 minutes, depending on the mirror), then restarts into **Who's watching?**

## If something goes wrong

- **The log says "failed to bind DHCP server socket: Address already in use".** Something else on the LXC holds UDP port 67. On Gary's LXC it's AdGuard Home's compose file publishing `67:67/udp`. If AdGuard's own DHCP is off (Settings › DHCP settings), delete that port line, then run `docker compose up -d` for AdGuard and the PXE server. Don't stop AdGuard itself: the house, and the box's install, use it for DNS.
- **The box doesn't find the PXE server.** Check `docker logs ultimatetv-pxe` for DHCP lines when the box boots. If there are none, the LXC isn't hearing the broadcast. Check that the container uses host networking, and that the LXC is on the same bridge as the box (`vmbr0`).
- **It shows "isn't set up as an UltimateTV box".** The MAC it shows isn't in `BOX_MAC`. Add it, then run `docker compose up -d`.
- **The install stops with an error.** The screen shows what failed, and `/root/install.log` has the details. Press Enter for a shell. The installer starts afresh each time, so after fixing the cause, netboot and choose Reinstall again.
- **The first start fails.** Log in with your admin account (SSH, or Ctrl+Alt+F2) and run `journalctl -u ultimatetv-firstboot`. To retry, run `sudo systemctl start ultimatetv-firstboot`.

When you're done, stop the server with `docker compose down`. It's only needed for reinstalls.
