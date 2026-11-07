// The first-time tour (#229): about a minute, one screen per idea, shown once for each profile on
// its first visit and again from Help › Show me around. Back skips it at any point; skipping
// counts as seen, so it never nags.

import { createSignal, For, Show } from "solid-js";
import type { Profile } from "@ultimatetv/shared";
import { hub } from "../api";
import { appName, openDialog, profile, setProfile } from "../store";
import { DialogFrame } from "./Dialog";
import { RemoteDrawing, type RemoteKey } from "./RemoteDrawing";

interface Step {
  title: string;
  body: string;
  lit?: RemoteKey;
}

export const TOUR_STEPS: Step[] = [
  { title: `Welcome to ${"{app}"}`, body: "Here is a quick look at the remote, a minute at most. Press OK to carry on, or Back to skip it. You can see it again any time from Info › Show me around." },
  { title: "The arrows move, OK chooses", body: "Use the arrows to move the ring to what you want, then press OK to open or play it. The ring is always on the thing you are about to pick.", lit: "ok" },
  { title: "Back goes back", body: "Back takes you one step back, to the screen you came from. It never turns anything off or deletes anything.", lit: "back" },
  { title: "Home is the start", body: "Lost? Press Home and you are back at the start, whatever you were doing.", lit: "home" },
  { title: "The coloured buttons are shortcuts", body: "Red, green, yellow and blue jump straight to things, like Recordings or the TV guide. Their names are written along the bottom of the screen.", lit: "colours" },
  { title: "Info explains the buttons", body: "On any screen, press Info to see what every button does there. That is where this tour lives too.", lit: "info" },
  { title: "That's it", body: "Nothing you press here can break anything. Press OK to start watching." },
];

function TourDialog(props: { close: () => void }) {
  const [at, setAt] = createSignal(0);
  const step = () => TOUR_STEPS[at()]!;
  const last = () => at() === TOUR_STEPS.length - 1;
  const next = () => (last() ? props.close() : setAt(at() + 1));
  return (
    <DialogFrame close={props.close} class="tour-dialog" wide>
      <div class="help-layout">
        <RemoteDrawing {...(step().lit ? { lit: step().lit! } : {})} />
        <div class="help-text">
          <p class="tour-count">
            {at() + 1} of {TOUR_STEPS.length}
          </p>
          <h2>{step().title.replace("{app}", appName())}</h2>
          <p class="tour-body">{step().body}</p>
          <div class="tour-dots" aria-hidden="true">
            <For each={TOUR_STEPS}>{(_, i) => <i classList={{ on: i() === at() }} />}</For>
          </div>
        </div>
      </div>
      <div class="dialog-options">
        <button class="btn btn-primary btn-large" data-focus data-autofocus onClick={next}>
          {last() ? "Start watching" : "Next"}
        </button>
        <Show when={!last()}>
          <button class="btn btn-large" data-focus onClick={props.close}>
            Skip the tour
          </button>
        </Show>
      </div>
    </DialogFrame>
  );
}

/** Shows the tour; resolves when it ends or is skipped. */
export function runTour(): Promise<unknown> {
  return openDialog((close) => <TourDialog close={() => close()} />);
}

/** Right after a profile is picked: the tour, once, unless it has been seen. A Guest is a visitor and keeps nothing, so it isn't toured. */
export async function maybeTour(p: Profile): Promise<void> {
  if (p.toured || p.kind === "guest") return;
  // Let Home draw first, so the tour sits on top of it and the remote lands there afterwards.
  await new Promise((r) => setTimeout(r, 600));
  if (profile()?.id !== p.id) return;
  await runTour();
  const now = profile();
  if (now && now.id === p.id) setProfile({ ...now, toured: true });
  await hub.tourDone().catch(() => undefined);
}
