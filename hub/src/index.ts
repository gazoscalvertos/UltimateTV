import path from "node:path";
import { loadConfig } from "./config.js";
import { LogRing, RollingFile } from "./diagnostics.js";
import { buildServer } from "./server.js";

const config = loadConfig();
// The log's rolling file is the same data/logs/hub.log that /api/diagnostics/logs/hub reads.
const logRing = new LogRing({ file: new RollingFile(path.join(config.dataDir, "logs", "hub.log")) });
const app = await buildServer(config, { logger: true, logRing, env: process.env });
const ctx = app.hub;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.port, host: config.host });
app.log.info({ clipsDir: config.clipsDir, dataDir: config.dataDir, demo: config.demo }, "UltimateTV Hub ready");

if (!config.demo) {
  const HOUR = 3_600_000;
  const refresh = () =>
    ctx.ingest
      .refreshAll()
      .then(() => {
        ctx.scheduler.replan();
        ctx.events.emit({ type: "guide.updated" });
      })
      .catch((err) => app.log.error({ err: String(err) }, "Refresh failed"));

  // Channels and guide on start, then the guide every 6 hours and the channel list daily.
  void refresh();
  setInterval(() => void refresh(), 6 * HOUR);
  // Series links follow schedule changes between full refreshes too.
  setInterval(() => ctx.scheduler.replan(), HOUR);
  ctx.scheduler.start();
  ctx.downloads.start();
  // Music video channels: Clubland TV, House TV and Halloween TV on a new Hub, then curation and downloads.
  ctx.mix.seed();
  void ctx.mix.start().catch((err) => app.log.error({ err: String(err) }, "Music channels failed to start"));
  setInterval(() => void ctx.downloads.tidyInbox().catch(() => undefined), 5 * 60_000);
}
