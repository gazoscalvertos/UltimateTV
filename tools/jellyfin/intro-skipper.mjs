#!/usr/bin/env node
// Jellyfin's Intro Skipper plugin, for Skip intro and Skip credits on the whole library.
//
//   JELLYFIN_URL=http://192.168.0.23:8096 JELLYFIN_API_KEY=… node tools/jellyfin/intro-skipper.mjs install
//   JELLYFIN_URL=… JELLYFIN_API_KEY=… node tools/jellyfin/intro-skipper.mjs scan
//   JELLYFIN_URL=… JELLYFIN_API_KEY=… node tools/jellyfin/intro-skipper.mjs check [--series "Name"] [--count 20]
//
// install  adds the plugin's repository, installs it and restarts Jellyfin (an admin API key:
//          Dashboard › API Keys).
// scan     starts the plugin's detection task, and Jellyfin's media segment scan, now rather
//          than waiting for tonight's run. The first run over a big library takes hours.
// check    looks at some episodes (random, or one series) and lists the markers found, so you
//          can see Skip intro will show before trying it on the TV.
//
// Needs Node 22 (fetch built in) and nothing else: run it from any computer on the home network.

const REPO_NAME = "Intro Skipper";
const REPO_URL = "https://intro-skipper.org/manifest.json";
const PLUGIN = "Intro Skipper";

const base = (process.env.JELLYFIN_URL ?? "").replace(/\/+$/, "");
const key = process.env.JELLYFIN_API_KEY ?? "";
const [cmd, ...rest] = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : fallback;
};

if (!base || !key || !["install", "scan", "check"].includes(cmd ?? "")) {
  console.error("Usage: JELLYFIN_URL=http://jellyfin:8096 JELLYFIN_API_KEY=<admin key> node tools/jellyfin/intro-skipper.mjs install|scan|check [--series Name] [--count 20]");
  process.exit(2);
}

async function jf(path, init = {}) {
  const res = await fetch(`${base}${path}`, { ...init, headers: { "X-Emby-Token": key, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${await res.text().catch(() => "")}`.trim());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const ms = (ticks) => {
  const s = Math.round(ticks / 10_000_000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

async function install() {
  const info = await jf("/System/Info");
  console.log(`Jellyfin ${info.Version} at ${base}`);
  const repos = (await jf("/Repositories")) ?? [];
  if (repos.some((r) => r.Url === REPO_URL)) console.log("The Intro Skipper repository is already there.");
  else {
    await jf("/Repositories", { method: "POST", body: JSON.stringify([...repos, { Name: REPO_NAME, Url: REPO_URL, Enabled: true }]) });
    console.log(`Added the repository ${REPO_URL}`);
  }
  const installed = (await jf("/Plugins")) ?? [];
  const have = installed.find((p) => p.Name === PLUGIN);
  if (have) {
    console.log(`${PLUGIN} ${have.Version} is already installed (${have.Status}).`);
    return;
  }
  // The catalogue only lists the plugin once Jellyfin has read the new repository.
  let pkg;
  for (let i = 0; i < 10 && !pkg; i++) {
    pkg = ((await jf("/Packages")) ?? []).find((p) => p.name === PLUGIN);
    if (!pkg) await new Promise((r) => setTimeout(r, 3000));
  }
  if (!pkg) throw new Error(`${PLUGIN} isn't in Jellyfin's catalogue. Check Dashboard › Plugins › Repositories, and that this Jellyfin is new enough for the plugin.`);
  await jf(`/Packages/Installed/${encodeURIComponent(PLUGIN)}?assemblyGuid=${encodeURIComponent(pkg.guid)}&repositoryUrl=${encodeURIComponent(REPO_URL)}`, { method: "POST" });
  console.log(`Installing ${PLUGIN}. Restarting Jellyfin so it loads…`);
  await new Promise((r) => setTimeout(r, 8000));
  await jf("/System/Restart", { method: "POST" }).catch((err) => console.log(`Restart: ${err.message}. Restart Jellyfin by hand (Dashboard › Restart).`));
  console.log("Done. When Jellyfin is back, run `scan` (or wait for tonight's run), then `check`.");
}

async function scan() {
  const tasks = (await jf("/ScheduledTasks")) ?? [];
  const wanted = tasks.filter((t) => /intro|credits|recap|media segment/i.test(`${t.Name} ${t.Key ?? ""}`));
  if (!wanted.length) throw new Error("No Intro Skipper task found. Is the plugin installed, and Jellyfin restarted since?");
  for (const t of wanted) {
    if (t.State === "Running") console.log(`Already running: ${t.Name}`);
    else {
      await jf(`/ScheduledTasks/Running/${t.Id}`, { method: "POST" });
      console.log(`Started: ${t.Name}`);
    }
  }
  console.log("Progress shows in Jellyfin under Dashboard › Scheduled Tasks.");
}

async function check() {
  const count = Number(arg("count", "20"));
  const series = arg("series");
  const q = new URLSearchParams({ IncludeItemTypes: "Episode", Recursive: "true", Fields: "Path", Limit: String(count) });
  if (series) {
    const found = (await jf(`/Items?${new URLSearchParams({ IncludeItemTypes: "Series", Recursive: "true", SearchTerm: series, Limit: "1" })}`))?.Items?.[0];
    if (!found) throw new Error(`No series called "${series}"`);
    q.set("ParentId", found.Id);
    q.set("SortBy", "ParentIndexNumber,IndexNumber");
    console.log(`${found.Name}:`);
  } else q.set("SortBy", "Random");
  const items = (await jf(`/Items?${q}`))?.Items ?? [];
  let withIntro = 0;
  let withCredits = 0;
  for (const it of items) {
    const segs = (await jf(`/MediaSegments/${it.Id}`).catch(() => null))?.Items ?? [];
    const intro = segs.find((s) => /intro/i.test(s.Type));
    const credits = segs.find((s) => /outro|credits/i.test(s.Type));
    if (intro) withIntro++;
    if (credits) withCredits++;
    const name = `${it.SeriesName ?? ""} S${String(it.ParentIndexNumber ?? 0).padStart(2, "0")}E${String(it.IndexNumber ?? 0).padStart(2, "0")}`.trim();
    const marks = segs.map((s) => `${s.Type} ${ms(s.StartTicks)}–${ms(s.EndTicks)}`).join(", ") || "no markers";
    console.log(`  ${name}: ${marks}`);
  }
  console.log(`\n${withIntro} of ${items.length} episodes have an intro marker, ${withCredits} have credits.`);
  if (!withIntro) console.log("None yet: has the detection task run? (`scan`, then wait for it to finish)");
}

try {
  await { install, scan, check }[cmd]();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
