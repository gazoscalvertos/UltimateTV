// This screen's pairing with the Hub. Only paired screens get the Hub's events and can show the
// codes that pair phones. The first screen is let in at once (the box, straight after the Hub
// update); any other waits, showing a short code, until a paired phone or TV lets it in.

import { createSignal } from "solid-js";
import type { PairedDevice, PendingScreen } from "@ultimatetv/shared";
import { agent, onBox } from "./agent";
import { api, ApiError } from "./api";
import { onHubEvent } from "./events";

const [waiting, setWaiting] = createSignal<PendingScreen | null>(null);
/** Set while this screen waits to be let in: what it's called and the code it shows. */
export { waiting as pairingWait };

const [stamp, setStamp] = createSignal(0);
/** Changes whenever the pairing code may have: QR code images add it to their address to reload. */
export const pairStamp = stamp;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resolves once this screen is paired (at once if it already is). */
export async function pairScreen(): Promise<void> {
  for (;;) {
    try {
      const me = await api<{ paired: boolean; device: PairedDevice | null }>("/api/pair");
      if (me.paired && (!me.device || me.device.kind === "tv")) break;
      const name = onBox ? ((await agent.info().catch(() => null))?.hostname ?? "TV") : "Browser";
      const r = await api<{ token?: string; pending?: PendingScreen; secret?: string }>("/api/pair/screen", { method: "POST", body: { name } });
      if (!r.pending || !r.secret) break;
      setWaiting(r.pending);
      // Ask until it's let in; a request that's turned down or runs out starts again.
      for (;;) {
        await sleep(3000);
        const res = await fetch(`/api/pair/screen/${encodeURIComponent(r.pending.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: r.secret }) });
        if (res.status === 202) continue;
        break;
      }
      const again = await api<{ paired: boolean }>("/api/pair").catch(() => ({ paired: false }));
      if (again.paired) break;
    } catch (err) {
      // The Hub isn't up yet: try again shortly.
      if (!(err instanceof ApiError) || err.status >= 500) await sleep(5000);
      else await sleep(3000);
    }
  }
  setWaiting(null);
  onHubEvent((e) => e.type === "devices.changed" && setStamp((n) => n + 1));
  // The code runs out after ten minutes; a QR code left on screen gets a fresh one.
  setInterval(() => setStamp((n) => n + 1), 4 * 60_000);
}
