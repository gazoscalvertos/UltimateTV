// The Options menu for one source (#219): test the connection, pause or resume it, move it up or
// down the order Play and Versions prefer, or remove it.
//
// It is generic over the provider list: a source is the string key from PublicSettings.providerOrder
// ("iptv:<id>", "jellyfin", "plex", "torbox", "addon:<hash>", and whatever providers are added later),
// so any screen that lists sources can call `openSourceOptions(key)` from a row.

import type { PublicSettings, SourceTestResult } from "@ultimatetv/shared";
import { hub } from "./api";
import { choose, confirm } from "./components/Dialog";
import { errorToast, toast } from "./store";

/** The name a source goes by, from the settings the Hub sent. */
export function sourceName(s: PublicSettings, key: string): string {
  if (key.startsWith("iptv:")) return s.iptv.find((x) => `iptv:${x.id}` === key)?.name ?? "IPTV";
  if (key === "jellyfin") return s.jellyfin?.serverName ?? "Jellyfin";
  if (key === "plex") return s.plex?.serverName ?? "Plex";
  if (key === "torbox") return "TorBox";
  return s.addons.find((a) => a.id === key)?.name ?? key;
}

export function isSourcePaused(s: PublicSettings, key: string): boolean {
  return s.pausedProviders.includes(key);
}

/** What Test connection found, as lines for a dialog. */
export function describeTest(r: SourceTestResult): string {
  const lines: string[] = [];
  lines.push(r.reachable ? `Reachable, took ${r.ms >= 1000 ? `${(r.ms / 1000).toFixed(1)} s` : `${r.ms} ms`}` : `Not reachable${r.error ? `: ${r.error}` : ""}`);
  if (r.reachable && r.signedIn !== undefined) lines.push(r.signedIn ? "Signed in" : "Not signed in");
  if (r.detail) lines.push(r.detail);
  if (r.expiresAt) lines.push(`${r.expiresAt < Date.now() ? "Expired" : "Expires"} ${new Date(r.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`);
  if (r.activeConnections !== undefined) lines.push(`${r.activeConnections} of ${r.maxConnections ?? "?"} connections in use`);
  if (r.reachable && r.error) lines.push(r.error);
  return lines.join("\n");
}

async function showTest(key: string, name: string): Promise<void> {
  toast(`Testing ${name}…`);
  try {
    const r = await hub.testSource(key);
    await choose({ title: `${name}: ${r.reachable && !r.error && r.signedIn !== false ? "working" : "needs a look"}`, message: describeTest(r), options: [{ label: "OK", value: true, icon: "check" }] });
  } catch (err) {
    errorToast(err);
  }
}

/**
 * Opens the Options menu for a source and keeps it open until the person is done, so Move up can
 * be pressed twice. `onChange` gets the Hub's settings after every change (pause, move, remove), so
 * the screen behind can refresh its rows.
 */
export async function openSourceOptions(key: string, onChange?: (s: PublicSettings) => void): Promise<void> {
  let s = await hub.settings().catch((err) => {
    errorToast(err);
    return null;
  });
  while (s && s.providerOrder.includes(key)) {
    const name = sourceName(s, key);
    const paused = isSourcePaused(s, key);
    const at = s.providerOrder.indexOf(key);
    const pick = await choose<"test" | "pause" | "up" | "down" | "remove">({
      title: `${name} options`,
      message: `${paused ? "Paused: hidden from the guide, library and Versions. " : ""}Number ${at + 1} of ${s.providerOrder.length} in the order Play and Versions try sources.`,
      options: [
        { label: "Test connection", value: "test", icon: "check" },
        { label: paused ? "Resume" : "Pause", value: "pause", icon: paused ? "play" : "pause", detail: paused ? "Show it again" : "Hide it but keep its login" },
        ...(at > 0 ? [{ label: "Move up", value: "up" as const, icon: "move" }] : []),
        ...(at < s.providerOrder.length - 1 ? [{ label: "Move down", value: "down" as const, icon: "move" }] : []),
        { label: "Remove", value: "remove", icon: "trash", tone: "danger" as const },
      ],
    });
    if (!pick) return;
    try {
      if (pick === "test") {
        await showTest(key, name);
        continue;
      }
      if (pick === "pause") {
        s = await hub.pauseSource(key, !paused);
        toast(`${name} ${paused ? "resumed" : "paused"}`, "good");
      } else if (pick === "up" || pick === "down") {
        const order = [...s.providerOrder];
        const to = at + (pick === "up" ? -1 : 1);
        [order[at], order[to]] = [order[to]!, order[at]!];
        s = await hub.orderSources(order);
      } else if (pick === "remove") {
        if (!(await confirm(`Remove ${name}?`, "Its login and settings are deleted. You would have to set it up again to bring it back; Pause keeps them.", "Remove", true))) continue;
        s = await hub.removeSource(key);
        toast(`${name} removed`, "good");
      }
      onChange?.(s);
    } catch (err) {
      errorToast(err);
    }
  }
}
