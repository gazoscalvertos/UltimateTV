// Alerts from the Hub (a subscription ending, a failed recording, a full NAS), for the top bar's
// bell and Settings › Alerts. The pop-ups themselves come as ordinary notices (see hub/src/alerts.ts).

import { createSignal } from "solid-js";
import type { HubAlert } from "@ultimatetv/shared";
import { hub } from "./api";
import { onHubEvent } from "./events";
import { errorToast } from "./store";

const [alerts, setAlerts] = createSignal<HubAlert[]>([]);
export { alerts };

export function loadAlerts(): void {
  void hub.alerts().then(setAlerts, () => undefined);
}

export async function dismissAlert(id: string): Promise<void> {
  try {
    setAlerts(await hub.dismissAlert(id));
  } catch (err) {
    errorToast(err);
  }
}

export async function checkAlerts(): Promise<void> {
  try {
    setAlerts(await hub.checkAlerts());
  } catch (err) {
    errorToast(err);
  }
}

export function startAlerts(): void {
  loadAlerts();
  onHubEvent((e) => {
    if (e.type === "hello" || e.type === "alerts.changed") loadAlerts();
  });
}
