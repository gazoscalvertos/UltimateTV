// `npm run e2e`: the whole suite. One Hub and one browser per journey, a line each as they pass,
// and a non-zero exit if any of them didn't. Failure screenshots land in e2e/.failures for CI.

import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { journeys } from "./journeys.mjs";
import { FAILURE_DIR } from "./tv.mjs";

const only = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const picked = only ? journeys.filter((j) => j.name.toLowerCase().includes(only.toLowerCase())) : journeys;
if (!picked.length) {
  console.error(`No journey matches --only=${only}. There are: ${journeys.map((j) => j.name).join("; ")}`);
  process.exit(1);
}

// Old failures would otherwise look like this run's.
rmSync(FAILURE_DIR, { recursive: true, force: true });
mkdirSync(FAILURE_DIR, { recursive: true });

const started = Date.now();
const failed = [];
console.log(`Running ${picked.length} journey${picked.length === 1 ? "" : "s"} on the TV app…\n`);

for (const [i, journey] of picked.entries()) {
  const label = `${i + 1}/${picked.length} ${journey.name}`;
  const t0 = Date.now();
  process.stdout.write(`  ${label} … `);
  try {
    const detail = await journey.run();
    console.log(`ok (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    if (detail) console.log(`      ${detail}`);
  } catch (err) {
    console.log(`FAILED (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    console.log(`      why this matters: ${journey.why}`);
    console.log(`${String(err?.stack ?? err).split("\n").map((l) => `      ${l}`).join("\n")}`);
    failed.push({ name: journey.name, err });
  }
}

const took = ((Date.now() - started) / 1000).toFixed(1);
if (failed.length === 0) {
  console.log(`\nAll ${picked.length} journeys passed in ${took}s.`);
  process.exit(0);
}

const shots = (() => {
  try {
    return readdirSync(FAILURE_DIR).filter((f) => f.endsWith(".png"));
  } catch {
    return [];
  }
})();
console.log(`\n${failed.length} of ${picked.length} journeys failed in ${took}s:`);
for (const f of failed) console.log(`  - ${f.name}`);
if (shots.length) console.log(`\nScreenshots: ${shots.map((s) => `e2e/.failures/${s}`).join(", ")}`);
else console.log("\nNo screenshot was written — the journey failed before a browser was up.");
process.exit(1);
