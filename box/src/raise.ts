// Keeping the TV UI above the video.
//
// The box draws the UI in a transparent window over mpv's full-screen window, and KWin's window
// rules (tools/box/files/kwinrulesrc) put the UI "above" and the video "below". Pop-ups, clips,
// notices, skip intro and Up Next are all drawn by that UI, so if the stacking is ever lost they
// vanish while the film carries on.
//
// Films are where it was lost: a film is the one thing that makes the box change the screen's
// refresh rate and turn HDR on (display.ts), and a live channel doesn't. KWin rebuilds its outputs
// when that happens and mpv's window is mapped again, which can leave it in front of the UI.
// So the UI is raised again after each of those, and a moment later once the screen has settled.

export interface Raisable {
  isDestroyed(): boolean;
  setAlwaysOnTop(flag: boolean, level?: "screen-saver"): void;
  moveTop(): void;
}

/** Puts the window back above everything, including mpv's. Harmless when it already is. */
export function raiseUi(win: Raisable | null | undefined): boolean {
  if (!win || win.isDestroyed()) return false;
  win.setAlwaysOnTop(true, "screen-saver");
  win.moveTop();
  return true;
}

/** After the screen changed: now, then when the new mode and the video window have settled. */
export const RAISE_DELAYS_MS = [0, 400, 1500, 4000];

export function raiseSoon(win: () => Raisable | null | undefined, set: (fn: () => void, ms: number) => unknown = setTimeout): void {
  for (const ms of RAISE_DELAYS_MS) set(() => raiseUi(win()), ms);
}
