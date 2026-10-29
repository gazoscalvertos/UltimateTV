// "Still watching?": the minute before the sleep timer (or auto-off) turns the TV off. OK carries
// on, Back turns the timer off; for auto-off any button will do, since someone's clearly there.

import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { addOverlayKeys } from "../keys";
import { cancelSleep, keepWatching, sleepTimer, sleepWarning } from "../sleep";
import { Icon } from "./Icon";

function Warning(props: { endsAt: number; reason: "timer" | "idle" }) {
  const [left, setLeft] = createSignal(Math.max(0, props.endsAt - Date.now()));
  onMount(() => {
    const t = window.setInterval(() => setLeft(Math.max(0, props.endsAt - Date.now())), 250);
    onCleanup(() => window.clearInterval(t));
    onCleanup(
      addOverlayKeys((a) => {
        if (a === "back" && props.reason === "timer") cancelSleep();
        else if (a === "ok" || props.reason === "idle") keepWatching();
        else return false;
        return true;
      }),
    );
  });
  const seconds = () => Math.ceil(left() / 1000);
  return (
    <div class="sleep-warning" role="alertdialog">
      <Icon name="moon" class="sleep-moon" />
      <div class="sleep-text">
        <h2>Still watching?</h2>
        <p>
          {props.reason === "timer" ? (sleepTimer().programme ? `${sleepTimer().programme} is ending. ` : "The sleep timer has run out. ") : "Nothing's been pressed for a few hours. "}
          The TV turns off in <b>{seconds()}</b> second{seconds() === 1 ? "" : "s"}.
        </p>
        <p class="sleep-keys">
          <span>
            <kbd>OK</kbd> {props.reason === "timer" ? "Half an hour more" : "Keep watching"}
          </span>
          <Show when={props.reason === "timer"}>
            <span>
              <kbd>Back</kbd> Turn the timer off
            </span>
          </Show>
        </p>
      </div>
      <div class="sleep-ring" style={{ "--p": String(Math.min(1, left() / 60_000)) }} />
    </div>
  );
}

export function SleepWarning() {
  return <Show when={sleepWarning()}>{(w) => <Warning endsAt={w().endsAt} reason={w().reason} />}</Show>;
}
