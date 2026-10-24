import { loadConfig } from "./config.js";
import { LogRing } from "./diagnostics.js";
import { buildServer } from "./server.js";

const config = loadConfig();
const app = await buildServer(config, { logger: true, logRing: new LogRing(), env: process.env });
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
  setInterval(() => void ctx.downloads.tidyInbox().catch(() => undefined), 5 * 60_000);
}
