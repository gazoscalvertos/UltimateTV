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

/** The request this screen is waiting on, kept so a reload or a Hub hiccup keeps the same code. */
interface Wait {
  pending: PendingScreen;
  secret: string;
}
const WAIT_KEY = "utv-pair-wait";
const saved = (): Wait | null => {
  try {
    const w = JSON.parse(localStorage.getItem(WAIT_KEY) ?? "null") as Wait | null;
    return w?.pending?.id && w.secret ? w : null;
  } catch {
    return null;
  }
};
const keep = (w: Wait | null) => {
  try {
    if (w) localStorage.setItem(WAIT_KEY, JSON.stringify(w));
    else localStorage.removeItem(WAIT_KEY);
  } catch {
    // No storage: a reload asks for a new code, which is all it costs.
  }
};

/** Resolves once this screen is paired (at once if it already is). */
export async function pairScreen(): Promise<void> {
  for (;;) {
    try {
      const me = await api<{ paired: boolean; device: PairedDevice | null }>("/api/pair");
      if (me.paired && (!me.device || me.device.kind === "tv")) break;
      const name = onBox ? ((await agent.info().catch(() => null))?.hostname ?? "TV") : "Browser";
      // Asking again with the request it has keeps the same code (an older Hub just makes a new one).
      const old = saved();
      const r = await api<{ token?: string; pending?: PendingScreen; secret?: string }>("/api/pair/screen", {
        method: "POST",
        body: { name, ...(old ? { id: old.pending.id, secret: old.secret } : {}) },
      });
      if (!r.pending || !r.secret) break;
      const wait = { pending: r.pending, secret: r.secret };
      keep(wait);
      setWaiting(r.pending);
      // Ask until it's let in. Only a request that's turned down or runs out (404) starts again
      // with a new code; the Hub not answering for a moment keeps the code on screen.
      let gone = false;
      for (;;) {
        await sleep(3000);
        const res = await fetch(`/api/pair/screen/${encodeURIComponent(wait.pending.id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret: wait.secret }),
        }).catch(() => null);
        if (!res || res.status === 202 || res.status >= 500) continue;
        gone = res.status === 404;
        break;
      }
      keep(null);
      if (gone) continue;
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
