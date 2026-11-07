// Finds Jellyfin and Plex servers on the home network, so the TV can offer them in a list instead
// of asking for an address to be typed (issue #218).
//
//  - Jellyfin answers a UDP broadcast "who is JellyfinServer?" on port 7359 with JSON
//    ({ Address, Id, Name }).
//  - Plex answers a GDM multicast "M-SEARCH * HTTP/1.0" (239.255.255.250:32414) with HTTP-style
//    headers (Resource-Identifier, Name, Content-Type, Port); the address is the sender's.
//
// The UDP layer is injected (`UdpFactory`) so tests drive it with fake sockets. A Hub in a Docker
// bridge network usually can't hear either (broadcasts don't cross it), which is why the TV keeps
// "type an address" as the fallback and why every failure here means "found nothing", not an error.

import dgram from "node:dgram";

export interface DiscoveredServer {
  kind: "jellyfin" | "plex";
  /** The server's own id, so a server answering twice (two network cards) shows once. */
  id: string;
  name: string;
  /** Where to reach it, e.g. http://192.168.0.20:8096 */
  url: string;
}

/** The slice of a dgram socket discovery uses. */
export interface UdpSocketLike {
  on(event: "message", cb: (msg: Buffer, rinfo: { address: string; port: number }) => void): unknown;
  on(event: "error", cb: (err: Error) => void): unknown;
  bind(port: number, cb?: () => void): unknown;
  setBroadcast(on: boolean): unknown;
  send(msg: string | Buffer, port: number, address: string, cb?: (err: Error | null) => void): unknown;
  close(): unknown;
}

export type UdpFactory = () => UdpSocketLike;

export const defaultUdp: UdpFactory = () => dgram.createSocket({ type: "udp4", reuseAddr: true });

export const JELLYFIN_PORT = 7359;
export const JELLYFIN_PROBE = "who is JellyfinServer?";
export const GDM_ADDRESS = "239.255.255.250";
export const GDM_PORT = 32414;
export const GDM_REPLY_PORT = 32412;
export const GDM_PROBE = "M-SEARCH * HTTP/1.0\r\n\r\n";

/** Reads one Jellyfin reply, or null when it isn't one. */
export function parseJellyfinReply(msg: Buffer | string): DiscoveredServer | null {
  try {
    const j = JSON.parse(msg.toString()) as { Address?: unknown; Id?: unknown; Name?: unknown };
    if (typeof j.Address !== "string" || !/^https?:\/\//i.test(j.Address)) return null;
    const url = j.Address.replace(/\/+$/, "");
    return { kind: "jellyfin", id: typeof j.Id === "string" && j.Id ? j.Id : url, name: typeof j.Name === "string" && j.Name ? j.Name : "Jellyfin", url };
  } catch {
    return null;
  }
}

/** Reads one Plex GDM reply from `address`, or null when it isn't a media server's. */
export function parsePlexReply(msg: Buffer | string, address: string): DiscoveredServer | null {
  const headers = new Map<string, string>();
  for (const line of msg.toString().split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
  }
  const type = headers.get("content-type");
  if (type && !/plex\/media-server/i.test(type)) return null;
  if (!type && !headers.has("resource-identifier")) return null;
  const port = Number(headers.get("port"));
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { kind: "plex", id: headers.get("resource-identifier") || `${address}:${port}`, name: headers.get("name") || "Plex", url: `http://${address}:${port}` };
}

/** Binds a socket, resolving false when it can't. */
function bound(socket: UdpSocketLike, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    socket.on("error", () => resolve(false));
    try {
      socket.bind(port, () => resolve(true));
    } catch {
      resolve(false);
    }
  });
}

/** Sends `probe`, collects replies for `timeoutMs`, then closes the socket. */
async function ask(udp: UdpFactory, o: { ports: number[]; probe: string; to: { address: string; port: number }; timeoutMs: number; broadcast?: boolean }, onReply: (msg: Buffer, from: string) => void): Promise<void> {
  let sock: UdpSocketLike | null = null;
  for (const port of o.ports) {
    const s = udp();
    if (await bound(s, port)) {
      sock = s;
      break;
    }
    try {
      s.close();
    } catch {
      // Already closed.
    }
  }
  if (!sock) return;
  const open = sock;
  open.on("error", () => undefined);
  open.on("message", (msg, rinfo) => onReply(msg, rinfo.address));
  try {
    if (o.broadcast) open.setBroadcast(true);
    open.send(o.probe, o.to.port, o.to.address, () => undefined);
  } catch {
    // No route (no network at all): nothing will answer.
  }
  await new Promise((r) => setTimeout(r, o.timeoutMs));
  try {
    open.close();
  } catch {
    // Already closed.
  }
}

export async function discoverJellyfin(udp: UdpFactory = defaultUdp, timeoutMs = 1500): Promise<DiscoveredServer[]> {
  const found = new Map<string, DiscoveredServer>();
  await ask(udp, { ports: [0], probe: JELLYFIN_PROBE, to: { address: "255.255.255.255", port: JELLYFIN_PORT }, timeoutMs, broadcast: true }, (msg) => {
    const s = parseJellyfinReply(msg);
    if (s && !found.has(s.id)) found.set(s.id, s);
  }).catch(() => undefined);
  return [...found.values()];
}

export async function discoverPlex(udp: UdpFactory = defaultUdp, timeoutMs = 1500): Promise<DiscoveredServer[]> {
  const found = new Map<string, DiscoveredServer>();
  // Servers reply to port 32412 on some versions and to the sender's port on others, so listen
  // on 32412 when it's free and on any port when it isn't.
  await ask(udp, { ports: [GDM_REPLY_PORT, 0], probe: GDM_PROBE, to: { address: GDM_ADDRESS, port: GDM_PORT }, timeoutMs }, (msg, from) => {
    const s = parsePlexReply(msg, from);
    if (s && !found.has(s.id)) found.set(s.id, s);
  }).catch(() => undefined);
  return [...found.values()];
}

/** Both kinds at once, Jellyfin first. Never throws. */
export async function discoverServers(udp: UdpFactory = defaultUdp, timeoutMs = 1500): Promise<DiscoveredServer[]> {
  const [jf, plex] = await Promise.all([discoverJellyfin(udp, timeoutMs), discoverPlex(udp, timeoutMs)]);
  return [...jf, ...plex];
}
