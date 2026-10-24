// Bundles the probe for the TV's older Chromium and copies the HTML shell next to it.
import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(here, "dist");

await mkdir(outdir, { recursive: true });
await build({
  entryPoints: [path.join(here, "src/main.ts")],
  bundle: true,
  minify: true,
  sourcemap: true,
  format: "iife",
  // VIDAA ships an older embedded Chromium; ES2017 keeps us clear of syntax it can't parse.
  target: "es2017",
  tsconfig: path.join(here, "tsconfig.json"),
  outfile: path.join(outdir, "probe.js"),
});
await copyFile(path.join(here, "src/index.html"), path.join(outdir, "index.html"));
console.log("probe built to", path.relative(process.cwd(), outdir));
