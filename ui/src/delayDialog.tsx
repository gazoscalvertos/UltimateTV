// The Sound delay / Subtitle delay control (issue #223): left and right move it 50 ms with the
// number on screen, Back finishes. Up and down reach Reset.

import { delayLabel } from "@ultimatetv/shared";
import { DialogFrame } from "./components/Dialog";
import { setSound, setSubs, soundDelayMs, stepSound, stepSubs, subDelayMs } from "./delays";
import { openDialog } from "./store";

export function adjustDelay(which: "sound" | "subtitle"): Promise<unknown> {
  const value = which === "sound" ? soundDelayMs : subDelayMs;
  const step = which === "sound" ? stepSound : stepSubs;
  const reset = which === "sound" ? () => setSound(0) : () => setSubs(0);
  return openDialog((close) => (
    <DialogFrame
      close={() => close()}
      class="delay-panel"
      onKey={(a) => {
        if (a === "left" || a === "right") {
          void step(a === "left" ? -1 : 1);
          return true;
        }
        return undefined;
      }}
    >
      <h2>{which === "sound" ? "Sound delay" : "Subtitle delay"}</h2>
      <p class="dialog-message">
        {which === "sound"
          ? "If the voices come after the lips, make it a minus number (sound earlier). Headphones keep their own setting."
          : "If the words come late, make it a minus number (earlier). It starts at 0 for the next title."}
      </p>
      <div class="delay-readout" data-testid="delay-readout">
        ‹ {delayLabel(value())} ›
      </div>
      <div class="option-list">
        <button class="option" data-focus data-autofocus onClick={() => void step(-1)}>
          Earlier (−50 ms)
        </button>
        <button class="option" data-focus onClick={() => void step(1)}>
          Later (+50 ms)
        </button>
        <button class="option" data-focus onClick={() => void reset()}>
          Reset to 0
        </button>
        <button class="option" data-focus onClick={() => close()}>
          Done
        </button>
      </div>
    </DialogFrame>
  ));
}
