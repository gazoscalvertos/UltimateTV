// Bluetooth on the TV: headphones, speakers and controllers, and the lip-sync delay (#102).
//
// The box does the work — it has the radio — so this is a list of what it has seen and a row per
// device. Pairing is "pair and trust in one press": paired so the box remembers it, trusted so it
// reconnects on its own. Headphones take the sound over as soon as they connect (decoded PCM,
// because Dolby and DTS can't travel over Bluetooth) and hand it back when they go.

import { createSignal, For, onCleanup, Show } from "solid-js";
import type { BtDevice } from "@ultimatetv/shared";
import { btActions, btDelayLabel, btSort, btSubtitle, BT_DELAY_LIMIT_MS } from "@ultimatetv/shared";
import { canBluetooth, btDo, btState, refreshBluetooth } from "../bluetooth";
import { choose } from "../components/Dialog";
import { Row, Status } from "../components/SettingRow";
import { errorToast, toast } from "../store";

/** The delays offered in the lip-sync row: a nudge at a time, up to a quarter second either way. */
const DELAY_STEPS = [0, 20, 40, 60, 80, 100, 140, 180, 240];

export function BluetoothSection() {
  void refreshBluetooth();
  // A scan fills the list as devices are found, so the screen asks again while it runs.
  const [poll, setPoll] = createSignal<ReturnType<typeof setInterval> | null>(null);
  const stopPolling = () => {
    const t = poll();
    if (t) clearInterval(t);
    setPoll(null);
  };
  onCleanup(stopPolling);

  const scan = async () => {
    try {
      await btDo({ do: "scan", on: !btState().scanning });
      if (btState().scanning) {
        stopPolling();
        setPoll(setInterval(() => void refreshBluetooth(), 3_000));
        toast("Looking for Bluetooth devices. Put yours in pairing mode.", "info");
      } else {
        stopPolling();
      }
    } catch (err) {
      errorToast(err);
    }
  };

  const act = async (device: BtDevice, what: "pair" | "connect" | "disconnect" | "forget"): Promise<void> => {
    if (what === "forget" && !(await choose({ title: `Forget ${device.name}?`, options: [{ label: "Forget it", value: true }, { label: "Keep it", value: false }] }))) return;
    await btDo({ do: what, address: device.address }).catch(errorToast);
  };

  const delay = async () => {
    const now = btState().delayMs;
    const pick = await choose({
      title: "Sound delay",
      options: DELAY_STEPS.map((ms) => ({ label: ms === now ? `${btDelayLabel(ms)} · now` : btDelayLabel(ms), value: ms })),
    });
    if (pick === undefined) return;
    await btDo({ do: "delay", ms: pick }).catch(errorToast);
  };

  return (
    <>
      <h2>Bluetooth</h2>
      <p class="hint">
        Headphones, speakers and game controllers for the box. Headphones take the sound over as soon as they connect, and the TV gets it back when they go. Over Bluetooth the sound is decoded rather than passed through, so Dolby and DTS come out as ordinary stereo.
      </p>
      <Show
        when={canBluetooth()}
        fallback={<Row label="Bluetooth" value={<Status ok={false} text="Only on the TV box" />} hint="Pair headphones from the box's own Settings" />}
      >
        <Show when={btState().available} fallback={<Row label="Bluetooth" value={<Status ok={false} text={btState().reason ?? "No adapter"} />} hint="The box has no Bluetooth adapter it can use" />}>
          <Row
            label="Bluetooth"
            icon="bluetooth"
            value={btState().powered ? <Status ok text="On" /> : <Status ok={false} text="Off" />}
            hint={btState().powered ? "Headphones and controllers can connect" : "Switched off on the box"}
            onSelect={() => void btDo({ do: "power", on: !btState().powered }).catch(errorToast)}
          />
          <Row
            label={btState().scanning ? "Looking for devices…" : "Find a new device"}
            icon="search"
            value={btState().scanning ? "Stop" : "Search"}
            hint="Put the headphones or controller in pairing mode, then search"
            onSelect={() => void scan()}
          />
          <Show when={btState().output.kind === "bluetooth" ? (btState().output as { name: string }).name : null}>
            {(name) => <Row label="The sound is on" icon="speaker" value={name()} hint="The TV's own speakers are silent until they disconnect" onSelect={() => void btDo({ do: "useTv" }).catch(errorToast)} />}
          </Show>
          <Row
            label="Sound delay"
            icon="restart"
            value={btDelayLabel(btState().delayMs)}
            hint={`Lines the sound up with the picture for Bluetooth headphones. Up to ${BT_DELAY_LIMIT_MS / 1000} seconds either way.`}
            onSelect={() => void delay()}
          />
          <Show when={btState().devices.length} fallback={<p class="hint">Nothing found yet. Put your headphones in pairing mode and choose “Find a new device”.</p>}>
            <For each={btSort(btState().devices)}>
              {(d) => (
                <Row
                  label={d.name}
                  icon={d.kind === "controller" ? "gamepad" : d.kind === "headphones" || d.kind === "speaker" ? "speaker" : "bluetooth"}
                  value={d.connected ? <Status ok text="Connected" /> : d.paired ? "Paired" : "Nearby"}
                  hint={btSubtitle(d)}
                  onSelect={() => void pickAction(d)}
                />
              )}
            </For>
          </Show>
        </Show>
      </Show>
    </>
  );

  /** One press does the obvious thing; a device with two choices asks. */
  async function pickAction(device: BtDevice): Promise<void> {
    const actions = btActions(device);
    if (actions.length === 1) return act(device, actions[0]!.do);
    const pick = await choose({ title: device.name, options: actions.map((a) => ({ label: a.label, value: a.do })) });
    if (pick) await act(device, pick);
  }
}
