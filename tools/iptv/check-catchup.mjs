#!/usr/bin/env node
// Lists which Xtream channels offer catch-up, and optionally tests one by fetching a few KB
// of a programme from two hours ago. Credentials come from the environment and are never stored.
//
//   XTREAM_URL=http://provider.example:8080 XTREAM_USER=me XTREAM_PASS=secret \
//     node tools/iptv/check-catchup.mjs [--filter "BBC"] [--test "BBC One"]
//
// Uses one IPTV connection briefly when --test is given, so stop anything else that's streaming first.

const { XTREAM_URL, XTREAM_USER, XTREAM_PASS } = process.env;
if (!XTREAM_URL || !XTREAM_USER || !XTREAM_PASS) {
  console.error("Set XTREAM_URL, XTREAM_USER and XTREAM_PASS.");
  process.exit(1);
}

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const filter = option("--filter")?.toLowerCase();
const testName = option("--test")?.toLowerCase();

const base = XTREAM_URL.replace(/\/+$/, "");
const api = (action) =>
  `${base}/player_api.php?username=${encodeURIComponent(XTREAM_USER)}&password=${encodeURIComponent(XTREAM_PASS)}&action=${action}`;

const account = await (await fetch(api(""))).json();
const info = account.user_info ?? {};
console.log(`Account: ${info.status ?? "unknown"}, max connections ${info.max_connections ?? "?"}, active ${info.active_cons ?? "?"}`);

const streams = await (await fetch(api("get_live_streams"))).json();
const channels = streams
  .filter((s) => !filter || String(s.name).toLowerCase().includes(filter))
  .map((s) => ({ id: s.stream_id, name: String(s.name).trim(), archive: Number(s.tv_archive) === 1, days: Number(s.tv_archive_duration) || 0 }));

const withArchive = channels.filter((c) => c.archive);
console.log(`\n${withArchive.length} of ${channels.length} channels have catch-up.\n`);
for (const c of withArchive) console.log(`  ${String(c.days).padStart(2)} days  ${c.name}`);

if (testName) {
  const channel = withArchive.find((c) => c.name.toLowerCase().includes(testName));
  if (!channel) {
    console.error(`\nNo catch-up channel matches "${testName}".`);
    process.exit(1);
  }
  const start = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}:${pad(start.getHours())}-${pad(start.getMinutes())}`;
  const url = `${base}/timeshift/${encodeURIComponent(XTREAM_USER)}/${encodeURIComponent(XTREAM_PASS)}/30/${stamp}/${channel.id}.ts`;
  console.log(`\nTesting ${channel.name} from ${stamp} (30 min)…`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const reader = res.body.getReader();
    let bytes = 0;
    while (bytes < 256 * 1024) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
    }
    controller.abort();
    const ok = res.ok && bytes > 0;
    console.log(ok ? `OK: HTTP ${res.status}, received ${Math.round(bytes / 1024)} KB.` : `Failed: HTTP ${res.status}, ${bytes} bytes.`);
    process.exitCode = ok ? 0 : 1;
  } catch (err) {
    console.log(`Failed: ${err.name === "AbortError" ? "timed out" : err.message}`);
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
  }
}
