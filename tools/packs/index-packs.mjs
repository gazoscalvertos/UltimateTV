#!/usr/bin/env node
// Rebuilds community/clips/index.json, the community pack list the Hub browses, from the packs in
// this repository: the starter packs (hub/packs) and the community's (community/clips/packs). The
// single clips listed in it by hand stay as they are.
// Each entry carries the pack's size and SHA-256, which the Hub checks before keeping a pack.
//
//   npm run build -w shared -w hub && node tools/packs/index-packs.mjs
//
// It refuses to write the list if any pack fails the Hub's own checks.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { checkPack } = await import(path.join(root, "hub/dist/clippacks.js"));
const indexFile = path.join(root, "community/clips/index.json");

const dirs = ["hub/packs", "community/clips/packs"];
const packs = [];
let failed = false;
for (const dir of dirs) {
  const files = (await readdir(path.join(root, dir)).catch(() => [])).filter((f) => f.endsWith(".utvpack")).sort();
  for (const f of files) {
    const data = await readFile(path.join(root, dir, f));
    try {
      const pack = checkPack(data);
      const scary = dir === "hub/packs" ? pack.theme === "halloween" : undefined;
      packs.push({
        id: pack.id,
        name: pack.name,
        theme: pack.theme,
        ...(pack.description ? { description: pack.description } : {}),
        ...(pack.author ? { author: pack.author } : {}),
        count: pack.mixes.length,
        // A community pack says whether it's scary in community/clips/scary.json (the reviewer decides).
        scary: scary ?? false,
        sizeBytes: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
        // Relative to the list itself, so it works from any fork or branch.
        url: path.relative(path.dirname(indexFile), path.join(root, dir, f)).split(path.sep).join("/"),
      });
      console.log(`  ok  ${dir}/${f}`);
    } catch (e) {
      failed = true;
      console.error(`  BAD ${dir}/${f}: ${e.message}`);
    }
  }
}
const scaryList = JSON.parse(await readFile(path.join(root, "community/clips/scary.json"), "utf8").catch(() => "[]"));
for (const p of packs) if (scaryList.includes(p.id)) p.scary = true;
const ids = packs.map((p) => p.id);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dupes.length) {
  failed = true;
  console.error(`  Two packs share an id: ${[...new Set(dupes)].join(", ")}`);
}
if (failed) process.exit(1);

// Single clips (seasonal projections and jump scares, see community/clips/README.md) are listed by
// hand in the same file; they're kept as they are.
const current = JSON.parse(await readFile(indexFile, "utf8").catch(() => "{}"));
const clips = Array.isArray(current.clips) ? current.clips : [];
const index = { format: "ultimatetv.clip-index", version: 1, packs, clips };
const text = `${JSON.stringify(index, null, 2)}\n`;
if (process.argv.includes("--check")) {
  // CI: the committed list must be what this script would write.
  const now = await readFile(indexFile, "utf8").catch(() => "");
  if (now !== text) {
    console.error("community/clips/index.json is out of date: run node tools/packs/index-packs.mjs and commit it");
    process.exit(1);
  }
  console.log("community/clips/index.json is up to date");
} else {
  await writeFile(indexFile, text);
  console.log(`Wrote ${path.relative(root, indexFile)} with ${packs.length} packs`);
}
