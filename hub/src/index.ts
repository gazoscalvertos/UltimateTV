import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

const config = loadConfig();
const app = await buildServer(config, { logger: true });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.port, host: config.host });
app.log.info({ clipsDir: config.clipsDir, dataDir: config.dataDir }, "UltimateTV Hub ready");
