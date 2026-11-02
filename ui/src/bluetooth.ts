// Bluetooth headphones, speakers and controllers on the TV box (#102), the app's side.
//
// The box owns the radio, so the TV asks it directly and the phone asks through the Hub, which
// carries the question to the TV. Both end up in the same `bluetooth()` method on the box, so the
// list, the sound and the delay are always the same whichever screen changed them.

import { createSignal } from "solid-js";
import type { BtAction, BtState } from "@ultimatetv/shared";
import { agent, agentHas } from "./agent";
import { toast } from "./store";

const NONE: BtState = { available: false, powered: false, scanning: false, devices: [], output: { kind: "tv" }, delayMs: 0, reason: "Bluetooth is set up on the TV box" };

const [btState, setBtState] = createSignal<BtState>(NONE);
export { btState, setBtState };

/** Whether this screen can change Bluetooth at all: only the box has a radio. */
export const canBluetooth = () => agentHas("bluetooth");

/** Reads the box's Bluetooth. Cheap: the box answers from what it already polled. */
export async function refreshBluetooth(): Promise<void> {
  if (!canBluetooth()) return;
  setBtState(await agent.bluetooth!({ do: "status" }).catch(() => NONE));
}

/**
 * Does something with Bluetooth and stores what came back. `quiet` is for the scan ticks, which
 * happen on their own and shouldn't say anything.
 */
export async function btDo(action: BtAction, quiet = false): Promise<void> {
  if (!canBluetooth()) throw new Error("Bluetooth is set up on the TV box");
  const state = await agent.bluetooth!(action);
  setBtState(state);
  if (quiet) return;
  const said = saidIt(action, state);
  if (said) toast(said, "good");
}

/** What to say once an action has happened, or nothing for actions that speak for themselves. */
function saidIt(action: BtAction, state: BtState): string | null {
  const device = action.do === "pair" || action.do === "connect" || action.do === "disconnect" || action.do === "forget" ? state.devices.find((d) => d.address === action.address) : undefined;
  switch (action.do) {
    case "pair":
      return device?.kind === "controller" ? `${device.name} is ready: it works in Retro games and Moonlight now` : `${device?.name ?? "It"} is paired${device?.kind === "headphones" ? ", and the sound is there" : ""}`;
    case "connect":
      return `The sound is on ${device?.name ?? "it"}`;
    case "disconnect":
      return `${device?.name ?? "It"} is disconnected`;
    case "forget":
      return "Forgotten";
    case "useTv":
      return "The sound is back on the TV";
    case "power":
      return action.on ? "Bluetooth is on" : "Bluetooth is off";
    default:
      return null;
  }
}
