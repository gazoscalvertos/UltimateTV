// TV apps: Netflix, Disney+, Prime Video and the rest live on the Hisense's own Home, where they
// play best (on Linux their copy protection keeps them to low resolution). The box hands the
// screen back over HDMI-CEC; picking UltimateTV on the TV's Input list brings it back.

import type { TvAppsMethod } from "@ultimatetv/shared";
import { agent, agentHas } from "./agent";
import { hub } from "./api";
import { choose } from "./components/Dialog";
import { pauseAllMusic } from "./music";
import { stopPlayback } from "./player";
import { appName, toast } from "./store";

/** The apps named on the button and in the help text (the TV has more). */
export const TV_APPS = ["Netflix", "Prime Video", "Disney+", "YouTube", "BBC iPlayer"];

const backHint = () => `To come back, press Input on the TV remote and choose ${appName()}.`;

/**
 * Over to the TV's own Home. Without CEC, explains which button on the TV remote does it (unless
 * `ask` is false: the phone says so itself).
 */
export async function openTvApps(ask = true): Promise<boolean> {
  const method: TvAppsMethod = (await hub.settings().catch(() => null))?.playback.tvAppsMethod ?? "both";
  // Only with the USB-CEC adapter plugged in; otherwise straight to which button to press.
  const cec = agentHas("tvApps") && Boolean((await agent.info().catch(() => null))?.cec?.connected);
  if (cec) {
    toast(`Over to the TV's apps. ${backHint()}`);
    await stopPlayback();
    await pauseAllMusic();
    // A moment to read how to get back, before the TV leaves the app.
    await new Promise((r) => setTimeout(r, 2500));
    if (await agent.tvApps(method).catch(() => false)) return true;
  }
  if (!ask) return false;
  await choose({
    title: "TV apps",
    message: `${TV_APPS.slice(0, 4).join(", ")} and the rest are on the TV's own Home: press the Home button (the house) on the TV remote. ${backHint()}${cec ? "" : agentHas("tvApps") ? " The box can do this for you once its USB-CEC adapter is plugged in." : " Update the box (Settings › About) and it can do this for you."}`,
    options: [{ label: "OK", value: "ok" }],
  });
  return false;
}
