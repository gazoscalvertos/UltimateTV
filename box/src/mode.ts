// How this copy of the app runs. Imported first by main.ts, so the settings it reads are in
// process.env before anything else looks.
//
//   tv       the box: a KWin kiosk session (tools/box/install.sh) where the UI is a transparent,
//            full-screen window over mpv's, and the box owns the screen, sound and CEC.
//   desktop  an ordinary app on someone's own Linux desktop (the AppImage, see docs/desktop.md):
//            the UI in a normal window, video in mpv's own window, and nothing of the computer's
//            screen modes, sound output or volume touched.
//
// The AppImage starts in desktop mode and the box installer's launcher in TV mode; --desktop or
// --tv (or UTV_MODE=desktop|tv) picks either way. --hub=http://… overrides HUB_URL.

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type RunMode = "tv" | "desktop";

/** KEY=value lines, as in box.env: comments and blank lines skipped, optional quotes taken off. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2]!.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[m[1]!] = value;
  }
  return out;
}

/** Which mode, from the command line, then UTV_MODE, then whether this is an AppImage. */
export function runMode(argv: string[], env: NodeJS.ProcessEnv): RunMode {
  if (argv.includes("--desktop")) return "desktop";
  if (argv.includes("--tv")) return "tv";
  if (env.UTV_MODE === "desktop" || env.UTV_MODE === "tv") return env.UTV_MODE;
  return env.APPIMAGE ? "desktop" : "tv";
}

/** Where a desktop install keeps its settings: ~/.config/ultimatetv/box.env. */
export function desktopConfigFile(env: NodeJS.ProcessEnv): string {
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "ultimatetv", "box.env");
}

export const MODE: RunMode = runMode(process.argv, process.env);
export const DESKTOP = MODE === "desktop";

// The box's launcher has already loaded /etc/ultimatetv/box.env. A desktop copy reads its own file;
// anything already in the environment wins, so `HUB_URL=… ./UltimateTV.AppImage` works too.
if (DESKTOP) {
  try {
    for (const [k, v] of Object.entries(parseEnvFile(readFileSync(desktopConfigFile(process.env), "utf8")))) process.env[k] ??= v;
  } catch {
    // No settings file: the defaults (and the Hub-down screen, which shows the address) will do.
  }
}
const hubArg = process.argv.find((a) => a.startsWith("--hub="));
if (hubArg) process.env.HUB_URL = hubArg.slice("--hub=".length);
