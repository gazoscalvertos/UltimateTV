// Remote keys → app actions. On the box the Hisense remote arrives over HDMI-CEC, and the
// installer's keymap (tools/box/files/cec-keymap.toml) turns CEC buttons into ordinary keys:
// arrows, Enter, Escape, F1–F4 for the colour keys, digits, PageUp/PageDown for channels and
// F5–F9 for Guide, Info, Rewind, Fast forward and Record. A keyboard works the same way, and the
// TV-style codes (403–406, 415, 19, …) are accepted too so the UI also runs on a TV browser.

export type Action =
  | "up"
  | "down"
  | "left"
  | "right"
  | "ok"
  | "back"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "guide"
  | "info"
  | "play"
  | "pause"
  | "playPause"
  | "stop"
  | "rewind"
  | "fastForward"
  | "record"
  | "channelUp"
  | "channelDown"
  | "home"
  | `digit${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;

export interface KeyLike {
  key: string;
  keyCode?: number;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

const BY_KEY: Record<string, Action> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Enter: "ok",
  " ": "playPause",
  Escape: "back",
  Backspace: "back",
  BrowserBack: "back",
  GoBack: "back",
  F1: "red",
  F2: "green",
  F3: "yellow",
  F4: "blue",
  ColorF0Red: "red",
  ColorF1Green: "green",
  ColorF2Yellow: "yellow",
  ColorF3Blue: "blue",
  F5: "guide",
  Guide: "guide",
  F6: "info",
  Info: "info",
  F7: "rewind",
  F8: "fastForward",
  F9: "record",
  MediaPlay: "play",
  MediaPause: "pause",
  MediaPlayPause: "playPause",
  MediaStop: "stop",
  MediaRewind: "rewind",
  MediaFastForward: "fastForward",
  MediaRecord: "record",
  MediaTrackPrevious: "rewind",
  MediaTrackNext: "fastForward",
  PageUp: "channelUp",
  PageDown: "channelDown",
  ChannelUp: "channelUp",
  ChannelDown: "channelDown",
  Home: "home",
  BrowserHome: "home",
  // Keyboard shortcuts for development.
  r: "red",
  g: "green",
  y: "yellow",
  b: "blue",
  i: "info",
  "[": "rewind",
  "]": "fastForward",
};

const BY_CODE: Record<number, Action> = {
  8: "back",
  13: "ok",
  37: "left",
  38: "up",
  39: "right",
  40: "down",
  403: "red",
  404: "green",
  405: "yellow",
  406: "blue",
  415: "play",
  19: "pause",
  463: "playPause",
  413: "stop",
  412: "rewind",
  417: "fastForward",
  416: "record",
  427: "channelUp",
  428: "channelDown",
  457: "info",
  458: "guide",
  461: "back",
  10009: "back",
};

export function actionForKey(e: KeyLike): Action | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  if (/^[0-9]$/.test(e.key)) return `digit${Number(e.key) as 0}`;
  const byKey = BY_KEY[e.key];
  if (byKey) return byKey;
  if (e.keyCode !== undefined) {
    if (e.keyCode >= 48 && e.keyCode <= 57) return `digit${(e.keyCode - 48) as 0}`;
    const byCode = BY_CODE[e.keyCode];
    if (byCode) return byCode;
  }
  return null;
}

export function digitOf(action: Action): number | null {
  return action.startsWith("digit") ? Number(action.slice(5)) : null;
}
