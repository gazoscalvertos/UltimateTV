// The Hub's address on the home (or hotel) network. When the Hub runs on the TV box, the TV app
// reaches it at 127.0.0.1, but a QR code or link meant for a phone needs an address the phone can
// reach, so loopback addresses are swapped for the box's own network address.

import os from "node:os";

type Interfaces = ReturnType<typeof os.networkInterfaces>;

/** Virtual interfaces (Docker, VPNs, bridges) a phone on the same Wi-Fi can't use. */
const VIRTUAL = /^(docker|br-|veth|virbr|lo|tailscale|tun|tap|wg|zt)/;

/** The box's IPv4 address on its network: wired first, then Wi-Fi, then anything else. */
export function lanAddress(interfaces: Interfaces = os.networkInterfaces()): string | undefined {
  const found: { name: string; address: string }[] = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (VIRTUAL.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254.")) found.push({ name, address: a.address });
    }
  }
  const rank = (n: string) => (/^(en|eth)/.test(n) ? 0 : /^wl/.test(n) ? 1 : 2);
  found.sort((a, b) => rank(a.name) - rank(b.name));
  return found[0]?.address;
}

const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

/** `base` with a loopback host swapped for the LAN address (unchanged when there isn't one). */
export function phoneReachable(base: string, lanOf: () => string | undefined = lanAddress): string {
  const lan = lanOf();
  if (!lan) return base;
  const url = new URL(base);
  if (!LOOPBACK.test(url.hostname)) return base;
  url.hostname = lan;
  return url.toString().replace(/\/+$/, "");
}
