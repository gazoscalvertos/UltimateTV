import path from "node:path";
import { fileURLToPath } from "node:url";

export interface HubConfig {
  port: number;
  host: string;
  /** Where the Hub keeps its own state: the database, probe reports and recording temp files. */
  dataDir: string;
  /** Folder of test clips for the probes, usually on the shared media storage. */
  clipsDir: string;
  /** Built VIDAA probe page (tools/probe/dist). */
  probeDir: string;
  /** Built TV UI (ui/dist), served at /app/. */
  uiDir: string;
  /** Phone setup page. */
  setupDir: string;
  /** The phone remote (installable on Android). */
  remoteDir?: string;
  /** Default library root when settings don't say (the Hub container's view of the NAS). */
  mediaRoot: string;
  /** Fill the Hub with made-up channels, guide and library for screenshots and trying the UI. */
  demo: boolean;
  /** Address the phone setup QR code points at, when the Hub can't work it out (behind a proxy). */
  publicUrl?: string;
  /** Phones and screens must pair before they can control the TV (on unless PAIRING=off). */
  pairing?: boolean;
}

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): HubConfig {
  const config: HubConfig = {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? "0.0.0.0",
    dataDir: env.DATA_DIR ?? path.resolve(here, "../../data"),
    clipsDir: env.CLIPS_DIR ?? "/clips",
    probeDir: env.PROBE_DIR ?? path.resolve(here, "../../tools/probe/dist"),
    uiDir: env.UI_DIR ?? path.resolve(here, "../../ui/dist"),
    setupDir: env.SETUP_DIR ?? path.resolve(here, "../public/setup"),
    remoteDir: env.REMOTE_DIR ?? path.resolve(here, "../public/remote"),
    mediaRoot: env.MEDIA_ROOT ?? "/mnt/nas",
    demo: env.DEMO === "1" || env.DEMO === "true",
    pairing: env.PAIRING !== "off",
  };
  if (env.PUBLIC_URL) config.publicUrl = env.PUBLIC_URL.replace(/\/+$/, "");
  return config;
}
