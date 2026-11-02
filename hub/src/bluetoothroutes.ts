// The Hub side of Bluetooth (#102). Bluetooth itself belongs to the TV box — it's the box's own
// radio and its own speakers — so these routes only carry the question to the TV app and the answer
// back, the same way the phone's other box commands work. That means the phone's setup page and the
// TV's Settings screen see exactly the same list, and there is one place that decides who may ask.
//
// Adult profiles only: pairing headphones and hearing the sound move is a household change, not
// something a Kids profile should do mid-programme.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { cleanBtAction, type BtState } from "@ultimatetv/shared";
import type { Profile, TvMethod } from "@ultimatetv/shared";

type Viewer = { profile: Profile | null; admin: boolean };

/** What the box says when it has no Bluetooth of its own (a desktop copy of the app). */
const NO_BOX_BLUETOOTH: BtState = { available: false, powered: false, scanning: false, devices: [], output: { kind: "tv" }, delayMs: 0, reason: "Bluetooth is set up on the TV box, not on this page" };

export function registerBluetooth(
  app: FastifyInstance,
  deps: {
    viewer: (req: FastifyRequest) => Viewer;
    callTv: (method: TvMethod, args: unknown) => Promise<{ result?: unknown; error?: string }>;
    tvConnected: () => boolean;
  },
): void {
  const { viewer, callTv, tvConnected } = deps;

  /** Asks the box and hands back what it said. */
  const ask = async (args: unknown): Promise<BtState> => {
    if (!tvConnected()) throw Object.assign(new Error("The TV app isn't connected. Is the box on?"), { statusCode: 409, code: "tv-off" });
    const answer = await callTv("bluetooth", args);
    if (answer.error !== undefined) throw Object.assign(new Error(answer.error), { statusCode: 502 });
    const state = answer.result as BtState | null | undefined;
    if (!state || typeof state !== "object" || !Array.isArray(state.devices)) throw Object.assign(new Error("The TV app answered something odd. Its app may need updating."), { statusCode: 502 });
    return state;
  };

  app.get("/api/bluetooth", async () => ask({ do: "status" }).catch((e: Error & { code?: string }) => (e.code === "tv-off" ? NO_BOX_BLUETOOTH : Promise.reject(e))));

  app.post("/api/bluetooth", async (req, reply) => {
    if (!viewer(req).admin) return reply.code(403).send({ error: "Ask a grown-up: this needs the PIN", code: "pin" });
    const action = cleanBtAction(req.body);
    if (!action) return reply.code(400).send({ error: "That isn't something the TV can do with Bluetooth" });
    if (!tvConnected()) return reply.code(409).send({ error: "The TV app isn't connected. Is the box on?", code: "tv-off" });
    return ask(action);
  });
}
