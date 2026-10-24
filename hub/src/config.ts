import path from "node:path";
import { fileURLToPath } from "node:url";

export interface HubConfig {
  port: number;
  host: string;
  /** Where the Hub keeps its own state (probe reports now, the database later). */
  dataDir: string;
  /** Folder of test clips for the probe, usually on the shared media storage. */
  clipsDir: string;
  /** Built probe page (tools/probe/dist). */
  probeDir: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): HubConfig {
  return {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? "0.0.0.0",
    dataDir: env.DATA_DIR ?? path.resolve(here, "../../data"),
    clipsDir: env.CLIPS_DIR ?? "/clips",
    probeDir: env.PROBE_DIR ?? path.resolve(here, "../../tools/probe/dist"),
  };
}
